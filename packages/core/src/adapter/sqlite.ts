import { Database } from 'bun:sqlite'
import type { OakBunAdapter, BindingValue, ExecuteResult, QueryLogEntry } from './types'

export interface SQLiteConfig {
  path?: string    // default ':memory:'
  wal?: boolean    // default true
}

// Maximum number of prepared statements cached per adapter instance.
// Prevents unbounded memory growth when queries are dynamically constructed.
const STMT_CACHE_MAX = 500

export class SQLiteAdapter implements OakBunAdapter {
  readonly dialect = 'sqlite' as const
  private readonly db: Database
  // LRU cache for prepared statements — Map preserves insertion order.
  // On cache hit: entry is moved to end (most recently used).
  // On cache full: oldest entry (front of Map) is evicted before inserting.
  private readonly _stmtCache = new Map<string, ReturnType<Database['prepare']>>()
  onQuery?: (entry: QueryLogEntry) => void

  constructor(config: SQLiteConfig | string = {}) {
    const path = typeof config === 'string' ? config : (config.path ?? ':memory:')
    const wal  = typeof config === 'string' ? true   : (config.wal  ?? true)

    this.db = new Database(path)
    if (wal) this.db.run('PRAGMA journal_mode = WAL')
    this.db.run('PRAGMA foreign_keys = ON')
  }

  private _prepare(sql: string): ReturnType<Database['prepare']> {
    const cached = this._stmtCache.get(sql)
    if (cached) {
      // LRU: move to end (most recently used)
      this._stmtCache.delete(sql)
      this._stmtCache.set(sql, cached)
      return cached
    }
    // Evict oldest entry if at capacity
    if (this._stmtCache.size >= STMT_CACHE_MAX) {
      const oldest = this._stmtCache.keys().next().value
      if (oldest !== undefined) this._stmtCache.delete(oldest)
    }
    const stmt = this.db.prepare(sql)
    this._stmtCache.set(sql, stmt)
    return stmt
  }

  async query<T>(sql: string, params: BindingValue[] = []): Promise<T[]> {
    const t0 = performance.now()
    const stmt = this._prepare(sql)
    const rows = stmt.all(...params) as T[]
    this.onQuery?.({ sql, params, durationMs: performance.now() - t0, type: 'query' })
    return rows
  }

  async execute(sql: string, params: BindingValue[] = []): Promise<ExecuteResult> {
    const t0 = performance.now()
    const stmt = this._prepare(sql)
    const result = stmt.run(...params)
    this.onQuery?.({ sql, params, durationMs: performance.now() - t0, type: 'execute' })
    // result.changes and lastInsertRowid can be bigint in some bun:sqlite versions
    const rowsAffected = typeof result.changes === 'bigint'
      ? Number(result.changes)
      : result.changes
    return {
      rowsAffected,
      lastInsertId: result.lastInsertRowid,
    }
  }

  async transaction<T>(fn: (tx: OakBunAdapter) => Promise<T>): Promise<T> {
    // Use db.run() directly — prepared statements for control statements (BEGIN/COMMIT/ROLLBACK)
    // are not reliable in SQLite; db.run() is the correct low-level API for these.
    this.db.run('BEGIN')
    try {
      const result = await fn(this)
      this.db.run('COMMIT')
      return result
    } catch (err) {
      this.db.run('ROLLBACK')
      throw err
    }
  }

  async close(): Promise<void> {
    this.db.close()
  }
}
