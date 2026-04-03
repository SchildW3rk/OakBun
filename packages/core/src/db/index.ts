import type { VelnAdapter, BindingValue, QueryLogEntry } from '../adapter/types'
import type { SchemaMap, TableDef, InferInsert } from '../schema/table'
import type { HookExecutor } from '../hooks/executor'
import { RequestEventQueue } from '../events/index'
import { ValidationError } from '../app/types'
import { buildInsert, buildUpdate, buildDelete, buildSelect, buildJoinSelect, buildWhere, buildSelectListFromOptions, deserializeRow } from './sql'
import type { JoinClause, SelectOptions, WhereInput, SqlDialect, AggregateClause } from './sql'

// ── QueryLog — per-request query accumulator ──────────────────────────────

export interface QueryLog {
  /** Total number of queries executed during this request. */
  queries:   number
  /** Cumulative wall-clock duration of all queries in ms. */
  totalMs:   number
  /** Individual query entries — populated only when logQueries is true. */
  entries:   QueryLogEntry[]
  /** Warning threshold — exceeded → N+1 warning. */
  threshold: number
  /** Whether individual query entries should be captured (for logQueries). */
  logQueries: boolean
}

// ── Event Buffering Stub — Phase 3 fills the flush mechanism ──────────────

export interface PendingEvent {
  name: string
  payload: unknown
}

export interface TransactionResult<T> {
  result: T
  events: PendingEvent[]  // always [] in Phase 2; Phase 3 wires EventBus here
}

// ── EventBus interface — optional on ctx, Phase 3 provides the implementation

export interface EventBus {
  _emit(event: string, payload: unknown, ctx: unknown): void
  on(event: string, handler: (payload: unknown, ctx: unknown) => Promise<void> | void): this
  flush(events: PendingEvent[], ctx: unknown): Promise<void>
}

// ── VelnDB ─────────────────────────────────────────────────────────────────

export class VelnDB {
  constructor(
    private readonly adapter: VelnAdapter,
    private readonly hooks: HookExecutor,
  ) {}

  /** Return a new BoundVelnDB scoped to the given context. Never mutates this. */
  withCtx(ctx: unknown, queue?: RequestEventQueue, queryLog?: QueryLog): BoundVelnDB {
    return new BoundVelnDB(this.adapter, this.hooks, ctx, queue, queryLog)
  }
}

// ── BoundVelnDB ────────────────────────────────────────────────────────────

export class BoundVelnDB {
  /** Per-request query counter — incremented for every query() and execute() call on this instance. */
  _queryCount = 0
  private readonly adapter: VelnAdapter

  constructor(
    adapter: VelnAdapter,
    private readonly hooks: HookExecutor,
    private readonly ctx: unknown,
    // queue is undefined when used outside HTTP context (CLI, tests, background jobs)
    private readonly queue?: RequestEventQueue,
    // Optional per-request QueryLog. When provided, every query() and execute() call
    // increments the log's counters. Never mutates adapter.onQuery — avoids shared-state
    // races when multiple requests run concurrently on the same adapter instance.
    queryLog?: QueryLog,
  ) {
    if (queryLog) {
      const log = queryLog
      this.adapter = {
        query: async <T>(sql: string, params: BindingValue[] = []) => {
          const t0 = performance.now()
          const rows = await adapter.query<T>(sql, params)
          const durationMs = performance.now() - t0
          this._queryCount++
          log.queries++
          log.totalMs += durationMs
          if (log.logQueries) log.entries.push({ sql, params, durationMs, type: 'query' })
          return rows
        },
        execute: async (sql: string, params: BindingValue[] = []) => {
          const t0 = performance.now()
          const result = await adapter.execute(sql, params)
          const durationMs = performance.now() - t0
          this._queryCount++
          log.queries++
          log.totalMs += durationMs
          if (log.logQueries) log.entries.push({ sql, params, durationMs, type: 'execute' })
          return result
        },
        transaction: (fn) => adapter.transaction(fn),
        close: () => adapter.close(),
        onQuery: adapter.onQuery,
      }
    } else {
      this.adapter = adapter
    }
  }

  from<T, S extends SchemaMap>(table: TableDef<T, S>): SelectBuilder<T, S> {
    return new SelectBuilder<T, S>(this.adapter, this.hooks, this.ctx, this.queue, table, {})
  }

  /**
   * Start a JOIN query from the given table name.
   * Returns a JoinBuilder — call .join()/.leftJoin() etc. to add clauses,
   * then .select() to execute and get Record<string, unknown>[] results.
   *
   * @example
   * const rows = await db.join('orders')
   *   .columns(['orders.id', 'users.name'])
   *   .join('users', 'orders.user_id = users.id')
   *   .where('orders.status = ?', ['pending'])
   *   .select()
   */
  join(tableName: string): JoinBuilder {
    return new JoinBuilder(this.adapter, tableName, [], [], '', [])
  }

  into<T, S extends SchemaMap>(table: TableDef<T, S>): InsertBuilder<T, S> {
    return new InsertBuilder<T, S>(this.adapter, this.hooks, this.ctx, this.queue, table)
  }

  /**
   * DataLoader-pattern relation fetch — single IN-query, no N+1.
   * Returns a Map keyed by the foreign-key value; each entry is an array of
   * matching child rows (for one-to-many relations).
   *
   * @example
   * const posts = await db.from(postsTable).select()
   * const authorMap = await db.loadRelation(posts, 'authorId', usersTable, 'id')
   * // → SELECT * FROM "users" WHERE "id" IN (1, 2, 3)
   * const withAuthors = posts.map(p => ({ ...p, author: authorMap.get(p.authorId)?.[0] ?? null }))
   */
  async loadRelation<
    TParent extends Record<string, unknown>,
    TChild,
    TFk extends keyof TParent & string,
    TPk extends keyof TChild & string,
  >(
    parents:    TParent[],
    foreignKey: TFk,
    childTable: TableDef<TChild>,
    primaryKey: TPk,
  ): Promise<Map<TParent[TFk], TChild[]>> {
    const result = new Map<TParent[TFk], TChild[]>()
    if (parents.length === 0) return result

    const ids = [...new Set(parents.map((p) => p[foreignKey]))]
    const children = await this.from(childTable)
      .where({ [primaryKey]: { op: 'IN', value: ids } } as WhereInput<TChild>)
      .select()

    for (const child of children) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const key = child[primaryKey] as unknown as TParent[TFk]
      const group = result.get(key)
      if (group) {
        group.push(child)
      } else {
        result.set(key, [child])
      }
    }
    return result
  }

  /**
   * Convenience variant of loadRelation for belongs-to (many-to-one) relations.
   * Returns Map<fkValue, TChild> — single child per key instead of an array.
   *
   * @example
   * const authorMap = await db.loadRelationOne(posts, 'authorId', usersTable, 'id')
   * const author = authorMap.get(post.authorId) ?? null
   */
  async loadRelationOne<
    TParent extends Record<string, unknown>,
    TChild,
    TFk extends keyof TParent & string,
    TPk extends keyof TChild & string,
  >(
    parents:    TParent[],
    foreignKey: TFk,
    childTable: TableDef<TChild>,
    primaryKey: TPk,
  ): Promise<Map<TParent[TFk], TChild>> {
    const result = new Map<TParent[TFk], TChild>()
    if (parents.length === 0) return result

    const ids = [...new Set(parents.map((p) => p[foreignKey]))]
    const children = await this.from(childTable)
      .where({ [primaryKey]: { op: 'IN', value: ids } } as WhereInput<TChild>)
      .select()

    for (const child of children) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result.set(child[primaryKey] as unknown as TParent[TFk], child)
    }
    return result
  }

  async transaction<T>(fn: (db: BoundVelnDB) => Promise<T>): Promise<TransactionResult<T>> {
    // TX path: events collected inside the TX go into a dedicated txQueue.
    // If the TX commits successfully, txQueue.drain() returns the buffered events.
    // These are handed back via TransactionResult.events so the caller can flush
    // them at the right moment (after TX commit, not during).
    // This is intentionally separate from the per-request queue so that TX events
    // are never prematurely flushed if the request queue drains first.
    const txQueue = new RequestEventQueue()

    const result = await this.adapter.transaction(async (txAdapter) => {
      const txBound = new BoundVelnDB(txAdapter, this.hooks, this.ctx, txQueue)
      return fn(txBound)
    })
    // TX committed — drain buffered events into TransactionResult
    return { result, events: txQueue.drain() }
  }

  /**
   * Execute raw SQL and return typed rows.
   *
   * Without a schema the return type is `Record<string, unknown>[]`.
   * With a schema (e.g. a Zod object) every row is validated at runtime
   * and the return type is inferred from the schema.
   *
   * @example
   * // Untyped
   * const rows = await ctx.db.raw('SELECT * FROM orders WHERE amount > ?', [100])
   *
   * // Typed + validated
   * const schema = z.object({ id: z.number(), amount: z.number() })
   * const rows = await ctx.db.raw('SELECT id, amount FROM orders WHERE amount > ?', [100], schema)
   */
  async raw<T = Record<string, unknown>>(
    sql:     string,
    params:  BindingValue[] = [],
    schema?: { parse: (row: unknown) => T },
  ): Promise<T[]> {
    const rows = await this.adapter.query<Record<string, unknown>>(sql, params)
    if (!schema) return rows as T[]
    return rows.map((row) => {
      try {
        return schema.parse(row)
      } catch (err) {
        // @ts-ignore — ValidationError constructor expects ZodError; caller's schema.parse throws ZodError at runtime
        throw new ValidationError(err instanceof Error ? err.message : String(err))
      }
    })
  }
}

// ── mergeWhereInput — AND-merge two WhereInput values ─────────────────────────
// When both are plain objects (no OR/AND key), spread them.
// Otherwise wrap both in an AND group.

function mergeWhereAnd<T>(
  a: WhereInput<T>,
  b: WhereInput<T>,
): WhereInput<T> {
  const aIsPlain = !('OR' in a) && !('AND' in a)
  const bIsPlain = !('OR' in b) && !('AND' in b)
  if (aIsPlain && bIsPlain) {
    return { ...(a as object), ...(b as object) } as WhereInput<T>
  }
  return { AND: [a, b] }
}

// ── SelectBuilder ──────────────────────────────────────────────────────────

export class SelectBuilder<T, S extends SchemaMap> {
  constructor(
    private readonly adapter: VelnAdapter,
    private readonly hooks: HookExecutor,
    private readonly ctx: unknown,
    private readonly queue: RequestEventQueue | undefined,
    private readonly table: TableDef<T, S>,
    private readonly conditions: WhereInput<T>,
    private readonly _options: SelectOptions = {},
    // Raw SQL fragments appended with AND. Each entry is { sql, params }.
    private readonly _rawWhere: { sql: string; params: BindingValue[] }[] = [],
    private readonly _dialect: SqlDialect = 'sqlite',
  ) {}

  private _cloneWith(
    conditions: WhereInput<T>,
    rawWhere?: { sql: string; params: BindingValue[] }[],
  ): SelectBuilder<T, S> {
    return new SelectBuilder<T, S>(
      this.adapter,
      this.hooks,
      this.ctx,
      this.queue,
      this.table,
      conditions,
      this._options,
      rawWhere ?? this._rawWhere,
      this._dialect,
    )
  }

  private _clone(patch: Partial<SelectOptions>): SelectBuilder<T, S> {
    return new SelectBuilder<T, S>(
      this.adapter,
      this.hooks,
      this.ctx,
      this.queue,
      this.table,
      this.conditions,
      { ...this._options, ...patch },
      this._rawWhere,
      this._dialect,
    )
  }

  /**
   * Add WHERE conditions. Accepts:
   * - Plain equality map:   `.where({ role: 'admin' })`
   * - Operator condition:   `.where({ age: { op: '>=', value: 18 } })`
   * - OR group:             `.where({ OR: [{ role: 'admin' }, { role: 'mod' }] })`
   * - AND group:            `.where({ AND: [...] })`
   *
   * Multiple `.where()` calls are combined with AND.
   */
  where(conditions: WhereInput<T>): SelectBuilder<T, S> {
    const merged = mergeWhereAnd(this.conditions, conditions)
    return this._cloneWith(merged)
  }

  /**
   * Append a raw SQL WHERE fragment, combined with AND.
   * Use for conditions the builder cannot express.
   *
   * @example
   * .whereRaw('"score" > "threshold"', [])
   * .whereRaw('"created_at" > ?', ['2024-01-01'])
   */
  whereRaw(sql: string, params: BindingValue[]): SelectBuilder<T, S> {
    return this._cloneWith(this.conditions, [...this._rawWhere, { sql, params }])
  }

  /** Limit the number of rows returned. Bound as a parameter — never interpolated. */
  limit(n: number): SelectBuilder<T, S> {
    return this._clone({ limit: n })
  }

  /** Skip the first n rows. Bound as a parameter — never interpolated. */
  offset(n: number): SelectBuilder<T, S> {
    return this._clone({ offset: n })
  }

  /** Add an ORDER BY clause. Multiple calls accumulate in order. */
  orderBy(col: keyof T & string, dir: 'ASC' | 'DESC' = 'ASC'): SelectBuilder<T, S> {
    const existing = this._options.orderBy ?? []
    return this._clone({ orderBy: [...existing, { col, dir }] })
  }

  /**
   * Convenience helper for cursor-based pagination.
   * page(1, 10) → LIMIT 10 OFFSET 0
   * page(2, 10) → LIMIT 10 OFFSET 10
   */
  page(page: number, size: number): SelectBuilder<T, S> {
    return this._clone({ limit: size, offset: (page - 1) * size })
  }

  /**
   * Restrict which columns are returned.
   * SELECT "id", "name" FROM "table" — instead of SELECT *
   *
   * Return type is narrowed to Pick<T, K> for full type safety.
   */
  columns<K extends keyof T & string>(...cols: K[]): SelectBuilder<Pick<T, K>, S> {
    // Type cast required: the builder's T changes to Pick<T, K>.
    // At runtime the only difference is _options.columns — schema stays the same.
    return this._clone({ columns: cols }) as unknown as SelectBuilder<Pick<T, K>, S>
  }

  /**
   * Add a GROUP BY clause. Multiple columns are comma-separated.
   * Combine with .aggregate() to get grouped aggregate results.
   */
  groupBy(...cols: (keyof T & string)[]): SelectBuilder<T, S> {
    return this._clone({ groupBy: cols as string[] })
  }

  /**
   * Add a HAVING clause — filters aggregate groups.
   * Uses the same WhereInput system as .where() (supports operators, OR/AND).
   *
   * @example
   * .groupBy('role').aggregate({ cnt: { fn: 'COUNT' } }).having({ cnt: { op: '>', value: 1 } })
   */
  having(conditions: WhereInput<Record<string, unknown>>): SelectBuilder<T, S> {
    return this._clone({ having: conditions })
  }

  /**
   * Execute a GROUP BY + aggregate query.
   * Returns typed rows with group-by columns + aggregate aliases.
   *
   * @example
   * const rows = await db.from(orders)
   *   .groupBy('status')
   *   .aggregate({ total: { fn: 'SUM', col: 'amount' }, cnt: { fn: 'COUNT' } })
   * // rows: { status: string; total: number; cnt: number }[]
   */
  async aggregate<TAgg extends Record<string, number | string | null>>(
    aggregates: { [K in keyof TAgg]: { fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'; col?: keyof T & string } },
  ): Promise<(Partial<T> & TAgg)[]> {
    const aggClauses: AggregateClause[] = Object.entries(aggregates).map(([alias, def]) => ({
      alias,
      fn:  (def as { fn: AggregateClause['fn']; col?: string }).fn,
      col: (def as { fn: AggregateClause['fn']; col?: string }).col,
    }))

    // Merge aggregate clauses into current options and execute via select()
    const { sql, params } = buildSelect(
      this.table.name,
      this.conditions as WhereInput<Record<string, unknown>>,
      { ...this._options, aggregates: aggClauses },
      this._dialect,
    )

    const rows = await this.adapter.query<Record<string, unknown>>(sql, params)
    return rows as (Partial<T> & TAgg)[]
  }

  // ── Scalar aggregate terminals ─────────────────────────────────────────────
  // These execute immediately and return a single value.

  /** COUNT(*) or COUNT("col") — returns the count as a number. */
  async count(col?: keyof T & string): Promise<number> {
    return this._scalarAggregate('COUNT', col)
  }

  /** SUM("col") — returns the sum as a number (0 if no rows). */
  async sum(col: keyof T & string): Promise<number> {
    return this._scalarAggregate('SUM', col)
  }

  /** AVG("col") — returns the average as a number (0 if no rows). */
  async avg(col: keyof T & string): Promise<number> {
    return this._scalarAggregate('AVG', col)
  }

  /** MIN("col") — returns the minimum value. */
  async min(col: keyof T & string): Promise<number | string | null> {
    return this._scalarAggregateRaw('MIN', col)
  }

  /** MAX("col") — returns the maximum value. */
  async max(col: keyof T & string): Promise<number | string | null> {
    return this._scalarAggregateRaw('MAX', col)
  }

  private async _scalarAggregate(fn: AggregateClause['fn'], col?: keyof T & string): Promise<number> {
    const val = await this._scalarAggregateRaw(fn, col)
    if (val === null || val === undefined) return 0
    return Number(val)
  }

  private async _scalarAggregateRaw(fn: AggregateClause['fn'], col?: keyof T & string): Promise<number | string | null> {
    const alias = '_agg'
    const colExpr = col ? `"${col as string}"` : '*'
    const { sql: whereSql, params } = buildWhere(
      this.conditions as WhereInput<Record<string, unknown>>,
      this._dialect,
    )

    let sqlStr: string
    let finalParams: BindingValue[]

    if (this._rawWhere.length > 0) {
      const allWhereParts: string[] = []
      const allParams: BindingValue[] = [...params]
      if (whereSql) allWhereParts.push(whereSql)
      for (const raw of this._rawWhere) {
        allWhereParts.push(raw.sql)
        allParams.push(...raw.params)
      }
      const combined = allWhereParts.join(' AND ')
      sqlStr = combined
        ? `SELECT ${fn}(${colExpr}) AS "${alias}" FROM "${this.table.name}" WHERE ${combined}`
        : `SELECT ${fn}(${colExpr}) AS "${alias}" FROM "${this.table.name}"`
      finalParams = allParams
    } else {
      sqlStr = whereSql
        ? `SELECT ${fn}(${colExpr}) AS "${alias}" FROM "${this.table.name}" WHERE ${whereSql}`
        : `SELECT ${fn}(${colExpr}) AS "${alias}" FROM "${this.table.name}"`
      finalParams = params
    }

    const row = await this.adapter.query<Record<string, unknown>>(sqlStr, finalParams)
    return (row[0]?.[alias] ?? null) as number | string | null
  }

  async select(): Promise<T[]> {
    let finalSql: string
    let finalParams: BindingValue[]

    if (this._rawWhere.length === 0) {
      // Fast path: no raw fragments — buildSelect handles everything
      const { sql, params } = buildSelect(
        this.table.name,
        this.conditions as WhereInput<Record<string, unknown>>,
        this._options,
        this._dialect,
      )
      finalSql = sql
      finalParams = params
    } else {
      // Merge structured WHERE + raw fragments via AND, then bolt on options
      const { sql: whereSql, params: whereParams } = buildWhere(
        this.conditions as WhereInput<Record<string, unknown>>,
        this._dialect,
      )
      const allWhereParts: string[] = []
      const allParams: BindingValue[] = [...whereParams]
      if (whereSql) allWhereParts.push(whereSql)
      for (const raw of this._rawWhere) {
        allWhereParts.push(raw.sql)
        allParams.push(...raw.params)
      }
      const combinedWhere = allWhereParts.join(' AND ')

      // Delegate to buildSelect with a synthetic empty-conditions call so
      // GROUP BY / HAVING / ORDER BY / LIMIT are handled consistently,
      // but inject our merged WHERE manually.
      const selectList = buildSelectListFromOptions(this._options)
      const parts: string[] = [
        combinedWhere
          ? `SELECT ${selectList} FROM "${this.table.name}" WHERE ${combinedWhere}`
          : `SELECT ${selectList} FROM "${this.table.name}"`,
      ]
      if (this._options.groupBy && this._options.groupBy.length > 0) {
        parts.push(`GROUP BY ${this._options.groupBy.map((c) => `"${c}"`).join(', ')}`)
      }
      if (this._options.having) {
        const { sql: havSql, params: havParams } = buildWhere(this._options.having, this._dialect)
        if (havSql) {
          parts.push(`HAVING ${havSql}`)
          allParams.push(...havParams)
        }
      }
      if (this._options.orderBy && this._options.orderBy.length > 0) {
        const clause = this._options.orderBy
          .map(({ col, dir }) => `"${col}" ${dir}`)
          .join(', ')
        parts.push(`ORDER BY ${clause}`)
      }
      if (this._options.limit !== undefined || this._options.offset !== undefined) {
        const limitVal = this._options.limit !== undefined
          ? Math.trunc(Math.max(0, this._options.limit))
          : -1
        parts.push(`LIMIT ${limitVal}`)
        if (this._options.offset !== undefined) {
          parts.push(`OFFSET ${Math.trunc(Math.max(0, this._options.offset))}`)
        }
      }
      finalSql = parts.join(' ')
      finalParams = allParams
    }

    const rows = await this.adapter.query<Record<string, unknown>>(finalSql, finalParams)
    // When columns are restricted, only deserialize the selected columns
    if (this._options.columns && this._options.columns.length > 0) {
      return rows as unknown as T[]
    }
    return rows.map((row) => deserializeRow(this.table, row))
  }

  async first(): Promise<T | null> {
    const rows = await this.select()
    return rows[0] ?? null
  }

  async update(patch: Partial<T>): Promise<T> {
    const hasConditions = !(
      Object.keys(this.conditions).length === 0 && this._rawWhere.length === 0
    )
    if (!hasConditions) {
      throw new Error('update() requires .where() conditions')
    }

    // Load current row
    const current = await this.first()
    if (current === null) {
      throw new Error('Record not found for update')
    }

    // Run beforeUpdate hooks (may transform patch)
    const finalPatch = await this.hooks.runBeforeUpdate(this.table, this.ctx, current, patch)

    // Execute UPDATE
    const pk = this.table.primaryKey
    const pkValue = (current as Record<string, unknown>)[pk as string] as BindingValue
    const { sql, params } = buildUpdate(
      this.table.name,
      finalPatch as Record<string, unknown>,
      pk,
      pkValue,
    )
    await this.adapter.execute(sql, params)

    // Construct updated result from known data — avoids a second SELECT round-trip.
    // We know exactly what was in the row before (current) and what was patched (finalPatch),
    // so the result is the merge of both. deserializeRow handles Date deserialization.
    const updatedRow: Record<string, unknown> = {
      ...(current as Record<string, unknown>),
      ...(finalPatch as Record<string, unknown>),
    }
    const result = deserializeRow(this.table, updatedRow)

    // Run afterUpdate hooks — events collected into queue, not emitted immediately
    await this.hooks.runAfterUpdate(this.table, this.ctx, result, current, this.queue)

    return result
  }

  async delete(): Promise<T> {
    const hasConditions = !(
      Object.keys(this.conditions).length === 0 && this._rawWhere.length === 0
    )
    if (!hasConditions) {
      throw new Error('delete() requires .where() conditions')
    }

    // Load current row
    const current = await this.first()
    if (current === null) {
      throw new Error('Record not found for delete')
    }

    // Run beforeDelete hooks (can throw to cancel)
    await this.hooks.runBeforeDelete(this.table, this.ctx, current)

    // Execute DELETE
    const pk = this.table.primaryKey
    const pkValue = (current as Record<string, unknown>)[pk as string] as BindingValue
    const { sql, params } = buildDelete(this.table.name, pk, pkValue)
    await this.adapter.execute(sql, params)

    // Run afterDelete hooks — events collected into queue, not emitted immediately
    await this.hooks.runAfterDelete(this.table, this.ctx, current, this.queue)

    return current
  }
}

// ── InsertBuilder ──────────────────────────────────────────────────────────

export class InsertBuilder<T, S extends SchemaMap> {
  constructor(
    private readonly adapter: VelnAdapter,
    private readonly hooks: HookExecutor,
    private readonly ctx: unknown,
    private readonly queue: RequestEventQueue | undefined,
    private readonly table: TableDef<T, S>,
  ) {}

  async insert(data: InferInsert<S>): Promise<T> {
    const originalInput = { ...data } as Partial<T>
    let current = { ...data } as Partial<T>

    // 1. Run beforeInsert hooks (may transform data)
    current = await this.hooks.runBeforeInsert(this.table, this.ctx, current)

    // 2. Apply defaultFns and defaultValues for unset fields
    for (const [field, col] of Object.entries(this.table.schema)) {
      // Skip autoIncrement primary keys — DB assigns the value
      if (col.def.primaryKey && col.def.autoIncrement) continue

      if ((current as Record<string, unknown>)[field] === undefined) {
        if (col.def.defaultFn !== undefined) {
          ;(current as Record<string, unknown>)[field] = col.def.defaultFn()
        } else if (col.def.defaultValue !== undefined) {
          ;(current as Record<string, unknown>)[field] = col.def.defaultValue
        }
      }
    }

    // 3. Serialize values for SQLite (Date → ISO string)
    const serialized = this._serializeForInsert(current as Record<string, unknown>)

    // 4. Execute INSERT RETURNING * — single round-trip, no follow-up SELECT needed.
    // SQLite ≥ 3.35 and PostgreSQL both support RETURNING *.
    // We use adapter.query() (not execute()) because RETURNING * yields rows.
    const { sql, params } = buildInsert(this.table.name, serialized, true)
    const rows = await this.adapter.query<Record<string, unknown>>(sql, params)
    const result = deserializeRow(this.table, rows[0]!)

    // 6. Run afterInsert hooks — events collected into queue, not emitted immediately
    await this.hooks.runAfterInsert(this.table, this.ctx, result, originalInput, this.queue)

    return result
  }

  /** Serialize values for SQLite storage. Date → ISO string. */
  private _serializeForInsert(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(data)) {
      if (val === undefined) continue
      result[key] = val instanceof Date ? val.toISOString() : val
    }
    return result
  }
}

// ── JoinBuilder ───────────────────────────────────────────────────────────────
// Immutable fluent builder for SELECT queries with JOIN clauses.
// Returns Record<string, unknown>[] — results span multiple tables so no single
// TypeDef can describe the shape.

export class JoinBuilder {
  constructor(
    private readonly adapter: VelnAdapter,
    private readonly tableName: string,
    private readonly _columns: string[],
    private readonly _joins: JoinClause[],
    private readonly _where: string,
    private readonly _params: BindingValue[],
    private readonly _options: SelectOptions = {},
  ) {}

  private _cloneOpts(patch: Partial<SelectOptions>): JoinBuilder {
    return new JoinBuilder(
      this.adapter,
      this.tableName,
      this._columns,
      this._joins,
      this._where,
      this._params,
      { ...this._options, ...patch },
    )
  }

  /** Restrict the selected columns (e.g. ['orders.id', 'users.name']). */
  columns(cols: string[]): JoinBuilder {
    return new JoinBuilder(this.adapter, this.tableName, cols, this._joins, this._where, this._params, this._options)
  }

  /** Add an INNER JOIN clause. */
  join(table: string, on: string): JoinBuilder {
    return this._addJoin('INNER', table, on)
  }

  /** Add a LEFT JOIN clause. */
  leftJoin(table: string, on: string): JoinBuilder {
    return this._addJoin('LEFT', table, on)
  }

  /** Add a RIGHT JOIN clause. */
  rightJoin(table: string, on: string): JoinBuilder {
    return this._addJoin('RIGHT', table, on)
  }

  /** Add a FULL JOIN clause. */
  fullJoin(table: string, on: string): JoinBuilder {
    return this._addJoin('FULL', table, on)
  }

  /**
   * Set a typed WHERE clause from a conditions object.
   * Each key becomes "key" = ? — values are bound safely.
   *
   * @example
   * .where({ status: 'pending', userId })
   */
  where(conditions: Record<string, BindingValue>): JoinBuilder
  /**
   * Set a raw WHERE clause.
   * Use ? as placeholder; pass bind values as the second argument.
   *
   * @example
   * .where('orders.status = ? AND orders.user_id = ?', ['pending', userId])
   */
  where(sql: string, params: BindingValue[]): JoinBuilder
  where(conditionsOrSql: Record<string, BindingValue> | string, params?: BindingValue[]): JoinBuilder {
    if (typeof conditionsOrSql === 'string') {
      return new JoinBuilder(this.adapter, this.tableName, this._columns, this._joins, conditionsOrSql, params ?? [], this._options)
    }
    const { sql, params: builtParams } = buildWhere(conditionsOrSql)
    return new JoinBuilder(this.adapter, this.tableName, this._columns, this._joins, sql, builtParams, this._options)
  }

  /** Limit the number of rows returned. Bound as a parameter — never interpolated. */
  limit(n: number): JoinBuilder {
    return this._cloneOpts({ limit: n })
  }

  /** Skip the first n rows. Bound as a parameter — never interpolated. */
  offset(n: number): JoinBuilder {
    return this._cloneOpts({ offset: n })
  }

  /**
   * Add an ORDER BY clause. Multiple calls accumulate in order.
   * @param col Column reference, e.g. 'orders.created_at' or 'name'.
   */
  orderBy(col: string, dir: 'ASC' | 'DESC' = 'ASC'): JoinBuilder {
    const existing = this._options.orderBy ?? []
    return this._cloneOpts({ orderBy: [...existing, { col, dir }] })
  }

  /**
   * Convenience helper for cursor-based pagination.
   * page(1, 10) → LIMIT 10 OFFSET 0
   * page(2, 10) → LIMIT 10 OFFSET 10
   */
  page(page: number, size: number): JoinBuilder {
    return this._cloneOpts({ limit: size, offset: (page - 1) * size })
  }

  /**
   * Execute the query and return raw rows (no deserialization).
   *
   * @remarks
   * Type parameter T is a manual cast — not validated at runtime.
   * For runtime validation, use db.raw() with a Zod schema instead.
   */
  async select<T = Record<string, unknown>>(): Promise<T[]> {
    const { sql, params } = buildJoinSelect(
      this.tableName,
      this._columns,
      this._joins,
      this._where,
      this._params,
      this._options,
    )
    return this.adapter.query<T>(sql, params)
  }

  /**
   * Execute the query and return the first row, or null.
   *
   * @remarks
   * Type parameter T is a manual cast — not validated at runtime.
   */
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const rows = await this.select<T>()
    return rows[0] ?? null
  }

  private _addJoin(type: JoinClause['type'], table: string, on: string): JoinBuilder {
    return new JoinBuilder(
      this.adapter,
      this.tableName,
      this._columns,
      [...this._joins, { type, table, on }],
      this._where,
      this._params,
      this._options,
    )
  }
}
