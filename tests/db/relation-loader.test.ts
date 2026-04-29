import { describe, test, expect, beforeEach } from 'bun:test'
import { SQLiteAdapter }    from '../../packages/core/src/adapter/sqlite'
import { HookExecutor }     from '../../packages/core/src/hooks/executor'
import { OakBunDB }           from '../../packages/core/src/db/index'
import type { QueryLog }    from '../../packages/core/src/db/index'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column }           from '../../packages/core/src/schema/column'

// ── Schema ──────────────────────────────────────────────────────────────────

const usersTable = defineTable('users', {
  id:   column.integer().primaryKey(),
  name: column.text(),
}).build()

const postsTable = defineTable('posts', {
  id:       column.integer().primaryKey(),
  title:    column.text(),
  authorId: column.integer(),
}).build()

const commentsTable = defineTable('comments', {
  id:     column.integer().primaryKey(),
  body:   column.text(),
  postId: column.integer(),
}).build()

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeQueryLog(overrides?: Partial<QueryLog>): QueryLog {
  return { queries: 0, totalMs: 0, entries: [], threshold: 100, logQueries: true, ...overrides }
}

async function makeDB() {
  const adapter = new SQLiteAdapter()
  await adapter.execute(toCreateTableSql(usersTable))
  await adapter.execute(toCreateTableSql(postsTable))
  await adapter.execute(toCreateTableSql(commentsTable))

  // Users
  await adapter.execute(`INSERT INTO "users" ("name") VALUES (?)`, ['Alice'])
  await adapter.execute(`INSERT INTO "users" ("name") VALUES (?)`, ['Bob'])
  await adapter.execute(`INSERT INTO "users" ("name") VALUES (?)`, ['Carol'])

  // Posts — Alice: 2, Bob: 1, Carol: 0
  await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['Post A1', 1])
  await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['Post A2', 1])
  await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['Post B1', 2])

  // Comments — Post 1: 2 comments, Post 2: 1 comment, Post 3: 0
  await adapter.execute(`INSERT INTO "comments" ("body", "postId") VALUES (?, ?)`, ['C1', 1])
  await adapter.execute(`INSERT INTO "comments" ("body", "postId") VALUES (?, ?)`, ['C2', 1])
  await adapter.execute(`INSERT INTO "comments" ("body", "postId") VALUES (?, ?)`, ['C3', 2])

  const db = new OakBunDB(adapter, new HookExecutor())
  return { adapter, db }
}

// ── loadRelation tests ───────────────────────────────────────────────────────

describe('BoundOakBunDB.loadRelation()', () => {
  test('returns all children grouped by FK — exactly 1 query', async () => {
    const { db } = await makeDB()
    const log = makeQueryLog()
    const bound = db.withCtx({}, undefined, log)

    const posts = await bound.from(postsTable).select()
    const queryCountAfterPosts = log.queries

    const authorMap = await bound.loadRelation(posts, 'authorId', usersTable, 'id')

    // Exactly 1 additional query for loadRelation
    expect(log.queries - queryCountAfterPosts).toBe(1)
    expect(authorMap.size).toBe(2)  // Alice (id=1) and Bob (id=2)

    expect(authorMap.get(1)![0]!.name).toBe('Alice')
    expect(authorMap.get(2)![0]!.name).toBe('Bob')
    expect(authorMap.has(3)).toBe(false)  // Carol has no posts
  })

  test('empty parents → empty Map, zero queries', async () => {
    const { db } = await makeDB()
    const log = makeQueryLog()
    const bound = db.withCtx({}, undefined, log)

    const authorMap = await bound.loadRelation([], 'authorId', usersTable, 'id')

    expect(log.queries).toBe(0)
    expect(authorMap.size).toBe(0)
  })

  test('multiple parents with same FK → deduplicated IN query', async () => {
    const { db, adapter } = await makeDB()
    const log = makeQueryLog()
    const bound = db.withCtx({}, undefined, log)

    // All 3 posts: Alice×2, Bob×1 — FK values [1, 1, 2] → deduped to [1, 2]
    const posts = await bound.from(postsTable).select()
    expect(posts.filter(p => p.authorId === 1)).toHaveLength(2)

    const before = log.queries
    const authorMap = await bound.loadRelation(posts, 'authorId', usersTable, 'id')
    expect(log.queries - before).toBe(1)

    // The IN query should contain only 2 unique IDs
    const inEntry = log.entries.find(e => e.sql.includes('IN'))!
    expect(inEntry).toBeDefined()
    expect(inEntry.params).toHaveLength(2)  // [1, 2] — not [1, 1, 2]

    // Results correct
    expect(authorMap.get(1)![0]!.name).toBe('Alice')
    expect(authorMap.get(2)![0]!.name).toBe('Bob')
  })

  test('one-to-many: multiple children per key', async () => {
    const { db } = await makeDB()
    const bound = db.withCtx({})

    const posts = await bound.from(postsTable).select()
    const commentMap = await bound.loadRelation(posts, 'id', commentsTable, 'postId')

    // Post 1 has 2 comments, post 2 has 1, post 3 has 0
    expect(commentMap.get(1)).toHaveLength(2)
    expect(commentMap.get(2)).toHaveLength(1)
    expect(commentMap.has(3)).toBe(false)
  })

  test('single parent → IN query with one value', async () => {
    const { db } = await makeDB()
    const log = makeQueryLog()
    const bound = db.withCtx({}, undefined, log)

    const post = [{ id: 1, title: 'Post A1', authorId: 1 }]
    const before = log.queries
    const authorMap = await bound.loadRelation(post, 'authorId', usersTable, 'id')

    expect(log.queries - before).toBe(1)
    expect(authorMap.size).toBe(1)
    expect(authorMap.get(1)![0]!.name).toBe('Alice')
  })

  test('FK value not present in child table → key absent from Map', async () => {
    const { db } = await makeDB()
    const bound = db.withCtx({})

    // authorId: 99 does not exist in users
    const posts = [{ id: 99, title: 'Orphan', authorId: 99 }]
    const authorMap = await bound.loadRelation(posts, 'authorId', usersTable, 'id')

    expect(authorMap.size).toBe(0)
    expect(authorMap.has(99)).toBe(false)
  })

  test('total query count is exactly 2 (1 select + 1 loadRelation)', async () => {
    const { db } = await makeDB()
    const log = makeQueryLog()
    const bound = db.withCtx({}, undefined, log)

    const posts = await bound.from(postsTable).select()
    await bound.loadRelation(posts, 'authorId', usersTable, 'id')

    expect(log.queries).toBe(2)
  })
})

// ── loadRelationOne tests ────────────────────────────────────────────────────

describe('BoundOakBunDB.loadRelationOne()', () => {
  test('returns Map<fkValue, TChild> — single child per key', async () => {
    const { db } = await makeDB()
    const bound = db.withCtx({})

    const posts = await bound.from(postsTable).select()
    const authorMap = await bound.loadRelationOne(posts, 'authorId', usersTable, 'id')

    expect(authorMap.get(1)).toBeDefined()
    expect(authorMap.get(1)!.name).toBe('Alice')
    expect(authorMap.get(2)!.name).toBe('Bob')
    expect(authorMap.has(3)).toBe(false)
  })

  test('empty parents → empty Map, zero queries', async () => {
    const { db } = await makeDB()
    const log = makeQueryLog()
    const bound = db.withCtx({}, undefined, log)

    const result = await bound.loadRelationOne([], 'authorId', usersTable, 'id')

    expect(log.queries).toBe(0)
    expect(result.size).toBe(0)
  })

  test('exactly 1 query issued', async () => {
    const { db } = await makeDB()
    const log = makeQueryLog()
    const bound = db.withCtx({}, undefined, log)

    const posts = await bound.from(postsTable).select()
    const before = log.queries
    await bound.loadRelationOne(posts, 'authorId', usersTable, 'id')

    expect(log.queries - before).toBe(1)
  })

  test('FK values deduplicated — Map still has correct entries', async () => {
    const { db } = await makeDB()
    const log = makeQueryLog()
    const bound = db.withCtx({}, undefined, log)

    // Alice appears twice as author
    const posts = await bound.from(postsTable).where({ authorId: 1 }).select()
    expect(posts).toHaveLength(2)

    const before = log.queries
    const authorMap = await bound.loadRelationOne(posts, 'authorId', usersTable, 'id')

    expect(log.queries - before).toBe(1)
    expect(authorMap.size).toBe(1)  // still just one entry for Alice
    expect(authorMap.get(1)!.name).toBe('Alice')
  })

  test('last-write-wins for duplicate PK values (loadRelationOne)', async () => {
    const { db } = await makeDB()
    const bound = db.withCtx({})

    // Simulate: two parents pointing to same child
    const parents = [
      { id: 1, title: 'P1', authorId: 1 },
      { id: 2, title: 'P2', authorId: 1 },
    ]
    const authorMap = await bound.loadRelationOne(parents, 'authorId', usersTable, 'id')

    // Only one entry for authorId=1
    expect(authorMap.size).toBe(1)
    expect(authorMap.get(1)!.name).toBe('Alice')
  })
})
