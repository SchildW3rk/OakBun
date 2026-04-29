import { describe, test, expect } from 'bun:test'
import { SQLiteAdapter }    from '../../packages/core/src/adapter/sqlite'
import { HookExecutor }     from '../../packages/core/src/hooks/executor'
import { OakBunDB }           from '../../packages/core/src/db/index'
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

async function makeDB() {
  const adapter = new SQLiteAdapter()
  await adapter.execute(toCreateTableSql(usersTable))
  await adapter.execute(toCreateTableSql(postsTable))

  await adapter.execute(`INSERT INTO "users" ("name", "active", "deletedAt") VALUES (?, ?, ?)`, ['Alice', 1, null])
  await adapter.execute(`INSERT INTO "users" ("name", "active", "deletedAt") VALUES (?, ?, ?)`, ['Bob', 0, null])
  await adapter.execute(`INSERT INTO "users" ("name", "active", "deletedAt") VALUES (?, ?, ?)`, ['Carol', 1, null])

  await adapter.execute(`INSERT INTO "posts" ("title") VALUES (?)`, ['Post 1'])

  const hooks = new HookExecutor()
  return new OakBunDB(adapter, hooks).withCtx({})
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SoftDeleteBuilder — .softDelete().execute()', () => {
  test('sets deletedAt to a recent timestamp', async () => {
    const db = await makeDB()
    const before = Date.now()
    await db.from(usersTable).softDelete().where({ id: 1 }).execute()
    const after = Date.now()

    const row = await db.from(usersTable).withDeleted().where({ id: 1 }).first()
    expect(row).not.toBeNull()
    expect(row!.deletedAt).toBeInstanceOf(Date)
    expect((row!.deletedAt as Date).getTime()).toBeGreaterThanOrEqual(before)
    expect((row!.deletedAt as Date).getTime()).toBeLessThanOrEqual(after + 1000)
  })

  test('affects multiple rows matching .where()', async () => {
    const db = await makeDB()
    await db.from(usersTable).softDelete().where({ active: false }).execute()

    const remaining = await db.from(usersTable).select()
    expect(remaining.map((u) => u.name)).not.toContain('Bob')
  })

  test('without .where() — all rows are soft-deleted', async () => {
    const db = await makeDB()
    await db.from(usersTable).softDelete().execute()

    const visible = await db.from(usersTable).select()
    expect(visible).toHaveLength(0)

    const all = await db.from(usersTable).withDeleted().select()
    expect(all).toHaveLength(3)
    for (const u of all) {
      expect(u.deletedAt).toBeInstanceOf(Date)
    }
  })

  test('after softDelete(), select() hides the row', async () => {
    const db = await makeDB()
    await db.from(usersTable).softDelete().where({ id: 1 }).execute()

    const visible = await db.from(usersTable).select()
    expect(visible.map((u) => u.id)).not.toContain(1)
  })

  test('after softDelete(), withDeleted() shows the row', async () => {
    const db = await makeDB()
    await db.from(usersTable).softDelete().where({ id: 1 }).execute()

    const all = await db.from(usersTable).withDeleted().where({ id: 1 }).first()
    expect(all).not.toBeNull()
    expect(all!.deletedAt).toBeInstanceOf(Date)
  })

  test('throws when table has no softDeleteColumn', async () => {
    const db = await makeDB()
    await expect(
      db.from(postsTable).softDelete().where({ id: 1 }).execute(),
    ).rejects.toThrow(/has no soft delete column/)
  })
})

describe('SoftDeleteBuilder — .restore().execute()', () => {
  test('sets deletedAt back to null', async () => {
    const db = await makeDB()
    // First soft-delete
    await db.from(usersTable).softDelete().where({ id: 1 }).execute()
    let row = await db.from(usersTable).withDeleted().where({ id: 1 }).first()
    expect(row!.deletedAt).toBeInstanceOf(Date)

    // Then restore
    await db.from(usersTable).restore().where({ id: 1 }).execute()
    row = await db.from(usersTable).where({ id: 1 }).first()
    expect(row).not.toBeNull()
    expect(row!.deletedAt).toBeNull()
  })

  test('after restore(), select() returns the row again', async () => {
    const db = await makeDB()
    await db.from(usersTable).softDelete().where({ id: 2 }).execute()

    let visible = await db.from(usersTable).select()
    expect(visible.map((u) => u.id)).not.toContain(2)

    await db.from(usersTable).restore().where({ id: 2 }).execute()

    visible = await db.from(usersTable).select()
    expect(visible.map((u) => u.id)).toContain(2)
  })

  test('workflow: softDelete → verify gone → restore → verify back', async () => {
    const db = await makeDB()

    // All 3 visible initially
    expect(await db.from(usersTable).count()).toBe(3)

    // Soft-delete user 1
    await db.from(usersTable).softDelete().where({ id: 1 }).execute()
    expect(await db.from(usersTable).count()).toBe(2)

    // Restore
    await db.from(usersTable).restore().where({ id: 1 }).execute()
    expect(await db.from(usersTable).count()).toBe(3)
  })

  test('throws when table has no softDeleteColumn', async () => {
    const db = await makeDB()
    await expect(
      db.from(postsTable).restore().where({ id: 1 }).execute(),
    ).rejects.toThrow(/has no soft delete column/)
  })
})
