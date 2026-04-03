import { describe, test, expect } from 'bun:test'
import { z } from 'zod'
import { SQLiteAdapter }    from '../../packages/core/src/adapter/sqlite'
import { HookExecutor }     from '../../packages/core/src/hooks/executor'
import { VelnDB }           from '../../packages/core/src/db/index'
import { ValidationError }  from '../../packages/core/src/app/types'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column }           from '../../packages/core/src/schema/column'

// ── Schema ───────────────────────────────────────────────────────────────────

const ordersTable = defineTable('orders', {
  id:     column.integer().primaryKey(),
  amount: column.integer(),
  status: column.text(),
}).build()

// ── Helpers ──────────────────────────────────────────────────────────────────

async function makeDB() {
  const adapter = new SQLiteAdapter()
  await adapter.execute(toCreateTableSql(ordersTable))
  await adapter.execute(`INSERT INTO "orders" ("amount", "status") VALUES (100, 'paid')`)
  await adapter.execute(`INSERT INTO "orders" ("amount", "status") VALUES (200, 'pending')`)
  await adapter.execute(`INSERT INTO "orders" ("amount", "status") VALUES (50,  'refunded')`)
  const db = new VelnDB(adapter, new HookExecutor())
  return db.withCtx({})
}

// ── Part 1: db.raw() — untyped ───────────────────────────────────────────────

describe('db.raw() — without schema', () => {
  test('returns Record<string, unknown>[] with correct rows', async () => {
    const db = await makeDB()
    const rows = await db.raw('SELECT * FROM "orders"', [])

    expect(rows).toHaveLength(3)
    expect(typeof rows[0]!['id']).toBe('number')
    expect(typeof rows[0]!['amount']).toBe('number')
    expect(typeof rows[0]!['status']).toBe('string')
  })

  test('params are bound correctly', async () => {
    const db = await makeDB()
    const rows = await db.raw('SELECT * FROM "orders" WHERE "amount" > ?', [100])

    expect(rows).toHaveLength(1)
    expect(rows[0]!['amount']).toBe(200)
  })

  test('empty result set → empty array', async () => {
    const db = await makeDB()
    const rows = await db.raw('SELECT * FROM "orders" WHERE "amount" > ?', [9999])

    expect(rows).toHaveLength(0)
  })

  test('multiple params bound in order', async () => {
    const db = await makeDB()
    const rows = await db.raw(
      'SELECT * FROM "orders" WHERE "amount" >= ? AND "status" = ?',
      [100, 'paid'],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!['status']).toBe('paid')
  })

  test('defaults to empty params array when omitted', async () => {
    const db = await makeDB()
    const rows = await db.raw('SELECT COUNT(*) AS cnt FROM "orders"')

    expect(rows).toHaveLength(1)
    expect(rows[0]!['cnt']).toBe(3)
  })
})

// ── Part 2: db.raw() — with Zod schema ──────────────────────────────────────

describe('db.raw() — with Zod schema', () => {
  test('validates and returns typed rows', async () => {
    const db = await makeDB()
    const schema = z.object({ id: z.number(), amount: z.number(), status: z.string() })

    const rows = await db.raw('SELECT * FROM "orders"', [], schema)

    expect(rows).toHaveLength(3)
    // TypeScript: rows is { id: number; amount: number; status: string }[]
    expect(rows[0]!.id).toBe(1)
    expect(rows[0]!.amount).toBe(100)
    expect(rows[0]!.status).toBe('paid')
  })

  test('partial schema — only selected columns', async () => {
    const db = await makeDB()
    const schema = z.object({ amount: z.number() })

    const rows = await db.raw('SELECT "amount" FROM "orders" ORDER BY "amount"', [], schema)

    expect(rows).toHaveLength(3)
    expect(rows.map(r => r.amount)).toEqual([50, 100, 200])
  })

  test('throws ValidationError when row does not match schema', async () => {
    const db = await makeDB()
    // Expect amount to be a string — will fail because it's a number
    const schema = z.object({ amount: z.string() })

    expect(
      db.raw('SELECT "amount" FROM "orders" LIMIT 1', [], schema)
    ).rejects.toBeInstanceOf(ValidationError)
  })

  test('throws ValidationError on first invalid row', async () => {
    const db = await makeDB()
    const schema = z.object({ missing_col: z.string() })

    await expect(
      db.raw('SELECT "id" FROM "orders"', [], schema)
    ).rejects.toBeInstanceOf(ValidationError)
  })

  test('schema with coercion works', async () => {
    const db = await makeDB()
    // z.coerce.string() will convert number → string
    const schema = z.object({ id: z.coerce.string() })
    const rows = await db.raw('SELECT "id" FROM "orders" ORDER BY "id"', [], schema)

    expect(rows[0]!.id).toBe('1')
    expect(typeof rows[0]!.id).toBe('string')
  })
})

// ── Part 3: JoinBuilder.select<T>() generic cast ─────────────────────────────

const usersTable = defineTable('users', {
  id:   column.integer().primaryKey(),
  name: column.text(),
}).build()

const postsTable = defineTable('posts', {
  id:       column.integer().primaryKey(),
  title:    column.text(),
  authorId: column.integer(),
}).build()

async function makeJoinDB() {
  const adapter = new SQLiteAdapter()
  await adapter.execute(toCreateTableSql(usersTable))
  await adapter.execute(toCreateTableSql(postsTable))
  await adapter.execute(`INSERT INTO "users" ("name") VALUES ('Alice')`)
  await adapter.execute(`INSERT INTO "users" ("name") VALUES ('Bob')`)
  await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES ('Post 1', 1)`)
  await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES ('Post 2', 2)`)
  const db = new VelnDB(adapter, new HookExecutor())
  return db.withCtx({})
}

describe('JoinBuilder.select<T>()', () => {
  test('select() without generic → Record<string, unknown>[]', async () => {
    const db = await makeJoinDB()
    const rows = await db
      .join('posts')
      .columns(['posts.title', 'users.name'])
      .join('users', 'posts.authorId = users.id')
      .select()

    expect(rows).toHaveLength(2)
    // TypeScript infers Record<string, unknown>
    expect(typeof rows[0]!['title']).toBe('string')
    expect(typeof rows[0]!['name']).toBe('string')
  })

  test('select<T>() with explicit generic — typed access', async () => {
    const db = await makeJoinDB()
    const rows = await db
      .join('posts')
      .columns(['posts.title', 'users.name'])
      .join('users', 'posts.authorId = users.id')
      .select<{ title: string; name: string }>()

    expect(rows).toHaveLength(2)
    // TypeScript: rows[0].title and rows[0].name are strings
    const titles = rows.map(r => r.title).sort()
    const names  = rows.map(r => r.name).sort()
    expect(titles).toEqual(['Post 1', 'Post 2'])
    expect(names).toEqual(['Alice', 'Bob'])
  })

  test('first() without generic → Record<string, unknown> | null', async () => {
    const db = await makeJoinDB()
    const row = await db
      .join('posts')
      .columns(['posts.title', 'users.name'])
      .join('users', 'posts.authorId = users.id')
      .first()

    expect(row).not.toBeNull()
    expect(typeof row!['title']).toBe('string')
  })

  test('first<T>() with explicit generic — typed access', async () => {
    const db = await makeJoinDB()
    const row = await db
      .join('posts')
      .columns(['posts.title', 'users.name'])
      .join('users', 'posts.authorId = users.id')
      .first<{ title: string; name: string }>()

    expect(row).not.toBeNull()
    expect(row!.title).toBe('Post 1')
    expect(row!.name).toBe('Alice')
  })

  test('first<T>() returns null when no rows match', async () => {
    const db = await makeJoinDB()
    const row = await db
      .join('posts')
      .columns(['posts.title'])
      .join('users', 'posts.authorId = users.id')
      .where('posts.id = ?', [9999])
      .first<{ title: string }>()

    expect(row).toBeNull()
  })
})
