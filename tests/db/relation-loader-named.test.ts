import { describe, test, expect } from 'bun:test'
import { SQLiteAdapter }    from '../../packages/core/src/adapter/sqlite'
import { HookExecutor }     from '../../packages/core/src/hooks/executor'
import { OakBunDB }           from '../../packages/core/src/db/index'
import type { QueryLog }    from '../../packages/core/src/db/index'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column }           from '../../packages/core/src/schema/column'

// ── Schema with declared relations ────────────────────────────────────────────

// Forward-declare for circular reference
let postsTableRef: typeof postsTable

const usersTable = defineTable('users', {
  id:   column.integer().primaryKey(),
  name: column.text(),
})
  .hasMany('posts', () => postsTableRef, 'authorId')
  .build()

const postsTable = defineTable('posts', {
  id:       column.integer().primaryKey(),
  title:    column.text(),
  authorId: column.integer(),
})
  .belongsTo('author', () => usersTable, 'authorId')
  .build()

postsTableRef = postsTable

const commentsTable = defineTable('comments', {
  id:     column.integer().primaryKey(),
  body:   column.text(),
  postId: column.integer(),
}).build()

const postsWithComments = defineTable('posts', {
  id:       column.integer().primaryKey(),
  title:    column.text(),
  authorId: column.integer(),
})
  .belongsTo('author', () => usersTable, 'authorId')
  .hasMany('comments', () => commentsTable, 'postId')
  .build()

const tagsTable = defineTable('tags', {
  id:   column.integer().primaryKey(),
  name: column.text(),
}).build()

const postTagsPivot = defineTable('post_tags', {
  id:     column.integer().primaryKey(),
  postId: column.integer(),
  tagId:  column.integer(),
}).build()

const postsWithManyToMany = defineTable('posts', {
  id:    column.integer().primaryKey(),
  title: column.text(),
})
  .manyToMany('tags', () => tagsTable, postTagsPivot, 'postId', 'tagId')
  .build()

// ── DB setup ──────────────────────────────────────────────────────────────────

function makeQueryLog(): QueryLog {
  return { queries: 0, totalMs: 0, entries: [], threshold: 100, logQueries: true }
}

async function makeDB() {
  const adapter = new SQLiteAdapter()
  await adapter.execute(toCreateTableSql(usersTable))
  await adapter.execute(toCreateTableSql(postsTable))
  await adapter.execute(toCreateTableSql(commentsTable))

  await adapter.execute(`INSERT INTO "users" ("name") VALUES (?)`, ['Alice'])
  await adapter.execute(`INSERT INTO "users" ("name") VALUES (?)`, ['Bob'])

  await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['Post A1', 1])
  await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['Post A2', 1])
  await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['Post B1', 2])

  await adapter.execute(`INSERT INTO "comments" ("body", "postId") VALUES (?, ?)`, ['C1', 1])
  await adapter.execute(`INSERT INTO "comments" ("body", "postId") VALUES (?, ?)`, ['C2', 1])
  await adapter.execute(`INSERT INTO "comments" ("body", "postId") VALUES (?, ?)`, ['C3', 2])

  return { adapter, db: new OakBunDB(adapter, new HookExecutor()) }
}

// ── loadRelation — name-based ─────────────────────────────────────────────────

describe('loadRelation — name-based (belongsTo)', () => {
  test('resolves belongsTo relation and returns correct Map', async () => {
    const { db } = await makeDB()
    const bound = db.withCtx({})

    const posts = await bound.from(postsTable).select()
    const authorMap = await bound.loadRelation(posts, 'author', postsTable)

    expect(authorMap.size).toBe(2)
    const alice = (authorMap.get(1) as { name: string }[] | undefined)
    expect(alice?.[0]?.name).toBe('Alice')
    const bob = (authorMap.get(2) as { name: string }[] | undefined)
    expect(bob?.[0]?.name).toBe('Bob')
  })

  test('name-based issues exactly 1 query (same as explicit call)', async () => {
    const { db } = await makeDB()
    const log = makeQueryLog()
    const bound = db.withCtx({}, undefined, log)

    const posts = await bound.from(postsTable).select()
    const before = log.queries
    await bound.loadRelation(posts, 'author', postsTable)

    expect(log.queries - before).toBe(1)
  })

  test('empty parents → empty Map, 0 queries', async () => {
    const { db } = await makeDB()
    const log = makeQueryLog()
    const bound = db.withCtx({}, undefined, log)

    const result = await bound.loadRelation([], 'author', postsTable)
    expect(log.queries).toBe(0)
    expect(result.size).toBe(0)
  })
})

describe('loadRelation — name-based (hasMany)', () => {
  test('resolves hasMany relation — FK on foreign table', async () => {
    const { db } = await makeDB()
    const bound = db.withCtx({})

    const users = await bound.from(usersTable).select()
    const postsMap = await bound.loadRelation(users, 'posts', usersTable)

    // Alice (id=1) has 2 posts, Bob (id=2) has 1
    const alicePosts = postsMap.get(1) as { title: string }[]
    expect(alicePosts).toHaveLength(2)
    const bobPosts = postsMap.get(2) as { title: string }[]
    expect(bobPosts).toHaveLength(1)
  })
})

// ── loadRelationOne — name-based ──────────────────────────────────────────────

describe('loadRelationOne — name-based (belongsTo)', () => {
  test('resolves belongsTo and returns single entity per key', async () => {
    const { db } = await makeDB()
    const bound = db.withCtx({})

    const posts = await bound.from(postsTable).select()
    const authorMap = await bound.loadRelationOne(posts, 'author', postsTable)

    const alice = authorMap.get(1) as { name: string } | undefined
    expect(alice?.name).toBe('Alice')
    const bob = authorMap.get(2) as { name: string } | undefined
    expect(bob?.name).toBe('Bob')
  })

  test('empty parents → empty Map, 0 queries', async () => {
    const { db } = await makeDB()
    const log = makeQueryLog()
    const bound = db.withCtx({}, undefined, log)

    const result = await bound.loadRelationOne([], 'author', postsTable)
    expect(log.queries).toBe(0)
    expect(result.size).toBe(0)
  })
})

// ── Unhappy path ──────────────────────────────────────────────────────────────

describe('loadRelation — unhappy path (name-based)', () => {
  test('unknown relation name throws with table name and available relations listed', async () => {
    const { db } = await makeDB()
    const bound = db.withCtx({})

    const posts = await bound.from(postsTable).select()
    await expect(
      bound.loadRelation(posts, 'unknownRelation', postsTable),
    ).rejects.toThrow("Relation 'unknownRelation' is not defined on table 'posts'")
  })

  test('error message lists available relations', async () => {
    const { db } = await makeDB()
    const bound = db.withCtx({})

    const posts = await bound.from(postsTable).select()
    await expect(
      bound.loadRelation(posts, 'unknownRelation', postsTable),
    ).rejects.toThrow('author')  // 'author' is a known relation — should appear in message
  })

  test('table with no relations shows (none) in error', async () => {
    const tableNoRels = defineTable('noop', {
      id: column.integer().primaryKey(),
    }).build()

    const { db } = await makeDB()
    const bound = db.withCtx({})

    await expect(
      bound.loadRelation([{ id: 1 }], 'something', tableNoRels),
    ).rejects.toThrow('(none)')
  })

  test('manyToMany via name-based call throws NotImplemented error', async () => {
    const { db } = await makeDB()
    const bound = db.withCtx({})

    const posts = [{ id: 1, title: 'Post' }]
    await expect(
      bound.loadRelation(posts, 'tags', postsWithManyToMany),
    ).rejects.toThrow('manyToMany relations are not yet supported in loadRelation')
  })

  test('loadRelationOne on hasMany relation throws informative error', async () => {
    const { db } = await makeDB()
    const bound = db.withCtx({})

    const users = await bound.from(usersTable).select()
    await expect(
      bound.loadRelationOne(users, 'posts', usersTable),
    ).rejects.toThrow("loadRelationOne cannot be used with hasMany relation 'posts'")
  })
})
