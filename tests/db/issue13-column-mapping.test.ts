import { describe, test, expect } from 'bun:test'
import { defineTable, column } from 'oakbun'
import { VelnDB } from '../../packages/core/src/db/index'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { HookExecutor } from '../../packages/core/src/hooks/executor'

const invoicesTable = defineTable('invoices_issue13', {
  id:        column.integer().primaryKey(),
  issueDate: column.text().name('issue_date'),
  createdAt: column.text().name('created_at'),
}).build()

function makeDb() {
  const adapter = new SQLiteAdapter(':memory:')
  const db = new VelnDB(adapter, new HookExecutor()).withCtx({} as any, undefined, undefined)
  return { adapter, db }
}

describe('issue #13 — .name() mapping for orderBy and operator WHERE', () => {
  test('orderBy JS key → SQL column name', async () => {
    const { adapter, db } = makeDb()
    await adapter.execute(`CREATE TABLE invoices_issue13 (id INTEGER PRIMARY KEY, issue_date TEXT, created_at TEXT)`)
    await adapter.execute(`INSERT INTO invoices_issue13 VALUES (1, '2026-01-15', '2026-01-15')`)
    await adapter.execute(`INSERT INTO invoices_issue13 VALUES (2, '2026-03-01', '2026-03-01')`)

    const sql = db.from(invoicesTable).orderBy('createdAt', 'DESC')._buildSelectSQL().sql
    expect(sql).toContain('"created_at"')
    expect(sql).not.toContain('"createdAt"')

    const rows = await db.from(invoicesTable).orderBy('createdAt', 'DESC').select()
    expect(rows[0]!.id).toBe(2)
    expect(rows[1]!.id).toBe(1)
    await adapter.close()
  })

  test('WHERE operator condition JS key → SQL column name', async () => {
    const { adapter, db } = makeDb()
    await adapter.execute(`CREATE TABLE invoices_issue13 (id INTEGER PRIMARY KEY, issue_date TEXT, created_at TEXT)`)
    await adapter.execute(`INSERT INTO invoices_issue13 VALUES (1, '2026-01-15', '2026-01-15')`)
    await adapter.execute(`INSERT INTO invoices_issue13 VALUES (2, '2026-03-01', '2026-03-01')`)

    const sql = db.from(invoicesTable).where({ issueDate: { op: '>=', value: '2026-02-01' } })._buildSelectSQL().sql
    expect(sql).toContain('"issue_date"')
    expect(sql).not.toContain('"issueDate"')

    const rows = await db.from(invoicesTable).where({ issueDate: { op: '>=', value: '2026-02-01' } }).select()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(2)
    await adapter.close()
  })
})
