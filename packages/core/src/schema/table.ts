import type { Column } from './column'

export type SchemaMap = Record<string, Column<any>>

// Full row type — what you get back from SELECT.
// Accepts either a SchemaMap directly or a TableDef (extracts its row type T).
export type InferRow<T> =
  T extends TableDef<infer R, any, any> ? R :
  T extends SchemaMap ? { [K in keyof T]: T[K] extends Column<infer C> ? C : never } :
  never

// Insert type — PK + defaulted columns are optional, rest required
type IsOptionalOnInsert<C extends Column<any>> =
  C['def']['primaryKey'] extends true ? true :
  C['def']['defaultValue'] extends undefined ?
    C['def']['defaultFn'] extends undefined ?
      C['def']['nullable'] extends true ? true : false
    : true
  : true

type InferInsertFromSchema<S extends SchemaMap> =
  {
    [K in keyof S as IsOptionalOnInsert<S[K]> extends true ? never : K]:
      S[K] extends Column<infer T> ? NonNullable<T> : never
  } & {
    [K in keyof S as IsOptionalOnInsert<S[K]> extends true ? K : never]?:
      S[K] extends Column<infer T> ? T : never
  }

// Accepts either a SchemaMap or a TableDef directly.
export type InferInsert<T> =
  T extends TableDef<any, infer S, any> ? InferInsertFromSchema<S> :
  T extends SchemaMap ? InferInsertFromSchema<T> :
  never

// Update type — all fields Partial, primary key fields required.
// Accepts either a SchemaMap or a TableDef directly.
export type InferUpdate<T> =
  T extends TableDef<infer R, infer S, any>
    ? Partial<R> & { [K in keyof S as S[K] extends Column<any> ? S[K]['def']['primaryKey'] extends true ? K : never : never]: R[K & keyof R] }
    : T extends SchemaMap
      ? Partial<{ [K in keyof T]: T[K] extends Column<infer C> ? C : never }>
      : never

// Convenience wrapper — one import gives all three shapes.
export type InferTable<T extends TableDef<any, any, any>> = {
  row:    InferRow<T>
  insert: InferInsert<T>
  update: InferUpdate<T>
}

// Table-level hook handlers — no ctx, always fire
export interface TableHookHandlers<T> {
  beforeInsert?: (data: Partial<T>) => Partial<T> | void | Promise<Partial<T> | void>
  afterInsert?:  (result: T, input: Partial<T>) => void | Promise<void>
  beforeUpdate?: (current: T, patch: Partial<T>) => Partial<T> | void | Promise<Partial<T> | void>
  afterUpdate?:  (result: T, before: T) => void | Promise<void>
  beforeDelete?: (current: T) => void | Promise<void>
  afterDelete?:  (deleted: T) => void | Promise<void>
}

// Event map — declared on the Table, enforced by the framework
export interface TableEventMap {
  afterInsert?: string   // event name to fire after insert
  afterUpdate?: string   // event name to fire after update
  afterDelete?: string   // event name to fire after delete
}

// Infer event payload types from a Table + EventMap.
//
// STAGING NOTE (Phase 3 → Phase 4):
// This type is fully computed here at the Table level. However, app.on() currently
// accepts `event: string` because TypeScript cannot recover these generic types after
// they pass through VelnModule (which erases them). In Phase 4, the RPC client and
// a dedicated app.onEvent<T>() overload will use InferTableEvents directly at the
// call site, without needing Declaration Merging. Until then, Declaration Merging
// via `interface VelnEvents {}` is the opt-in escape hatch for typed subscribers.
//
// Implementation note: three separate mapped types are intersected instead of using
// a conditional `K extends 'afterUpdate'` inside a single mapped type. The conditional
// form is deferred by TypeScript when K is generic, causing TMap[K] to resolve as a
// union of all value types at the call site. The intersection approach produces a
// concrete object type that TypeScript evaluates eagerly.
export type InferTableEvents<T, M extends TableEventMap> =
  (M['afterInsert'] extends string ? { [_ in M['afterInsert']]: T } : Record<never, never>) &
  (M['afterUpdate'] extends string ? { [_ in M['afterUpdate']]: { before: T; after: T } } : Record<never, never>) &
  (M['afterDelete'] extends string ? { [_ in M['afterDelete']]: T } : Record<never, never>)

// ── Relation Metadata ─────────────────────────────────────────────────────

export type RelationKind = 'belongsTo' | 'hasMany' | 'manyToMany'

/**
 * Metadata for a single declared relation.
 *
 * - `belongsTo`: FK lives on this table  (e.g. posts.authorId → users.id)
 * - `hasMany`:   FK lives on foreign table (e.g. users.id ← posts.authorId)
 * - `manyToMany`: join via pivot table
 *
 * `getTable` is a lazy getter to allow circular references between tables.
 */
export interface RelationMeta {
  kind:       RelationKind
  name:       string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTable:   () => TableDef<any, any, any>
  /** FK column name — on this table for belongsTo, on foreign table for hasMany */
  foreignKey: string
  /** manyToMany only */
  pivot?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table:      TableDef<any, any, any>
    localKey:   string
    foreignKey: string
  }
}

/** All declared relations on a table, keyed by relation name. */
export type RelationsMap = Record<string, RelationMeta>

export interface TableDef<T, S extends SchemaMap = SchemaMap, TEvents extends TableEventMap = TableEventMap> {
  readonly name: string
  readonly schema: S
  readonly primaryKey: keyof T & string
  readonly hooks: TableHookHandlers<T>[]
  readonly events: TEvents   // typed — not just TableEventMap
  // eventMap is the precomputed InferTableEvents<T, TEvents> shape.
  // Storing it as a concrete generic parameter (TMap) lets onEvent() index it
  // directly as TMap[K] without TypeScript deferring the conditional InferTableEvents.
  readonly _eventMap: InferTableEvents<T, TEvents>
  /** Declared relations — empty object when none are declared. */
  readonly relations: RelationsMap
}

export class TableBuilder<T, S extends SchemaMap, TEvents extends TableEventMap = Record<string, never>> {
  private readonly _hooks: TableHookHandlers<T>[] = []
  private _events: TableEventMap = {}
  private readonly _relations: RelationsMap = {}

  constructor(
    private readonly _name: string,
    private readonly _schema: S,
  ) {}

  // Register table-level hook (no ctx)
  hook(handlers: TableHookHandlers<T>): this {
    this._hooks.push(handlers)
    return this
  }

  emits<M extends TableEventMap>(map: M): TableBuilder<T, S, M> {
    const next = new TableBuilder<T, S, M>(this._name, this._schema)
    // copy existing hooks and relations
    for (const h of this._hooks) (next as unknown as TableBuilder<T, S>)._hooks.push(h)
    ;(next as unknown as TableBuilder<T, S>)._events = map
    for (const [k, v] of Object.entries(this._relations)) {
      ;(next as unknown as TableBuilder<T, S>)._relations[k] = v
    }
    return next
  }

  /**
   * Declare a belongs-to relation — FK lives on this table.
   *
   * @example
   * const postsTable = defineTable('posts', { authorId: column.integer() })
   *   .belongsTo('author', () => usersTable, 'authorId')
   *   .build()
   */
  belongsTo(
    name: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getTable: () => TableDef<any, any, any>,
    foreignKey: keyof T & string,
  ): this {
    if (name in this._relations) {
      throw new Error(`Relation '${name}' is already defined on table '${this._name}'`)
    }
    this._relations[name] = { kind: 'belongsTo', name, getTable, foreignKey }
    return this
  }

  /**
   * Declare a has-many relation — FK lives on the foreign table.
   *
   * @example
   * const usersTable = defineTable('users', { id: column.integer().primaryKey() })
   *   .hasMany('posts', () => postsTable, 'authorId')
   *   .build()
   */
  hasMany(
    name: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getTable: () => TableDef<any, any, any>,
    /** The FK column on the *foreign* table that points back to this table's PK. */
    foreignKey: string,
  ): this {
    if (name in this._relations) {
      throw new Error(`Relation '${name}' is already defined on table '${this._name}'`)
    }
    this._relations[name] = { kind: 'hasMany', name, getTable, foreignKey }
    return this
  }

  /**
   * Declare a many-to-many relation via a pivot table.
   *
   * @example
   * const postsTable = defineTable('posts', { ... })
   *   .manyToMany('tags', () => tagsTable, postTagsTable, 'postId', 'tagId')
   *   .build()
   */
  manyToMany(
    name: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getTable: () => TableDef<any, any, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pivotTable: TableDef<any, any, any>,
    /** FK on pivot pointing to this table's PK */
    localKey: string,
    /** FK on pivot pointing to the foreign table's PK */
    foreignKey: string,
  ): this {
    if (name in this._relations) {
      throw new Error(`Relation '${name}' is already defined on table '${this._name}'`)
    }
    this._relations[name] = {
      kind: 'manyToMany',
      name,
      getTable,
      foreignKey,
      pivot: { table: pivotTable, localKey, foreignKey },
    }
    return this
  }

  build(): TableDef<T, S, TEvents> {
    return {
      name: this._name,
      schema: this._schema,
      primaryKey: this._findPrimaryKey() as keyof T & string,
      hooks: [...this._hooks],  // copy — immutable after build
      events: { ...this._events } as unknown as TEvents,
      // _eventMap is typed as InferTableEvents<T, TEvents> — the concrete shape.
      // At runtime it's an empty object (events hold only the string names, not payloads).
      // The field exists solely so TypeScript can infer TMap in onEvent() without
      // recomputing the conditional InferTableEvents each time.
      _eventMap: {} as InferTableEvents<T, TEvents>,
      relations: { ...this._relations },  // copy — immutable after build
    }
  }

  private _findPrimaryKey(): string {
    for (const [key, col] of Object.entries(this._schema)) {
      if ((col as Column<any>).def.primaryKey) return key
    }
    return 'id'  // convention fallback
  }
}

export function defineTable<S extends SchemaMap>(
  name: string,
  schema: S,
): TableBuilder<InferRow<S>, S> {
  return new TableBuilder<InferRow<S>, S>(name, schema)
}

// Helper: generate CREATE TABLE SQL from a TableDef (SQLite dialect)
export function toCreateTableSql<T>(table: TableDef<T>): string {
  const cols = Object.entries(table.schema).map(([name, col]) => {
    const c = col as Column<any>
    let def = `"${name}" `

    switch (c.def.type) {
      case 'INTEGER':   def += 'INTEGER'; break
      case 'TEXT':
      case 'UUID':      def += 'TEXT'; break
      case 'REAL':      def += 'REAL'; break
      case 'BOOLEAN':   def += 'INTEGER'; break  // SQLite has no BOOLEAN
      case 'TIMESTAMP': def += 'TEXT'; break      // ISO string in SQLite
      case 'JSON':      def += 'TEXT'; break
      case 'BLOB':      def += 'BLOB'; break
    }

    if (c.def.primaryKey)    def += ' PRIMARY KEY'
    if (c.def.autoIncrement && c.def.type === 'INTEGER') def += ' AUTOINCREMENT'
    if (!c.def.nullable && !c.def.primaryKey) def += ' NOT NULL'
    if (c.def.unique)        def += ' UNIQUE'

    return def
  })

  return `CREATE TABLE IF NOT EXISTS "${table.name}" (${cols.join(', ')})`
}
