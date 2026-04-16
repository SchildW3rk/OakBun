import type { VelnAdapter, BindingValue, QueryLogEntry } from '../adapter/types'
import type { SchemaMap, TableDef, InferInsert, InferUpdate, RelationMeta, RelationsMap, WithRelations } from '../schema/table'
import type { HookExecutor } from '../hooks/executor'
import { RequestEventQueue } from '../events/index'
import { ValidationError } from '../app/types'
import { buildInsert, buildInsertMany, buildUpdate, buildDelete, buildSelect, buildJoinSelect, buildWhere, buildSelectListFromOptions, deserializeRow, buildSubquery, buildSoftDeleteUpdate, buildUnion } from './sql'
import type { JoinClause, SelectOptions, WhereInput, SqlDialect, AggregateClause, SubqueryResult } from './sql'

/**
 * Translate a WhereInput from JS property keys to SQL column names.
 * Only renames keys that have an explicit `.name()` mapping on the column.
 * Keys not found in the schema are passed through unchanged (raw SQL / join columns).
 */
function mapWhere<T>(
  conditions: WhereInput<T>,
  schema: SchemaMap,
): WhereInput<Record<string, unknown>> {
  if (typeof conditions !== 'object' || conditions === null || Array.isArray(conditions)) {
    return conditions as WhereInput<Record<string, unknown>>
  }
  const result: Record<string, unknown> = {}
  for (const [jsKey, val] of Object.entries(conditions as Record<string, unknown>)) {
    const col = schema[jsKey]
    const sqlName = col?.def.columnName ?? jsKey
    result[sqlName] = val
  }
  return result as WhereInput<Record<string, unknown>>
}

/**
 * Translate a data object from JS property keys to SQL column names for UPDATE.
 */
function mapDataToSql(data: Record<string, unknown>, schema: SchemaMap): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [jsKey, val] of Object.entries(data)) {
    const col = schema[jsKey]
    const sqlName = col?.def.columnName ?? jsKey
    result[sqlName] = val
  }
  return result
}

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
    private readonly dialect: SqlDialect = 'sqlite',
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
        dialect:     adapter.dialect,
        transaction: (fn) => adapter.transaction(fn),
        close: () => adapter.close(),
        onQuery: adapter.onQuery,
      }
    } else {
      this.adapter = adapter
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from<T, S extends SchemaMap, TRelations extends RelationsMap>(
    table: TableDef<T, S, any, TRelations>,
  ): SelectBuilder<T, S, TRelations> {
    return new SelectBuilder<T, S, TRelations>(this.adapter, this.hooks, this.ctx, this.queue, table as TableDef<T, S, any, TRelations>, {})
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
    return new InsertBuilder<T, S>(this.adapter, this.hooks, this.ctx, this.queue, table, this.dialect)
  }

  /**
   * DataLoader-pattern relation fetch — single IN-query, no N+1.
   * Returns a Map keyed by the foreign-key value; each entry is an array of
   * matching child rows (for one-to-many relations).
   *
   * Two call forms:
   *
   * @example — explicit (original)
   * const authorMap = await db.loadRelation(posts, 'authorId', usersTable, 'id')
   *
   * @example — name-based (reads relation metadata declared on the table)
   * const authorMap = await db.loadRelation(posts, 'author', postsTable)
   */
  // Overload 1 — explicit, original signature (unchanged)
  loadRelation<
    TParent extends Record<string, unknown>,
    TChild,
    TFk extends keyof TParent & string,
    TPk extends keyof TChild & string,
  >(
    parents:    TParent[],
    foreignKey: TFk,
    childTable: TableDef<TChild>,
    primaryKey: TPk,
  ): Promise<Map<TParent[TFk], TChild[]>>
  // Overload 2 — name-based, reads from sourceTable.relations
  loadRelation<TParent extends Record<string, unknown>>(
    parents:      TParent[],
    relationName: string,
    sourceTable:  TableDef<any>,
  ): Promise<Map<unknown, unknown>>
  // Implementation
  async loadRelation<
    TParent extends Record<string, unknown>,
    TChild,
    TFk extends keyof TParent & string,
    TPk extends keyof TChild & string,
  >(
    parents:            TParent[],
    keyOrRelationName:  TFk | string,
    tableOrSource:      TableDef<TChild> | TableDef<unknown>,
    primaryKey?:        TPk,
  ): Promise<Map<unknown, unknown>> {
    // Name-based path: no primaryKey arg
    if (primaryKey === undefined) {
      return this._loadRelationByName(
        parents,
        keyOrRelationName,
        tableOrSource as TableDef<unknown>,
        'many',
      )
    }

    // Explicit path — original behaviour
    const foreignKey = keyOrRelationName as TFk
    const childTable = tableOrSource as TableDef<TChild>
    const result = new Map<TParent[TFk], TChild[]>()
    if (parents.length === 0) return result

    const ids = [...new Set(parents.map((p) => p[foreignKey]))]
    const children = await this.from(childTable)
      .where({ [primaryKey]: { op: 'IN', value: ids } } as WhereInput<TChild>)
      .select()

    for (const child of children) {
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
   * Two call forms:
   *
   * @example — explicit (original)
   * const authorMap = await db.loadRelationOne(posts, 'authorId', usersTable, 'id')
   *
   * @example — name-based
   * const authorMap = await db.loadRelationOne(posts, 'author', postsTable)
   */
  // Overload 1 — explicit
  loadRelationOne<
    TParent extends Record<string, unknown>,
    TChild,
    TFk extends keyof TParent & string,
    TPk extends keyof TChild & string,
  >(
    parents:    TParent[],
    foreignKey: TFk,
    childTable: TableDef<TChild>,
    primaryKey: TPk,
  ): Promise<Map<TParent[TFk], TChild>>
  // Overload 2 — name-based
  loadRelationOne<TParent extends Record<string, unknown>>(
    parents:      TParent[],
    relationName: string,
    sourceTable:  TableDef<any>,
  ): Promise<Map<unknown, unknown>>
  // Implementation
  async loadRelationOne<
    TParent extends Record<string, unknown>,
    TChild,
    TFk extends keyof TParent & string,
    TPk extends keyof TChild & string,
  >(
    parents:            TParent[],
    keyOrRelationName:  TFk | string,
    tableOrSource:      TableDef<TChild> | TableDef<unknown>,
    primaryKey?:        TPk,
  ): Promise<Map<unknown, unknown>> {
    // Name-based path
    if (primaryKey === undefined) {
      return this._loadRelationByName(
        parents,
        keyOrRelationName,
        tableOrSource as TableDef<unknown>,
        'one',
      )
    }

    // Explicit path — original behaviour
    const foreignKey = keyOrRelationName as TFk
    const childTable = tableOrSource as TableDef<TChild>
    const result = new Map<TParent[TFk], TChild>()
    if (parents.length === 0) return result

    const ids = [...new Set(parents.map((p) => p[foreignKey]))]
    const children = await this.from(childTable)
      .where({ [primaryKey]: { op: 'IN', value: ids } } as WhereInput<TChild>)
      .select()

    for (const child of children) {
      result.set(child[primaryKey] as unknown as TParent[TFk], child)
    }
    return result
  }

  /**
   * Shared implementation for name-based loadRelation / loadRelationOne.
   * Reads RelationMeta from sourceTable.relations, validates the kind,
   * and delegates to the explicit overload.
   */
  private async _loadRelationByName(
    parents:       Record<string, unknown>[],
    relationName:  string,
    sourceTable:   TableDef<unknown>,
    mode:          'many' | 'one',
  ): Promise<Map<unknown, unknown>> {
    const rel = sourceTable.relations[relationName] as RelationMeta | undefined

    if (rel === undefined) {
      const available = Object.keys(sourceTable.relations).join(', ') || '(none)'
      throw new Error(
        `Relation '${relationName}' is not defined on table '${sourceTable.name}'. ` +
        `Available relations: ${available}`,
      )
    }

    if (rel.kind === 'manyToMany') {
      throw new Error(
        `manyToMany relations are not yet supported in loadRelation. ` +
        `Use a manual JOIN for relation '${relationName}' on table '${sourceTable.name}'.`,
      )
    }

    if (mode === 'one' && rel.kind === 'hasMany') {
      throw new Error(
        `loadRelationOne cannot be used with hasMany relation '${relationName}' on table '${sourceTable.name}'. ` +
        `Use loadRelation to get an array of results.`,
      )
    }

    const foreignTable = rel.getTable()
    const pk = foreignTable.primaryKey as string

    if (rel.kind === 'belongsTo') {
      // FK is on the parent (source) table; PK is on the foreign table.
      // We cast to the explicit overload signature — runtime is correct,
      // TypeScript can't narrow keyof unknown here.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ft = foreignTable as TableDef<any>
      const fk = rel.foreignKey as keyof typeof parents[0] & string
      if (mode === 'one') {
        return this.loadRelationOne(parents, fk, ft, pk)
      }
      return this.loadRelation(parents, fk, ft, pk)
    }

    // hasMany: FK is on the foreign table; we group by FK value
    // parents is keyed by their PK, foreign rows have rel.foreignKey pointing back
    const parentPk = sourceTable.primaryKey as string
    const result = new Map<unknown, unknown[]>()
    if (parents.length === 0) return result

    const ids = [...new Set(parents.map((p) => p[parentPk]))]
    const children = await this.from(foreignTable)
      .where({ [rel.foreignKey]: { op: 'IN', value: ids } } as WhereInput<typeof foreignTable>)
      .select()

    for (const child of children as Record<string, unknown>[]) {
      const key = child[rel.foreignKey]
      const group = result.get(key)
      if (group) {
        group.push(child)
      } else {
        result.set(key, [child])
      }
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

export class SelectBuilder<T, S extends SchemaMap, TRelations extends RelationsMap = RelationsMap> {
  constructor(
    private readonly adapter: VelnAdapter,
    private readonly hooks: HookExecutor,
    private readonly ctx: unknown,
    private readonly queue: RequestEventQueue | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly table: TableDef<T, S, any, TRelations>,
    private readonly conditions: WhereInput<T>,
    private readonly _options: SelectOptions = {},
    // Raw SQL fragments appended with AND. Each entry is { sql, params }.
    private readonly _rawWhere: { sql: string; params: BindingValue[] }[] = [],
    private readonly _dialect: SqlDialect = 'sqlite',
    private readonly _withRelations: string[] = [],
    // When true, the soft-delete IS NULL filter is skipped.
    private readonly _includeDeleted: boolean = false,
  ) {}

  private _cloneWith(
    conditions: WhereInput<T>,
    rawWhere?: { sql: string; params: BindingValue[] }[],
  ): SelectBuilder<T, S, TRelations> {
    return new SelectBuilder<T, S, TRelations>(
      this.adapter,
      this.hooks,
      this.ctx,
      this.queue,
      this.table,
      conditions,
      this._options,
      rawWhere ?? this._rawWhere,
      this._dialect,
      this._withRelations,
      this._includeDeleted,
    )
  }

  private _clone(patch: Partial<SelectOptions>): SelectBuilder<T, S, TRelations> {
    return new SelectBuilder<T, S, TRelations>(
      this.adapter,
      this.hooks,
      this.ctx,
      this.queue,
      this.table,
      this.conditions,
      { ...this._options, ...patch },
      this._rawWhere,
      this._dialect,
      this._withRelations,
      this._includeDeleted,
    )
  }

  /**
   * Eager-load relations alongside the main query.
   * One additional IN-query per relation — never N+1 regardless of row count.
   *
   * @example
   * const posts = await db.from(postsTable).with({ author: true }).select()
   * posts[0].author  // → User | null  (fully typed)
   * posts[0].title   // → string       (original fields preserved)
   */
  with<Keys extends keyof TRelations & string>(
    relations: { [K in Keys]: true },
  ): SelectBuilder<WithRelations<T, { relations: TRelations }, Keys>, S, TRelations> {
    const keys = Object.keys(relations) as Keys[]
    return new SelectBuilder<WithRelations<T, { relations: TRelations }, Keys>, S, TRelations>(
      this.adapter,
      this.hooks,
      this.ctx,
      this.queue,
      // table type cast: the schema/relations are unchanged; only T changes in the generic
      this.table as unknown as TableDef<WithRelations<T, { relations: TRelations }, Keys>, S, any, TRelations>,
      this.conditions as unknown as WhereInput<WithRelations<T, { relations: TRelations }, Keys>>,
      this._options,
      this._rawWhere,
      this._dialect,
      [...this._withRelations, ...keys],
      this._includeDeleted,
    )
  }

  /**
   * Include soft-deleted rows in the query result.
   * By default, tables with `.withSoftDelete()` automatically exclude rows
   * where the soft-delete column is not null.
   *
   * Has no effect on tables without soft delete configured.
   *
   * @example
   * const allUsers = await db.from(usersTable).withDeleted().select()
   */
  withDeleted(): SelectBuilder<T, S, TRelations> {
    return new SelectBuilder<T, S, TRelations>(
      this.adapter,
      this.hooks,
      this.ctx,
      this.queue,
      this.table,
      this.conditions,
      this._options,
      this._rawWhere,
      this._dialect,
      this._withRelations,
      true,
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
  where(conditions: WhereInput<T>): SelectBuilder<T, S, TRelations> {
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
  whereRaw(sql: string, params: BindingValue[]): SelectBuilder<T, S, TRelations> {
    return this._cloneWith(this.conditions, [...this._rawWhere, { sql, params }])
  }

  /**
   * Apply SELECT DISTINCT — deduplicate rows in the result set.
   * Combine with `.columns()` to deduplicate on specific columns.
   *
   * @example
   * await db.from(usersTable).columns('name').distinct().select()
   * // → SELECT DISTINCT "name" FROM "users"
   */
  distinct(): SelectBuilder<T, S, TRelations> {
    return this._clone({ distinct: true })
  }

  /** Limit the number of rows returned. Bound as a parameter — never interpolated. */
  limit(n: number): SelectBuilder<T, S, TRelations> {
    return this._clone({ limit: n })
  }

  /** Skip the first n rows. Bound as a parameter — never interpolated. */
  offset(n: number): SelectBuilder<T, S, TRelations> {
    return this._clone({ offset: n })
  }

  /** Add an ORDER BY clause. Multiple calls accumulate in order. */
  orderBy(col: keyof T & string, dir: 'ASC' | 'DESC' = 'ASC'): SelectBuilder<T, S, TRelations> {
    const existing = this._options.orderBy ?? []
    return this._clone({ orderBy: [...existing, { col, dir }] })
  }

  /**
   * Convenience helper for cursor-based pagination.
   * page(1, 10) → LIMIT 10 OFFSET 0
   * page(2, 10) → LIMIT 10 OFFSET 10
   */
  page(page: number, size: number): SelectBuilder<T, S, TRelations> {
    return this._clone({ limit: size, offset: (page - 1) * size })
  }

  /**
   * Restrict which columns are returned.
   *
   * Single-column form returns a ColumnRestrictedBuilder, enabling .subquery():
   *   db.from(usersTable).columns('id').subquery()  // → SubqueryResult<'id', number>
   *
   * Multi-column form returns a narrowed SelectBuilder:
   *   db.from(usersTable).columns('id', 'name')  // → SelectBuilder<Pick<User, 'id'|'name'>, ...>
   */
  columns<K extends keyof T & string>(col: K): ColumnRestrictedBuilder<K, T[K], S, TRelations>
  columns<K extends keyof T & string>(...cols: K[]): SelectBuilder<Pick<T, K>, S, TRelations>
  columns<K extends keyof T & string>(...cols: K[]): SelectBuilder<Pick<T, K>, S, TRelations> | ColumnRestrictedBuilder<K, T[K], S, TRelations> {
    const cloned = this._clone({ columns: cols }) as unknown as SelectBuilder<unknown, S, TRelations>
    if (cols.length === 1) {
      return new ColumnRestrictedBuilder<K, T[K], S, TRelations>(cloned, cols[0]!)
    }
    return cloned as unknown as SelectBuilder<Pick<T, K>, S, TRelations>
  }

  /**
   * Build SELECT SQL + params without executing the query.
   * Used internally by ColumnRestrictedBuilder.subquery().
   */
  /** Internal accessor for ColumnRestrictedBuilder / UnionBuilder — returns the adapter. */
  _getAdapter(): VelnAdapter { return this.adapter }
  /** Internal accessor for ColumnRestrictedBuilder / UnionBuilder — returns the SQL dialect. */
  _getDialect(): SqlDialect { return this._dialect }

  /**
   * Returns the effective WHERE conditions, injecting the soft-delete IS NULL
   * filter when the table has a soft-delete column and .withDeleted() was not called.
   */
  private _effectiveConditions(): WhereInput<T> {
    const col = this.table.softDeleteColumn
    if (col === null || this._includeDeleted) return this.conditions
    const softFilter = { [col]: { op: 'IS NULL' } } as WhereInput<T>
    return mergeWhereAnd(this.conditions, softFilter)
  }

  _buildSelectSQL(): { sql: string; params: BindingValue[] } {
    const conditions = mapWhere(this._effectiveConditions(), this.table.schema)
    if (this._rawWhere.length === 0) {
      return buildSelect(
        this.table.name,
        conditions,
        this._options,
        this._dialect,
      )
    }
    // Raw WHERE path — mirrors select() logic but without executing
    const { sql: whereSql, params: whereParams } = buildWhere(
      conditions,
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
    const selectList = buildSelectListFromOptions(this._options)
    const selectKeyword = this._options.distinct ? 'SELECT DISTINCT' : 'SELECT'
    const parts: string[] = [
      combinedWhere
        ? `${selectKeyword} ${selectList} FROM "${this.table.name}" WHERE ${combinedWhere}`
        : `${selectKeyword} ${selectList} FROM "${this.table.name}"`,
    ]
    if (this._options.orderBy && this._options.orderBy.length > 0) {
      const clause = this._options.orderBy.map(({ col, dir }) => `"${col}" ${dir}`).join(', ')
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
    return { sql: parts.join(' '), params: allParams }
  }

  /**
   * Add a GROUP BY clause. Multiple columns are comma-separated.
   * Combine with .aggregate() to get grouped aggregate results.
   */
  groupBy(...cols: (keyof T & string)[]): SelectBuilder<T, S, TRelations> {
    return this._clone({ groupBy: cols as string[] })
  }

  /**
   * Add a HAVING clause — filters aggregate groups.
   * Uses the same WhereInput system as .where() (supports operators, OR/AND).
   *
   * @example
   * .groupBy('role').aggregate({ cnt: { fn: 'COUNT' } }).having({ cnt: { op: '>', value: 1 } })
   */
  having(conditions: WhereInput<Record<string, unknown>>): SelectBuilder<T, S, TRelations> {
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
      this._effectiveConditions() as WhereInput<Record<string, unknown>>,
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
      mapWhere(this._effectiveConditions(), this.table.schema),
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

    const effectiveConditions = mapWhere(this._effectiveConditions(), this.table.schema)
    if (this._rawWhere.length === 0) {
      // Fast path: no raw fragments — buildSelect handles everything
      const { sql, params } = buildSelect(
        this.table.name,
        effectiveConditions,
        this._options,
        this._dialect,
      )
      finalSql = sql
      finalParams = params
    } else {
      // Merge structured WHERE + raw fragments via AND, then bolt on options
      const { sql: whereSql, params: whereParams } = buildWhere(
        effectiveConditions,
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

    const rawRows = await this.adapter.query<Record<string, unknown>>(finalSql, finalParams)
    // When columns are restricted, only deserialize the selected columns
    let rows: T[]
    if (this._options.columns && this._options.columns.length > 0) {
      rows = rawRows as unknown as T[]
    } else {
      rows = rawRows.map((row) => deserializeRow(this.table, row))
    }

    if (this._withRelations.length === 0) return rows
    return this._executeWith(rows)
  }

  async first(): Promise<T | null> {
    const rows = await this.select()
    return rows[0] ?? null
  }

  // ── Eager loading — _executeWith ────────────────────────────────────────

  private async _executeWith(rows: T[]): Promise<T[]> {
    if (rows.length === 0) return rows

    const mutableRows = rows.map((r) => ({ ...(r as Record<string, unknown>) })) as T[]

    for (const relationName of this._withRelations) {
      const meta = this.table.relations[relationName] as RelationMeta | undefined
      if (!meta) continue

      if (meta.kind === 'manyToMany') {
        throw new Error(
          `manyToMany eager loading is not yet supported. ` +
          `Use loadRelation manually for relation '${relationName}'.`,
        )
      }

      if (meta.kind === 'belongsTo') {
        await this._attachBelongsTo(mutableRows as Record<string, unknown>[], relationName, meta)
      } else if (meta.kind === 'hasMany') {
        await this._attachHasMany(mutableRows as Record<string, unknown>[], relationName, meta)
      }
    }

    return mutableRows
  }

  private async _attachBelongsTo(
    rows:         Record<string, unknown>[],
    relationName: string,
    meta:         RelationMeta,
  ): Promise<void> {
    const foreignTable = meta.getTable()
    const fkValues = rows
      .map((r) => r[meta.foreignKey])
      .filter((v): v is BindingValue => v !== null && v !== undefined)

    if (fkValues.length === 0) {
      for (const r of rows) r[relationName] = null
      return
    }

    const uniqueFkValues = [...new Set(fkValues)]
    const pk = foreignTable.primaryKey as string
    const baseConditions: Record<string, unknown> = { [pk]: { op: 'IN', value: uniqueFkValues } }
    if (foreignTable.softDeleteColumn !== null) {
      baseConditions[foreignTable.softDeleteColumn as string] = { op: 'IS NULL' }
    }
    const { sql, params } = buildSelect(
      foreignTable.name,
      baseConditions as WhereInput<Record<string, unknown>>,
      {},
      this._dialect,
    )
    const related = await this.adapter.query<Record<string, unknown>>(sql, params)
    const relatedMap = new Map<unknown, unknown>()
    for (const r of related) {
      relatedMap.set(r[pk], deserializeRow(foreignTable, r))
    }

    for (const r of rows) {
      r[relationName] = relatedMap.get(r[meta.foreignKey]) ?? null
    }
  }

  private async _attachHasMany(
    rows:         Record<string, unknown>[],
    relationName: string,
    meta:         RelationMeta,
  ): Promise<void> {
    const foreignTable = meta.getTable()
    const pk = this.table.primaryKey as string
    const pkValues = rows.map((r) => r[pk]).filter((v): v is BindingValue => v !== null && v !== undefined)

    if (pkValues.length === 0) {
      for (const r of rows) r[relationName] = []
      return
    }

    const hasManyConditions: Record<string, unknown> = { [meta.foreignKey]: { op: 'IN', value: pkValues } }
    if (foreignTable.softDeleteColumn !== null) {
      hasManyConditions[foreignTable.softDeleteColumn as string] = { op: 'IS NULL' }
    }
    const { sql, params } = buildSelect(
      foreignTable.name,
      hasManyConditions as WhereInput<Record<string, unknown>>,
      {},
      this._dialect,
    )
    const related = await this.adapter.query<Record<string, unknown>>(sql, params)

    const grouped = new Map<unknown, unknown[]>()
    for (const pkVal of pkValues) grouped.set(pkVal, [])

    for (const r of related) {
      const fkVal = r[meta.foreignKey]
      const deserialized = deserializeRow(foreignTable, r)
      const group = grouped.get(fkVal)
      if (group) {
        group.push(deserialized)
      } else {
        grouped.set(fkVal, [deserialized])
      }
    }

    for (const r of rows) {
      r[relationName] = grouped.get(r[pk]) ?? []
    }
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
    const pkSqlName = this.table.schema[pk as string]?.def.columnName ?? (pk as string)
    const { sql, params } = buildUpdate(
      this.table.name,
      mapDataToSql(finalPatch as Record<string, unknown>, this.table.schema),
      pkSqlName,
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

  /**
   * Update multiple rows atomically inside a single transaction.
   * Each row must include the primary key. beforeUpdate and afterUpdate hooks
   * run per row. If any row fails, the entire transaction rolls back.
   *
   * @example
   * const updated = await db.from(usersTable).updateMany([
   *   { id: 1, name: 'Alice Updated' },
   *   { id: 2, role: 'admin' },
   * ])
   */
  async updateMany(rows: InferUpdate<S>[]): Promise<T[]> {
    if (rows.length === 0) return []

    const pk = this.table.primaryKey

    const results: T[] = await this.adapter.transaction(async (txAdapter) => {
      // Build a transaction-scoped SelectBuilder that uses the tx adapter
      const txQueue = new RequestEventQueue()
      const inner: T[] = []

      for (const row of rows) {
        const pkValue = (row as Record<string, unknown>)[pk as string]
        if (pkValue === undefined || pkValue === null) {
          throw new Error(
            `updateMany: row is missing primary key "${pk as string}" — every row must include the PK`,
          )
        }

        // Load current row via the tx adapter (so read is within the same TX)
        const pkSqlName = this.table.schema[pk as string]?.def.columnName ?? (pk as string)
        const selectSql = `SELECT * FROM "${this.table.name}" WHERE "${pkSqlName}" = ?`
        const currentRows = await txAdapter.query<Record<string, unknown>>(selectSql, [pkValue as BindingValue])
        if (currentRows.length === 0) {
          throw new Error(`updateMany: record with ${pk as string}=${String(pkValue)} not found`)
        }
        const current = deserializeRow(this.table, currentRows[0]!)

        // Extract patch — everything except the PK
        const { [pk as string]: _pk, ...patchWithoutPk } = row as Record<string, unknown>
        const patch = patchWithoutPk as Partial<T>

        // Run beforeUpdate hooks (may transform patch)
        const finalPatch = await this.hooks.runBeforeUpdate(this.table, this.ctx, current, patch)

        // Execute UPDATE
        const { sql, params } = buildUpdate(
          this.table.name,
          mapDataToSql(finalPatch as Record<string, unknown>, this.table.schema),
          pk,
          pkValue as BindingValue,
        )
        await txAdapter.execute(sql, params)

        // Construct updated result
        const updatedRow: Record<string, unknown> = {
          ...(current as Record<string, unknown>),
          ...(finalPatch as Record<string, unknown>),
        }
        const result = deserializeRow(this.table, updatedRow)

        // Run afterUpdate hooks — collect into txQueue
        await this.hooks.runAfterUpdate(this.table, this.ctx, result, current, txQueue)

        inner.push(result)
      }

      return inner
    })

    return results
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
    const pkSqlName = this.table.schema[pk as string]?.def.columnName ?? (pk as string)
    const { sql, params } = buildDelete(this.table.name, pkSqlName, pkValue)
    await this.adapter.execute(sql, params)

    // Run afterDelete hooks — events collected into queue, not emitted immediately
    await this.hooks.runAfterDelete(this.table, this.ctx, current, this.queue)

    return current
  }

  /**
   * Soft-delete rows by setting the soft-delete column to the current timestamp.
   * The table must have `.withSoftDelete()` configured — throws otherwise (at execute() time).
   *
   * Does NOT call beforeUpdate/afterUpdate hooks.
   * Without .where(), all rows in the table are soft-deleted.
   *
   * @example
   * await db.from(usersTable).softDelete().where({ id: 1 }).execute()
   */
  softDelete(): SoftDeleteBuilder<T, S> {
    return new SoftDeleteBuilder<T, S>(this.adapter, this.table, new Date(), this._dialect)
  }

  /**
   * Restore soft-deleted rows by setting the soft-delete column back to null.
   * The table must have `.withSoftDelete()` configured — throws otherwise (at execute() time).
   *
   * @example
   * await db.from(usersTable).restore().where({ id: 1 }).execute()
   */
  restore(): SoftDeleteBuilder<T, S> {
    return new SoftDeleteBuilder<T, S>(this.adapter, this.table, null, this._dialect)
  }
}

// ── ColumnRestrictedBuilder ────────────────────────────────────────────────
// Returned by SelectBuilder.columns(singleCol). Exposes only the ops needed
// to build a subquery: .where(), .limit(), .orderBy(), and .subquery().
// .select(), .with(), .update(), .delete() are intentionally absent.

export class ColumnRestrictedBuilder<Col extends string, TCol, S extends SchemaMap, TRelations extends RelationsMap> {
  // _builder is typed as SelectBuilder<unknown, ...> to avoid variance issues
  // when constructing from SelectBuilder<Pick<T,K>, ...> — the runtime shape is identical.
  constructor(
    private readonly _builder: SelectBuilder<unknown, S, TRelations>,
    private readonly _col: Col,
  ) {}

  where(conditions: WhereInput<Record<string, unknown>>): ColumnRestrictedBuilder<Col, TCol, S, TRelations> {
    return new ColumnRestrictedBuilder<Col, TCol, S, TRelations>(
      this._builder.where(conditions),
      this._col,
    )
  }

  limit(n: number): ColumnRestrictedBuilder<Col, TCol, S, TRelations> {
    return new ColumnRestrictedBuilder<Col, TCol, S, TRelations>(
      this._builder.limit(n),
      this._col,
    )
  }

  orderBy(col: Col, dir: 'ASC' | 'DESC' = 'ASC'): ColumnRestrictedBuilder<Col, TCol, S, TRelations> {
    return new ColumnRestrictedBuilder<Col, TCol, S, TRelations>(
      // _builder is SelectBuilder<unknown,...> so keyof unknown = never;
      // col is a valid schema key at runtime — cast is safe.
      this._builder.orderBy(col as never, dir),
      this._col,
    )
  }

  /**
   * Build the SQL for this query as a subquery fragment.
   * The result can be used directly in WHERE IN / NOT IN conditions.
   *
   * @example
   * const activeIds = db.from(usersTable).columns('id').where({ active: true }).subquery()
   * // → SubqueryResult<'id', number>
   *
   * const posts = await db.from(postsTable)
   *   .where({ authorId: { op: 'IN', value: activeIds } })
   *   .select()
   */
  subquery(): SubqueryResult<Col, TCol> {
    const { sql, params } = this._builder._buildSelectSQL()
    return buildSubquery<Col, TCol>(sql, params, this._col)
  }

  /** Build raw SELECT SQL + params without parentheses (for UNION). */
  _buildRawSQL(): { sql: string; params: BindingValue[] } {
    return this._builder._buildSelectSQL()
  }

  /**
   * Combine this query with another same-type column query via UNION (deduplicates).
   * Both sides must produce the same column type — enforced at compile time.
   *
   * @example
   * db.from(usersTable).columns('id')
   *   .union(db.from(adminsTable).columns('id'))
   *   .select()
   */
  union(other: ColumnRestrictedBuilder<string, TCol, SchemaMap, RelationsMap>): UnionBuilder<TCol> {
    return new UnionBuilder<TCol>(
      [this._buildRawSQL(), other._buildRawSQL()],
      'UNION',
      this._builder._getAdapter(),
      this._builder._getDialect(),
    )
  }

  /**
   * Combine via UNION ALL — keeps duplicate rows.
   */
  unionAll(other: ColumnRestrictedBuilder<string, TCol, SchemaMap, RelationsMap>): UnionBuilder<TCol> {
    return new UnionBuilder<TCol>(
      [this._buildRawSQL(), other._buildRawSQL()],
      'UNION ALL',
      this._builder._getAdapter(),
      this._builder._getDialect(),
    )
  }
}

// ── SoftDeleteBuilder ─────────────────────────────────────────────────────
// Returned by SelectBuilder.softDelete() and SelectBuilder.restore().
// Accepts .where() for scoping, then .execute() to run the UPDATE.
// Does NOT call beforeUpdate/afterUpdate hooks — soft delete is a system operation.

export class SoftDeleteBuilder<T, S extends SchemaMap> {
  private _conditions: WhereInput<T> = {} as WhereInput<T>

  constructor(
    private readonly adapter:   VelnAdapter,
    private readonly table:     TableDef<T, S>,
    private readonly _value:    Date | null,
    private readonly _dialect:  SqlDialect = 'sqlite',
  ) {}

  /**
   * Add WHERE conditions to scope which rows are soft-deleted / restored.
   * Multiple calls accumulate with AND.
   * Without .where(), all rows in the table are affected.
   */
  where(conditions: WhereInput<T>): this {
    this._conditions = mergeWhereAnd(this._conditions, conditions)
    return this
  }

  /**
   * Execute the soft-delete or restore UPDATE.
   * Throws if the table has no softDeleteColumn configured.
   */
  async execute(): Promise<void> {
    const col = this.table.softDeleteColumn
    if (col === null) {
      throw new Error(
        `softDelete() called on table '${this.table.name}' which has no soft delete column. ` +
        `Add .withSoftDelete('deletedAt') to the table definition.`,
      )
    }
    const colSqlName = this.table.schema[col as string]?.def.columnName ?? (col as string)
    const { sql, params } = buildSoftDeleteUpdate(
      this.table.name,
      colSqlName,
      this._value,
      mapWhere(this._conditions, this.table.schema),
      this._dialect,
    )
    await this.adapter.execute(sql, params)
  }
}

// ── UnionBuilder ──────────────────────────────────────────────────────────
// Returned by ColumnRestrictedBuilder.union() / .unionAll().
// Chains UNION / UNION ALL queries and executes them as a single query.

export class UnionBuilder<T> {
  private _orderBy?: { col: string; dir: 'ASC' | 'DESC' }
  private _limit?:   number

  constructor(
    private readonly _parts:   Array<{ sql: string; params: BindingValue[] }>,
    private readonly _kind:    'UNION' | 'UNION ALL',
    private readonly _adapter: VelnAdapter,
    private readonly _dialect: SqlDialect,
  ) {}

  /** Append another UNION (deduplicating) leg. */
  union(other: ColumnRestrictedBuilder<string, T, SchemaMap, RelationsMap>): UnionBuilder<T> {
    return new UnionBuilder<T>(
      [...this._parts, other._buildRawSQL()],
      'UNION',
      this._adapter,
      this._dialect,
    )
  }

  /** Append another UNION ALL (keep duplicates) leg. */
  unionAll(other: ColumnRestrictedBuilder<string, T, SchemaMap, RelationsMap>): UnionBuilder<T> {
    return new UnionBuilder<T>(
      [...this._parts, other._buildRawSQL()],
      'UNION ALL',
      this._adapter,
      this._dialect,
    )
  }

  /** Add ORDER BY to the entire UNION result. */
  orderBy(col: string, dir: 'ASC' | 'DESC' = 'ASC'): UnionBuilder<T> {
    const next = new UnionBuilder<T>(this._parts, this._kind, this._adapter, this._dialect)
    next._orderBy = { col, dir }
    next._limit   = this._limit
    return next
  }

  /** Add LIMIT to the entire UNION result. */
  limit(n: number): UnionBuilder<T> {
    const next = new UnionBuilder<T>(this._parts, this._kind, this._adapter, this._dialect)
    next._orderBy = this._orderBy
    next._limit   = n
    return next
  }

  /** Execute the UNION query and return typed rows. */
  async select(): Promise<Record<string, T>[]> {
    const { sql, params } = buildUnion(this._parts, this._kind, {
      orderBy: this._orderBy,
      limit:   this._limit,
    })
    return this._adapter.query<Record<string, T>>(sql, params)
  }

  /**
   * Build the UNION as a subquery — wrapped in parentheses.
   * Usable in WHERE IN / NOT IN conditions.
   *
   * @example
   * const adminOrModIds = db.from(usersTable).columns('id').where({ role: 'admin' })
   *   .union(db.from(usersTable).columns('id').where({ role: 'mod' }))
   *   .subquery()
   */
  subquery(): SubqueryResult<string, T> {
    const { sql, params } = buildUnion(this._parts, this._kind, {
      orderBy: this._orderBy,
      limit:   this._limit,
    })
    return buildSubquery<string, T>(sql, params, '')
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
    private readonly dialect: SqlDialect = 'sqlite',
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

  /**
   * Insert multiple rows in a single SQL statement.
   * beforeInsert and afterInsert hooks run per row.
   * Defaults (defaultFn / defaultValue) are applied per row.
   *
   * MySQL is not yet supported (no RETURNING *) — throws an informative error.
   *
   * @example
   * const users = await db.into(usersTable).insertMany([
   *   { name: 'Alice', email: 'alice@example.com' },
   *   { name: 'Bob',   email: 'bob@example.com' },
   * ])
   */
  async insertMany(data: InferInsert<S>[]): Promise<T[]> {
    if (data.length === 0) return []

    if (this.dialect === 'mysql') {
      throw new Error(
        'insertMany is not yet supported for MySQL — MySQL does not support RETURNING *. ' +
        'Use individual insert() calls inside a transaction() instead.',
      )
    }

    // Phase 1: run hooks + apply defaults + serialize — all before touching the adapter
    const serializedRows: Record<string, BindingValue>[] = []

    for (const row of data) {
      // a. beforeInsert hooks (may transform data)
      let processed: Partial<T> = await this.hooks.runBeforeInsert(
        this.table,
        this.ctx,
        { ...row } as Partial<T>,
      )

      // b. Apply defaultFns and defaultValues for unset fields
      for (const [field, col] of Object.entries(this.table.schema)) {
        if (col.def.primaryKey && col.def.autoIncrement) continue
        if ((processed as Record<string, unknown>)[field] === undefined) {
          if (col.def.defaultFn !== undefined) {
            ;(processed as Record<string, unknown>)[field] = col.def.defaultFn()
          } else if (col.def.defaultValue !== undefined) {
            ;(processed as Record<string, unknown>)[field] = col.def.defaultValue
          }
        }
      }

      // c. Serialize (Date → ISO string), cast to BindingValue[] — undefined already removed
      const serialized = this._serializeForInsert(processed as Record<string, unknown>)
      serializedRows.push(serialized as Record<string, BindingValue>)
    }

    // Phase 2: single INSERT … VALUES (…), (…) RETURNING *
    const { sql, params } = buildInsertMany(this.table.name, serializedRows, true)
    const rawRows = await this.adapter.query<Record<string, unknown>>(sql, params)

    // Phase 3: deserialize results + run afterInsert hooks per row
    const results: T[] = []
    for (const rawRow of rawRows) {
      const deserialized = deserializeRow(this.table, rawRow)
      await this.hooks.runAfterInsert(this.table, this.ctx, deserialized, {}, this.queue)
      results.push(deserialized)
    }

    return results
  }

  /** Serialize values for storage. Maps JS keys → SQL column names. Date → ISO string. Drops undefined. */
  private _serializeForInsert(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [jsKey, val] of Object.entries(data)) {
      if (val === undefined) continue
      const col = this.table.schema[jsKey]
      const sqlName = col?.def.columnName ?? jsKey
      result[sqlName] = val instanceof Date ? val.toISOString() : val
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
