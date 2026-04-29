import { describe, test, expect } from 'bun:test'
import { SQLiteAdapter }    from '../../packages/core/src/adapter/sqlite'
import { HookExecutor }     from '../../packages/core/src/hooks/executor'
import { OakBunDB }           from '../../packages/core/src/db/index'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column }           from '../../packages/core/src/schema/column'

// ── Schema ──────────────────────────────────────────────────────────────────

const usersTable = defineTable('users', {
  id:     column.integer().primaryKey(),
  name:   column.text(),
  active: column.boolean().default(false),
}).build()

// ── Helper ───────────────────────────────────────────────────────────────────

async function makeDB() {
  const adapter = new SQLiteAdapter()
  await adapter.execute(toCreateTableSql(usersTable))
  await adapter.execute(`INSERT INTO "users" ("name", "active") VALUES (?, ?)`, ['Alice', 1])
  await adapter.execute(`INSERT INTO "users" ("name", "active") VALUES (?, ?)`, ['Bob', 0])
  await adapter.execute(`INSERT INTO "users" ("name", "active") VALUES (?, ?)`, ['Carol', 1])

  const hooks = new HookExecutor()
  return new OakBunDB(adapter, hooks).withCtx({})
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ColumnRestrictedBuilder — .columns(col).subquery()', () => {
  test('returns SubqueryResult with SQL in parentheses', async () => {
    const db = await makeDB()
    const sub = db.from(usersTable).columns('id').subquery()
    expect(sub._sql).toBe('(SELECT "id" FROM "users")')
    expect(sub._params).toEqual([])
  })

  test('_phantom.col matches the requested column', async () => {
    const db = await makeDB()
    const sub = db.from(usersTable).columns('id').subquery()
    expect(sub._phantom.col).toBe('id')
  })

  test('.where() condition lands in SQL', async () => {
    const db = await makeDB()
    const sub = db.from(usersTable).columns('id').where({ active: true }).subquery()
    expect(sub._sql).toBe('(SELECT "id" FROM "users" WHERE "active" = ?)')
    expect(sub._params).toEqual([true])
  })

  test('.limit() lands in SQL', async () => {
    const db = await makeDB()
    const sub = db.from(usersTable).columns('id').limit(5).subquery()
    expect(sub._sql).toBe('(SELECT "id" FROM "users" LIMIT 5)')
  })

  test('.where().limit().orderBy() — all combined in correct order', async () => {
    const db = await makeDB()
    const sub = db.from(usersTable)
      .columns('id')
      .where({ active: true })
      .orderBy('id', 'DESC')
      .limit(3)
      .subquery()

    expect(sub._sql).toBe('(SELECT "id" FROM "users" WHERE "active" = ? ORDER BY "id" DESC LIMIT 3)')
    expect(sub._params).toEqual([true])
  })

  test('subquery is immutable — chaining creates new instances', async () => {
    const db = await makeDB()
    const base = db.from(usersTable).columns('id')
    const filtered = base.where({ active: true })

    const baseSub = base.subquery()
    const filteredSub = filtered.subquery()

    expect(baseSub._sql).toBe('(SELECT "id" FROM "users")')
    expect(filteredSub._sql).toBe('(SELECT "id" FROM "users" WHERE "active" = ?)')
  })

  test('multi-column .columns() still returns SelectBuilder (not ColumnRestrictedBuilder)', async () => {
    const db = await makeDB()
    // multi-column form → SelectBuilder → has .select()
    const rows = await db.from(usersTable).columns('id', 'name').select()
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveProperty('id')
    expect(rows[0]).toHaveProperty('name')
    expect(rows[0]).not.toHaveProperty('active')
  })
})
