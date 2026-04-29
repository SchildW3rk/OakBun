import { describe, test, expect, beforeEach } from 'bun:test'
import { SQLiteAdapter }    from '../../packages/core/src/adapter/sqlite'
import { HookExecutor }     from '../../packages/core/src/hooks/executor'
import { OakBunDB }           from '../../packages/core/src/db/index'
import type { QueryLog }    from '../../packages/core/src/db/index'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column }           from '../../packages/core/src/schema/column'

// ── Schema ──────────────────────────────────────────────────────────────────

const usersTable = defineTable('users', {
  id:        column.integer().primaryKey(),
  name:      column.text(),
  active:    column.boolean().default(true),
  deletedAt: column.timestamp().nullable(),
})
  .withSoftDelete('deletedAt')
  .build()

const postsTable = defineTable('posts', {
  id:    column.integer().primaryKey(),
  title: column.text(),
}).build()

// ── Helper ───────────────────────────────────────────────────────────────────

function makeQueryLog(): QueryLog {
  return { queries: 0, totalMs: 0, entries: [], threshold: 100, logQueries: true }
}

async function makeDB() {
  const adapter = new SQLiteAdapter()
  await adapter.execute(toCreateTableSql(usersTable))
  await adapter.execute(toCreateTableSql(postsTable))

  // Alice — not deleted
  await adapter.execute(`INSERT INTO "users" ("name", "active", "deletedAt") VALUES (?, ?, ?)`, ['Alice', 1, null])
  // Bob — soft deleted
  await adapter.execute(`INSERT INTO "users" ("name", "active", "deletedAt") VALUES (?, ?, ?)`, ['Bob', 1, '2024-01-01T00:00:00.000Z'])
  // Carol — not deleted, inactive
  await adapter.execute(`INSERT INTO "users" ("name", "active", "deletedAt") VALUES (?, ?, ?)`, ['Carol', 0, null])

  await adapter.execute(`INSERT INTO "posts" ("title") VALUES (?)`, ['Post 1'])
  await adapter.execute(`INSERT INTO "posts" ("title") VALUES (?)`, ['Post 2'])

  const hooks = new HookExecutor()
  const oakbun = new OakBunDB(adapter, hooks)
  return { adapter, db: oakbun.withCtx({}), oakbun }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('soft delete — SelectBuilder', () => {
  describe('automatic filter', () => {
    test('select() excludes soft-deleted rows by default', async () => {
      const { db } = await makeDB()
      const users = await db.from(usersTable).select()
      expect(users.map((u) => u.name)).toEqual(['Alice', 'Carol'])
    })

    test('first() excludes soft-deleted rows', async () => {
      const { db } = await makeDB()
      const user = await db.from(usersTable).where({ name: 'Bob' }).first()
      expect(user).toBeNull()
    })

    test('no filter on table without soft delete', async () => {
      const { db } = await makeDB()
      const posts = await db.from(postsTable).select()
      expect(posts).toHaveLength(2)
    })

    test('soft delete filter combined with .where()', async () => {
      const { db } = await makeDB()
      const users = await db.from(usersTable).where({ active: true }).select()
      // Only Alice is active and not deleted (Bob is deleted)
      expect(users).toHaveLength(1)
      expect(users[0]!.name).toBe('Alice')
    })

    test('count() respects soft delete filter', async () => {
      const { db } = await makeDB()
      const total = await db.from(usersTable).count()
      expect(total).toBe(2)  // Alice + Carol
    })
  })

  describe('.withDeleted()', () => {
    test('withDeleted().select() returns all rows including deleted', async () => {
      const { db } = await makeDB()
      const users = await db.from(usersTable).withDeleted().select()
      expect(users).toHaveLength(3)
    })

    test('withDeleted().first() can find a deleted row', async () => {
      const { db } = await makeDB()
      const user = await db.from(usersTable).withDeleted().where({ name: 'Bob' }).first()
      expect(user).not.toBeNull()
      expect(user!.name).toBe('Bob')
    })

    test('withDeleted() on table without soft delete — no error, no change', async () => {
      const { db } = await makeDB()
      const posts = await db.from(postsTable).withDeleted().select()
      expect(posts).toHaveLength(2)
    })

    test('withDeleted() is immutable — original builder unaffected', async () => {
      const { db } = await makeDB()
      const base = db.from(usersTable)
      const withAll = base.withDeleted()

      const baseRows = await base.select()
      const allRows  = await withAll.select()

      expect(baseRows).toHaveLength(2)
      expect(allRows).toHaveLength(3)
    })
  })

  describe('subquery — soft delete filter', () => {
    test('.columns().subquery() SQL contains IS NULL filter', async () => {
      const { db } = await makeDB()
      const sub = db.from(usersTable).columns('id').subquery()
      expect(sub._sql).toContain('"deletedAt" IS NULL')
    })

    test('.columns().withDeleted().subquery() has no IS NULL filter', async () => {
      const { db } = await makeDB()
      // withDeleted() on ColumnRestrictedBuilder — goes through the underlying SelectBuilder
      // ColumnRestrictedBuilder doesn't expose withDeleted() — need to apply before columns()
      const sub = db.from(usersTable).withDeleted().columns('id').subquery()
      expect(sub._sql).not.toContain('IS NULL')
    })
  })
})
