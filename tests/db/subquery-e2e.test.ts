import { describe, test, expect, beforeEach } from 'bun:test'
import { SQLiteAdapter }    from '../../packages/core/src/adapter/sqlite'
import { HookExecutor }     from '../../packages/core/src/hooks/executor'
import { VelnDB }           from '../../packages/core/src/db/index'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column }           from '../../packages/core/src/schema/column'

// ── Schema ──────────────────────────────────────────────────────────────────

const usersTable = defineTable('users', {
  id:     column.integer().primaryKey(),
  name:   column.text(),
  active: column.boolean().default(false),
  banned: column.boolean().default(false),
}).build()

const postsTable = defineTable('posts', {
  id:       column.integer().primaryKey(),
  title:    column.text(),
  authorId: column.integer(),
})
  .belongsTo('author', () => usersTable, 'authorId')
  .build()

// ── Setup ────────────────────────────────────────────────────────────────────

async function makeDB() {
  const adapter = new SQLiteAdapter()
  await adapter.execute(toCreateTableSql(usersTable))
  await adapter.execute(toCreateTableSql(postsTable))

  // Users: Alice (active), Bob (inactive, banned), Carol (active)
  await adapter.execute(`INSERT INTO "users" ("name", "active", "banned") VALUES (?, ?, ?)`, ['Alice', 1, 0])
  await adapter.execute(`INSERT INTO "users" ("name", "active", "banned") VALUES (?, ?, ?)`, ['Bob', 0, 1])
  await adapter.execute(`INSERT INTO "users" ("name", "active", "banned") VALUES (?, ?, ?)`, ['Carol', 1, 0])

  // Posts: 2 from Alice(1), 1 from Bob(2)
  await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['Post A1', 1])
  await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['Post A2', 1])
  await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['Post B1', 2])

  const hooks = new HookExecutor()
  return new VelnDB(adapter, hooks).withCtx({})
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Subquery — end-to-end (SQLite in-memory)', () => {
  test('IN subquery returns only posts from active users', async () => {
    const db = await makeDB()

    const activeUserIds = db.from(usersTable).columns('id').where({ active: true }).subquery()
    const posts = await db.from(postsTable)
      .where({ authorId: { op: 'IN', value: activeUserIds } })
      .select()

    expect(posts).toHaveLength(2)
    for (const p of posts) {
      expect(p.authorId).toBe(1) // Alice's id
    }
  })

  test('NOT IN subquery excludes posts from banned users', async () => {
    const db = await makeDB()

    const bannedUserIds = db.from(usersTable).columns('id').where({ banned: true }).subquery()
    const posts = await db.from(postsTable)
      .where({ authorId: { op: 'NOT IN', value: bannedUserIds } })
      .select()

    expect(posts).toHaveLength(2)
    for (const p of posts) {
      expect(p.authorId).not.toBe(2) // Bob is banned
    }
  })

  test('subquery combined with .with() on outer query', async () => {
    const db = await makeDB()

    const activeUserIds = db.from(usersTable).columns('id').where({ active: true }).subquery()
    const posts = await db.from(postsTable)
      .where({ authorId: { op: 'IN', value: activeUserIds } })
      .with({ author: true })
      .select()

    expect(posts).toHaveLength(2)
    expect(posts[0].author).not.toBeNull()
    expect(typeof posts[0].author!.name).toBe('string')
  })

  test('subquery combined with outer .where() and .limit()', async () => {
    const db = await makeDB()

    const activeUserIds = db.from(usersTable).columns('id').where({ active: true }).subquery()
    const posts = await db.from(postsTable)
      .where({ authorId: { op: 'IN', value: activeUserIds } })
      .limit(1)
      .select()

    expect(posts).toHaveLength(1)
  })

  test('subquery with limit/order on inner query', async () => {
    const db = await makeDB()

    // Only the first active user (by id ASC) — Carol has id=3, Alice id=1
    const firstActiveId = db.from(usersTable)
      .columns('id')
      .where({ active: true })
      .orderBy('id', 'ASC')
      .limit(1)
      .subquery()

    const posts = await db.from(postsTable)
      .where({ authorId: { op: 'IN', value: firstActiveId } })
      .select()

    // Only Alice's posts (id=1 is Alice)
    expect(posts).toHaveLength(2)
    expect(posts[0].authorId).toBe(1)
  })

  test('IN subquery with no matches returns empty array', async () => {
    const db = await makeDB()

    // No users with name 'Ghost'
    const ghostIds = db.from(usersTable).columns('id').where({ name: 'Ghost' }).subquery()
    const posts = await db.from(postsTable)
      .where({ authorId: { op: 'IN', value: ghostIds } })
      .select()

    expect(posts).toHaveLength(0)
  })

  test('NOT IN subquery with all users → no posts returned', async () => {
    const db = await makeDB()

    // All user ids excluded
    const allUserIds = db.from(usersTable).columns('id').subquery()
    const posts = await db.from(postsTable)
      .where({ authorId: { op: 'NOT IN', value: allUserIds } })
      .select()

    expect(posts).toHaveLength(0)
  })
})
