import type { OakBunAdapter } from './types'

export type AdapterConfig =
  | { adapter: 'sqlite';   path?: string }
  | { adapter: 'postgres'; connectionString: string; maxConnections?: number }
  | { adapter: 'mysql';    connectionString: string; maxConnections?: number }

export function isOakBunAdapter(value: unknown): value is OakBunAdapter {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as OakBunAdapter).query   === 'function' &&
    typeof (value as OakBunAdapter).execute === 'function'
  )
}

export function resolveAdapter(config: AdapterConfig | OakBunAdapter): OakBunAdapter {
  if (isOakBunAdapter(config)) return config

  const cfg = config as AdapterConfig

  if (cfg.adapter === 'sqlite') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SQLiteAdapter } = require('./sqlite') as typeof import('./sqlite')
    return new SQLiteAdapter(cfg.path ? { path: cfg.path } : { path: './db.sqlite' })
  }

  if (cfg.adapter === 'postgres') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PostgresAdapter } = require('./postgres') as typeof import('./postgres')
    return new PostgresAdapter({ url: cfg.connectionString, max: cfg.maxConnections })
  }

  if (cfg.adapter === 'mysql') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MySQLAdapter } = require('./mysql') as typeof import('./mysql')
    return new MySQLAdapter({ url: cfg.connectionString, max: cfg.maxConnections })
  }

  throw new Error(`[oakbun] resolveAdapter: unknown adapter type "${(cfg as AdapterConfig & { adapter: string }).adapter}"`)
}
