import type { VelnAdapter } from '../../adapter/types'
import type { MigrationRecord } from './types'

const CREATE_TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS "_veln_migrations" (
    "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
    "name"       TEXT NOT NULL UNIQUE,
    "applied_at" TEXT NOT NULL
  )
`

export async function ensureTable(adapter: VelnAdapter, tableName: string): Promise<void> {
  const sql = CREATE_TRACKING_TABLE.replace('"_veln_migrations"', `"${tableName}"`)
  await adapter.execute(sql)
}

export async function getApplied(adapter: VelnAdapter, tableName: string): Promise<MigrationRecord[]> {
  const rows = await adapter.query<{ id: number; name: string; applied_at: string }>(
    `SELECT "id", "name", "applied_at" FROM "${tableName}" ORDER BY "id" ASC`,
  )
  return rows.map(r => ({
    id:        r.id,
    name:      r.name,
    appliedAt: new Date(r.applied_at),
  }))
}

export async function markApplied(adapter: VelnAdapter, tableName: string, name: string): Promise<void> {
  await adapter.execute(
    `INSERT INTO "${tableName}" ("name", "applied_at") VALUES (?, ?)`,
    [name, new Date().toISOString()],
  )
}

export async function markRolledBack(adapter: VelnAdapter, tableName: string, name: string): Promise<void> {
  await adapter.execute(
    `DELETE FROM "${tableName}" WHERE "name" = ?`,
    [name],
  )
}
