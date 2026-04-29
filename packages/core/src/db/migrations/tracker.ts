import type { OakBunAdapter } from '../../adapter/types'
import type { MigrationRecord } from './types'

function buildCreateTableSql(tableName: string, dialect: OakBunAdapter['dialect']): string {
  const pk = dialect === 'sqlite'
    ? '"id" INTEGER PRIMARY KEY AUTOINCREMENT'
    : '"id" INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY'

  return `
    CREATE TABLE IF NOT EXISTS "${tableName}" (
      ${pk},
      "name"       TEXT NOT NULL UNIQUE,
      "applied_at" TEXT NOT NULL
    )
  `
}

export async function ensureTable(adapter: OakBunAdapter, tableName: string): Promise<void> {
  const sql = buildCreateTableSql(tableName, adapter.dialect)
  await adapter.execute(sql)
}

export async function getApplied(adapter: OakBunAdapter, tableName: string): Promise<MigrationRecord[]> {
  const rows = await adapter.query<{ id: number; name: string; applied_at: string }>(
    `SELECT "id", "name", "applied_at" FROM "${tableName}" ORDER BY "id" ASC`,
  )
  return rows.map(r => ({
    id:        r.id,
    name:      r.name,
    appliedAt: new Date(r.applied_at),
  }))
}

export async function markApplied(adapter: OakBunAdapter, tableName: string, name: string): Promise<void> {
  await adapter.execute(
    `INSERT INTO "${tableName}" ("name", "applied_at") VALUES (?, ?)`,
    [name, new Date().toISOString()],
  )
}

export async function markRolledBack(adapter: OakBunAdapter, tableName: string, name: string): Promise<void> {
  await adapter.execute(
    `DELETE FROM "${tableName}" WHERE "name" = ?`,
    [name],
  )
}
