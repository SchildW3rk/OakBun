// Supported SQL parameter binding values — matches bun:sqlite's SQLQueryBindings
// and is compatible with Bun.SQL's parameter types.
export type BindingValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | Uint8Array

export interface ExecuteResult {
  rowsAffected: number
  // Populated after INSERT — SQLite: lastInsertRowid, Postgres/MySQL: RETURNING id or similar.
  // Optional: adapters that cannot provide this leave it undefined.
  lastInsertId?: number | bigint
}

/** Emitted by the adapter after every query() or execute() call. */
export interface QueryLogEntry {
  /** The SQL string that was executed. */
  sql:        string
  /** The bound parameter values. */
  params:     BindingValue[]
  /** Wall-clock duration in milliseconds (performance.now() resolution). */
  durationMs: number
  /** Whether the call was query() (returns rows) or execute() (DML/DDL). */
  type:       'query' | 'execute'
}

export type AdapterDialect = 'sqlite' | 'postgres' | 'mysql'

export interface VelnAdapter {
  query<T = Record<string, unknown>>(sql: string, params?: BindingValue[]): Promise<T[]>
  execute(sql: string, params?: BindingValue[]): Promise<ExecuteResult>
  transaction<T>(fn: (tx: VelnAdapter) => Promise<T>): Promise<T>
  close(): Promise<void>
  /**
   * Dialect identifier — used by internal tooling (e.g. migrations) to emit
   * dialect-appropriate SQL. Set by each adapter implementation.
   */
  readonly dialect: AdapterDialect
  /**
   * Optional query observer. When set, the adapter calls this after every
   * query() and execute() with timing and SQL details.
   * Set by dbPlugin when query logging is enabled — do not call directly.
   */
  onQuery?: (entry: QueryLogEntry) => void
}
