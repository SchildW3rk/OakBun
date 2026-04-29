import { describe, test, expect } from 'bun:test'
import { SQLiteAdapter }    from '../../packages/core/src/adapter/sqlite'
import { HookExecutor }     from '../../packages/core/src/hooks/executor'
import { OakBunDB }           from '../../packages/core/src/db/index'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column }           from '../../packages/core/src/schema/column'
import { buildSelect }      from '../../packages/core/src/db/sql'

// ── Schema ──────────────────────────────────────────────────────────────────

const usersTable = defineTable('users', {
  id:        column.integer().primaryKey(),
  name:      column.text(),
  role:      column.text(),
  deletedAt: column.timestamp().nullable(),
})
  .withSoftDelete('deletedAt')
  .build()

// ── Helper ───────────────────────────────────────────────────────────────────

async function makeDB() {
  const adapter = new SQLiteAdapter()
  await adapter.execute(toCreateTableSql(usersTable))

  // 3 Alice, 2 Bob (admin), 1 Carol — with a deleted row
  await adapter.execute(`INSERT INTO "users" ("name", "role", "deletedAt") VALUES (?, ?, ?)`, ['Alice', 'user', null])
  await adapter.execute(`INSERT INTO "users" ("name", "role", "deletedAt") VALUES (?, ?, ?)`, ['Alice', 'user', null])
  await adapter.execute(`INSERT INTO "users" ("name", "role", "deletedAt") VALUES (?, ?, ?)`, ['Alice', 'user', null])
  await adapter.execute(`INSERT INTO "users" ("name", "role", "deletedAt") VALUES (?, ?, ?)`, ['Bob', 'admin', null])
  await adapter.execute(`INSERT INTO "users" ("name", "role", "deletedAt") VALUES (?, ?, ?)`, ['Bob', 'admin', null])
  await adapter.execute(`INSERT INTO "users" ("name", "role", "deletedAt") VALUES (?, ?, ?)`, ['Carol', 'user', '2024-01-01T00:00:00.000Z'])

  const hooks = new HookExecutor()
  return new OakBunDB(adapter, hooks).withCtx({})
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SelectBuilder — .distinct()', () => {
  describe('SQL generation', () => {
    test('buildSelect with distinct:true produces SELECT DISTINCT', () => {
      const { sql } = buildSelect('users', {}, { distinct: true })
      expect(sql).toStartWith('SELECT DISTINCT')
    })

    test('buildSelect without distinct produces SELECT', () => {
      const { sql } = buildSelect('users', {}, {})
      expect(sql).toStartWith('SELECT ')
      expect(sql).not.toContain('DISTINCT')
    })

    test('.distinct() + .where() — DISTINCT before WHERE', async () => {
      const db = await makeDB()
      const sub = db.from(usersTable).withDeleted().distinct().where({ role: 'user' }).columns('id').subquery()
      expect(sub._sql).toContain('SELECT DISTINCT')
      expect(sub._sql).toContain('WHERE')
      const distinctIdx = sub._sql.indexOf('DISTINCT')
      const whereIdx    = sub._sql.indexOf('WHERE')
      expect(distinctIdx).toBeLessThan(whereIdx)
    })

    test('.distinct() + .columns() — DISTINCT "col"', async () => {
      const db = await makeDB()
      const sub = db.from(usersTable).withDeleted().distinct().columns('name').subquery()
      expect(sub._sql).toContain('SELECT DISTINCT "name"')
    })

    test('.distinct() + .orderBy() + .limit() — all in SQL', async () => {
      const db = await makeDB()
      const sub = db.from(usersTable).withDeleted().distinct().orderBy('name').limit(5).columns('id').subquery()
      expect(sub._sql).toContain('SELECT DISTINCT')
      expect(sub._sql).toContain('ORDER BY')
      expect(sub._sql).toContain('LIMIT 5')
    })

    test('.distinct() + soft delete — IS NULL still applied', async () => {
      const db = await makeDB()
      const sub = db.from(usersTable).distinct().columns('name').subquery()
      expect(sub._sql).toContain('SELECT DISTINCT "name"')
      expect(sub._sql).toContain('"deletedAt" IS NULL')
    })

    test('.distinct() + .withDeleted() — no IS NULL', async () => {
      const db = await makeDB()
      const sub = db.from(usersTable).withDeleted().distinct().columns('name').subquery()
      expect(sub._sql).toContain('SELECT DISTINCT')
      expect(sub._sql).not.toContain('IS NULL')
    })

    test('.distinct() returns SelectBuilder (chainable)', async () => {
      const db = await makeDB()
      const builder = db.from(usersTable).distinct()
      // Can chain further methods
      const rows = await builder.withDeleted().select()
      expect(Array.isArray(rows)).toBe(true)
    })
  })

  describe('end-to-end deduplication', () => {
    test('.columns().distinct().select() deduplicates', async () => {
      const db = await makeDB()
      // withDeleted() to get all rows for this test
      const rows = await db.from(usersTable).withDeleted().columns('name', 'role').distinct().select()
      // Alice/user, Bob/admin, Carol/user = 3 unique combos
      expect(rows).toHaveLength(3)
    })

    test('.distinct().select() without columns — all rows distinct', async () => {
      const db = await makeDB()
      // All 5 non-deleted rows have different ids → 5 distinct rows
      const rows = await db.from(usersTable).distinct().select()
      expect(rows).toHaveLength(5) // Carol is soft-deleted, 5 remain
    })

    test('without .distinct() — duplicates present', async () => {
      const db = await makeDB()
      const rows = await db.from(usersTable).withDeleted().select()
      expect(rows).toHaveLength(6)
    })

    test('.distinct() + soft delete — deleted rows excluded', async () => {
      const db = await makeDB()
      // Carol (deleted) should not appear
      const names = (await db.from(usersTable).columns('name', 'role').distinct().select())
        .map((r) => r.name as string)
      expect(names).not.toContain('Carol')
    })

    test('.distinct() with no results — returns []', async () => {
      const db = await makeDB()
      const rows = await db.from(usersTable).where({ role: 'superadmin' }).distinct().select()
      expect(rows).toHaveLength(0)
    })
  })
})
