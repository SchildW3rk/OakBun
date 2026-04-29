import type { OakBunAdapter, BindingValue, ExecuteResult, QueryLogEntry } from './types'

export interface PostgresConfig {
  url: string
  max?: number
  idleTimeout?: number
}

// Bun.SQL.unsafe() requires $1, $2, ... positional placeholders — not the ? style
// used by SQLite. Convert before every call.
function toPositional(sql: string): string {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

// When there are no params, call unsafe(sql) without a second argument.
// Passing an empty array causes Bun.SQL to parse the SQL for placeholders,
// which misinterprets commas inside type expressions like NUMERIC(12,2).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unsafeCall(client: any, sql: string, params: BindingValue[]): any {
  const positional = toPositional(sql)
  return params.length > 0
    ? client.unsafe(positional, params)
    : client.unsafe(positional)
}

export class PostgresAdapter implements OakBunAdapter {
  readonly dialect = 'postgres' as const
  // Typed as any: Bun.SQL's instance type is not reliably exported across
  // bun-types versions and the class is a Bun global — no stable import path.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly sql: any
  onQuery?: (entry: QueryLogEntry) => void

  constructor(config: PostgresConfig) {
    if (config.max !== undefined && config.max < 1) {
      throw new Error(`PostgresAdapter: max connections must be at least 1, got ${config.max}`)
    }
    // Set DATABASE_URL if not already set — Bun.sql reads from environment
    if (!process.env['DATABASE_URL']) {
      process.env['DATABASE_URL'] = config.url
    }
    // @ts-ignore — Bun.SQL is a Bun global constructor, not in all bun-types versions
    this.sql = new Bun.SQL(config.url, {
      max: config.max ?? 10,
      idleTimeout: config.idleTimeout ?? 30,
    })
  }

  async query<T>(sql: string, params: BindingValue[] = []): Promise<T[]> {
    const t0 = performance.now()
    const rows = await unsafeCall(this.sql, sql, params) as T[]
    this.onQuery?.({ sql, params, durationMs: performance.now() - t0, type: 'query' })
    return rows
  }

  async execute(sql: string, params: BindingValue[] = []): Promise<ExecuteResult> {
    const t0 = performance.now()
    const result = await unsafeCall(this.sql, sql, params)
    this.onQuery?.({ sql, params, durationMs: performance.now() - t0, type: 'execute' })
    const rowsAffected = typeof result?.count === 'number' ? result.count : (result?.length ?? 0)
    return { rowsAffected }  // lastInsertId not available without RETURNING clause
  }

  async transaction<T>(fn: (tx: OakBunAdapter) => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx: any) => {
      const txAdapter: OakBunAdapter = {
        dialect:     'postgres',
        query:       (s, p = []) => unsafeCall(tx, s, p),
        execute:     async (s, p = []) => {
          const r = await unsafeCall(tx, s, p)
          const rowsAffected = typeof r?.count === 'number' ? r.count : (r?.length ?? 0)
          return { rowsAffected }
        },
        transaction: (innerFn) => innerFn(txAdapter),  // nested: reuse same tx
        close:       async () => {},                    // no-op inside transaction
      }
      return fn(txAdapter)
    })
  }

  async close(): Promise<void> {
    await this.sql.end?.()
  }
}
