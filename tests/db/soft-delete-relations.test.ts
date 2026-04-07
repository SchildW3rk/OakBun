import { describe, test, expect } from 'bun:test'
import { SQLiteAdapter }    from '../../packages/core/src/adapter/sqlite'
import { HookExecutor }     from '../../packages/core/src/hooks/executor'
import { VelnDB }           from '../../packages/core/src/db/index'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column }           from '../../packages/core/src/schema/column'

// ── Schema ──────────────────────────────────────────────────────────────────

let postsRef: typeof postsTable

const usersTable = defineTable('users', {
  id:        column.integer().primaryKey(),
  name:      column.text(),
  deletedAt: column.timestamp().nullable(),
})
  .withSoftDelete('deletedAt')
  .hasMany('posts', () => postsRef, 'authorId')
  .build()

const commentsTable = defineTable('comments', {
  id:        column.integer().primaryKey(),
  body:      column.text(),
  postId:    column.integer(),
  deletedAt: column.timestamp().nullable(),
})
  .withSoftDelete('deletedAt')
  .build()

const postsTable = defineTable('posts', {
  id:        column.integer().primaryKey(),
  title:     column.text(),
  authorId:  column.integer(),
})
  .belongsTo('author', () => usersTable, 'authorId')
  .hasMany('comments', () => commentsTable, 'postId')
  .build()

postsRef = postsTable

// ── Helper ───────────────────────────────────────────────────────────────────

async function makeDB() {
  const adapter = new SQLiteAdapter()
  await adapter.execute(toCreateTableSql(usersTable))
  await adapter.execute(toCreateTableSql(postsTable))
  await adapter.execute(toCreateTableSql(commentsTable))

  // Users: Alice(1) live, Bob(2) soft-deleted
  await adapter.execute(`INSERT INTO "users" ("name", "deletedAt") VALUES (?, ?)`, ['Alice', null])
  await adapter.execute(`INSERT INTO "users" ("name", "deletedAt") VALUES (?, ?)`, ['Bob', '2024-01-01T00:00:00.000Z'])

  // Posts: 2 from Alice, 1 from Bob
  await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['Post A1', 1])
  await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['Post A2', 1])
  await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['Post B1', 2])

  // Comments: 2 on post1, 1 soft-deleted; 1 on post2
  await adapter.execute(`INSERT INTO "comments" ("body", "postId", "deletedAt") VALUES (?, ?, ?)`, ['C1', 1, null])
  await adapter.execute(`INSERT INTO "comments" ("body", "postId", "deletedAt") VALUES (?, ?, ?)`, ['C2-deleted', 1, '2024-01-01T00:00:00.000Z'])
  await adapter.execute(`INSERT INTO "comments" ("body", "postId", "deletedAt") VALUES (?, ?, ?)`, ['C3', 2, null])

  const hooks = new HookExecutor()
  return new VelnDB(adapter, hooks).withCtx({})
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('soft delete — relations', () => {
  describe('.with() belongsTo — filters deleted foreign rows', () => {
    test('soft-deleted author resolves to null', async () => {
      const db = await makeDB()
      const posts = await db.from(postsTable).with({ author: true }).select()

      const postB = posts.find((p) => p.id === 3)!
      // authorId=2 (Bob) is soft-deleted → should be null
      expect(postB.author).toBeNull()
    })

    test('non-deleted author resolves normally', async () => {
      const db = await makeDB()
      const posts = await db.from(postsTable).with({ author: true }).select()

      const postA = posts.find((p) => p.id === 1)!
      expect(postA.author).not.toBeNull()
      expect(postA.author!.name).toBe('Alice')
    })
  })

  describe('.with() hasMany — filters deleted children', () => {
    test('soft-deleted comments not included', async () => {
      const db = await makeDB()
      const posts = await db.from(postsTable).with({ comments: true }).select()

      const post1 = posts.find((p) => p.id === 1)!
      // post1 has 2 comments but 1 is soft-deleted → only 1 visible
      expect(post1.comments).toHaveLength(1)
      expect(post1.comments[0]!.body).toBe('C1')
    })

    test('all live comments included', async () => {
      const db = await makeDB()
      const posts = await db.from(postsTable).with({ comments: true }).select()

      const post2 = posts.find((p) => p.id === 2)!
      expect(post2.comments).toHaveLength(1)
      expect(post2.comments[0]!.body).toBe('C3')
    })
  })

  describe('.with() hasMany on users — filters deleted posts', () => {
    test('users hasMany posts — soft delete on posts table (no soft delete = all shown)', async () => {
      const db = await makeDB()
      // posts table has NO soft delete — all posts visible in hasMany
      const users = await db.from(usersTable).with({ posts: true }).select()
      // Only Alice is visible (Bob soft-deleted)
      expect(users).toHaveLength(1)
      expect(users[0]!.name).toBe('Alice')
      // Alice has 2 posts
      expect(users[0]!.posts).toHaveLength(2)
    })
  })

  describe('loadRelation — filters soft-deleted foreign rows', () => {
    test('loadRelation explicit — respects soft delete on child table', async () => {
      const db = await makeDB()
      const posts = await db.from(postsTable).select()

      // loadRelation (explicit) — authorId → usersTable.id
      const authorMap = await db.loadRelation(posts, 'authorId', usersTable, 'id')

      // Bob (id=2) is soft-deleted — should not appear in map
      const bobsGroup = authorMap.get(2)
      expect(bobsGroup).toBeUndefined()

      // Alice (id=1) should appear
      const alicesGroup = authorMap.get(1)
      expect(alicesGroup).toBeDefined()
      expect(alicesGroup![0]!.name).toBe('Alice')
    })

    test('loadRelation name-based — respects soft delete', async () => {
      const db = await makeDB()
      const posts = await db.from(postsTable).select()
      const authorMap = await db.loadRelation(posts, 'author', postsTable)

      // Bob soft-deleted → his entry absent
      expect(authorMap.get(2)).toBeUndefined()
    })

    test('loadRelationOne — respects soft delete', async () => {
      const db = await makeDB()
      const posts = await db.from(postsTable).select()
      const authorMap = await db.loadRelationOne(posts, 'author', postsTable)

      // Post B1 (authorId=2, Bob soft-deleted) → no entry
      expect(authorMap.get(2)).toBeUndefined()
    })
  })
})
