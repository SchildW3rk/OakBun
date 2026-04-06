import { describe, test, expect, beforeEach } from 'bun:test'
import { SQLiteAdapter }    from '../../packages/core/src/adapter/sqlite'
import { HookExecutor }     from '../../packages/core/src/hooks/executor'
import { VelnDB }           from '../../packages/core/src/db/index'
import type { QueryLog }    from '../../packages/core/src/db/index'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import type { WithRelations } from '../../packages/core/src/schema/table'
import { column }           from '../../packages/core/src/schema/column'

// ── Schema ──────────────────────────────────────────────────────────────────

// Forward-declare for circular reference
let postsRef: typeof postsTable

const usersTable = defineTable('users', {
  id:   column.integer().primaryKey(),
  name: column.text(),
})
  .hasMany('posts', () => postsRef, 'authorId')
  .build()

const commentsTable = defineTable('comments', {
  id:     column.integer().primaryKey(),
  body:   column.text(),
  postId: column.integer(),
}).build()

const postsTable = defineTable('posts', {
  id:       column.integer().primaryKey(),
  title:    column.text(),
  authorId: column.integer(),
})
  .belongsTo('author', () => usersTable, 'authorId')
  .hasMany('comments', () => commentsTable, 'postId')
  .build()

postsRef = postsTable

// ── Helpers ──────────────────────────────────────────────────────────────────

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

  // Posts — Alice(1): 2, Bob(2): 1
  await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['Post A1', 1])
  await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['Post A2', 1])
  await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['Post B1', 2])

  // Comments — Post 1: 2, Post 2: 1, Post 3: 0
  await adapter.execute(`INSERT INTO "comments" ("body", "postId") VALUES (?, ?)`, ['C1', 1])
  await adapter.execute(`INSERT INTO "comments" ("body", "postId") VALUES (?, ?)`, ['C2', 1])
  await adapter.execute(`INSERT INTO "comments" ("body", "postId") VALUES (?, ?)`, ['C3', 2])

  const hooks = new HookExecutor()
  const db = new VelnDB(adapter, hooks)
  return db.withCtx({})
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('eager loading — .with()', () => {
  describe('belongsTo', () => {
    test('attaches author to each post', async () => {
      const db = await makeDB()
      const posts = await db.from(postsTable).with({ author: true }).select()

      expect(posts).toHaveLength(3)
      expect(posts[0].author).toMatchObject({ id: 1, name: 'Alice' })
      expect(posts[1].author).toMatchObject({ id: 1, name: 'Alice' })
      expect(posts[2].author).toMatchObject({ id: 2, name: 'Bob' })
    })

    test('issues only 2 queries total — no N+1', async () => {
      const adapter = new SQLiteAdapter()
      await adapter.execute(toCreateTableSql(usersTable))
      await adapter.execute(toCreateTableSql(postsTable))
      await adapter.execute(`INSERT INTO "users" ("name") VALUES (?)`, ['Alice'])
      await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['P1', 1])
      await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['P2', 1])
      await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['P3', 1])

      const log = makeQueryLog()
      const hooks = new HookExecutor()
      const veln = new VelnDB(adapter, hooks)
      const db = veln.withCtx({}, undefined, log)

      await db.from(postsTable).with({ author: true }).select()

      // 1 SELECT posts + 1 SELECT users IN (...)
      expect(log.queries).toBe(2)
    })

    test('null for missing FK', async () => {
      const adapter = new SQLiteAdapter()
      await adapter.execute(toCreateTableSql(usersTable))
      await adapter.execute(toCreateTableSql(postsTable))
      // post with no matching author
      await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['Orphan', 999])

      const hooks = new HookExecutor()
      const db = new VelnDB(adapter, hooks).withCtx({})
      const posts = await db.from(postsTable).with({ author: true }).select()

      expect(posts[0].author).toBeNull()
    })

    test('empty result set returns empty array without extra query', async () => {
      const adapter = new SQLiteAdapter()
      await adapter.execute(toCreateTableSql(usersTable))
      await adapter.execute(toCreateTableSql(postsTable))

      const log = makeQueryLog()
      const hooks = new HookExecutor()
      const db = new VelnDB(adapter, hooks).withCtx({}, undefined, log)

      const posts = await db.from(postsTable).with({ author: true }).select()
      expect(posts).toHaveLength(0)
      // Only the main SELECT — no relation query needed for empty set
      expect(log.queries).toBe(1)
    })
  })

  describe('hasMany', () => {
    test('attaches comments array to each post', async () => {
      const db = await makeDB()
      const posts = await db.from(postsTable).with({ comments: true }).select()

      expect(posts).toHaveLength(3)
      const p1 = posts.find((p) => p.id === 1)!
      const p2 = posts.find((p) => p.id === 2)!
      const p3 = posts.find((p) => p.id === 3)!

      expect(p1.comments).toHaveLength(2)
      expect(p2.comments).toHaveLength(1)
      expect(p3.comments).toHaveLength(0)
    })

    test('issues only 2 queries total — no N+1', async () => {
      const adapter = new SQLiteAdapter()
      await adapter.execute(toCreateTableSql(usersTable))
      await adapter.execute(toCreateTableSql(postsTable))
      await adapter.execute(toCreateTableSql(commentsTable))
      await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['P1', 1])
      await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['P2', 1])
      await adapter.execute(`INSERT INTO "comments" ("body", "postId") VALUES (?, ?)`, ['C1', 1])
      await adapter.execute(`INSERT INTO "comments" ("body", "postId") VALUES (?, ?)`, ['C2', 2])

      const log = makeQueryLog()
      const hooks = new HookExecutor()
      const db = new VelnDB(adapter, hooks).withCtx({}, undefined, log)

      await db.from(postsTable).with({ comments: true }).select()
      expect(log.queries).toBe(2)
    })

    test('hasMany on users — loads posts per user', async () => {
      const db = await makeDB()
      const users = await db.from(usersTable).with({ posts: true }).select()

      expect(users).toHaveLength(2)
      const alice = users.find((u) => u.id === 1)!
      const bob   = users.find((u) => u.id === 2)!

      expect(alice.posts).toHaveLength(2)
      expect(bob.posts).toHaveLength(1)
    })

    test('empty parent set produces no children query', async () => {
      const adapter = new SQLiteAdapter()
      await adapter.execute(toCreateTableSql(postsTable))
      await adapter.execute(toCreateTableSql(commentsTable))

      const log = makeQueryLog()
      const hooks = new HookExecutor()
      const db = new VelnDB(adapter, hooks).withCtx({}, undefined, log)

      const posts = await db.from(postsTable).with({ comments: true }).select()
      expect(posts).toHaveLength(0)
      expect(log.queries).toBe(1)
    })
  })

  describe('multiple relations at once', () => {
    test('loads author + comments in one .with() call', async () => {
      const db = await makeDB()
      const posts = await db.from(postsTable).with({ author: true, comments: true }).select()

      const p1 = posts.find((p) => p.id === 1)!
      expect(p1.author).toMatchObject({ name: 'Alice' })
      expect(p1.comments).toHaveLength(2)
    })

    test('issues 3 queries for 2 relations — no N+1', async () => {
      const log = makeQueryLog()
      const adapter = new SQLiteAdapter()
      await adapter.execute(toCreateTableSql(usersTable))
      await adapter.execute(toCreateTableSql(postsTable))
      await adapter.execute(toCreateTableSql(commentsTable))
      await adapter.execute(`INSERT INTO "users" ("name") VALUES (?)`, ['Alice'])
      await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['P1', 1])
      await adapter.execute(`INSERT INTO "comments" ("body", "postId") VALUES (?, ?)`, ['C1', 1])

      const hooks = new HookExecutor()
      const db = new VelnDB(adapter, hooks).withCtx({}, undefined, log)

      await db.from(postsTable).with({ author: true, comments: true }).select()
      // 1 main + 1 users IN + 1 comments IN
      expect(log.queries).toBe(3)
    })
  })

  describe('composability', () => {
    test('.with() can be combined with .where()', async () => {
      const db = await makeDB()
      const posts = await db.from(postsTable)
        .where({ authorId: 1 })
        .with({ author: true })
        .select()

      expect(posts).toHaveLength(2)
      for (const p of posts) {
        expect(p.author?.name).toBe('Alice')
      }
    })

    test('.with() can be combined with .limit()', async () => {
      const db = await makeDB()
      const posts = await db.from(postsTable)
        .with({ author: true })
        .limit(1)
        .select()

      expect(posts).toHaveLength(1)
      expect(posts[0].author).not.toBeNull()
    })

    test('.with() can be combined with .orderBy()', async () => {
      const db = await makeDB()
      const posts = await db.from(postsTable)
        .orderBy('id', 'DESC')
        .with({ author: true })
        .select()

      expect(posts[0].id).toBe(3)
      expect(posts[0].author).toMatchObject({ name: 'Bob' })
    })

    test('.first() works with .with()', async () => {
      const db = await makeDB()
      const post = await db.from(postsTable).with({ author: true }).first()

      expect(post).not.toBeNull()
      expect(post!.author).toMatchObject({ name: 'Alice' })
    })
  })

  describe('error cases', () => {
    test('throws for manyToMany relation', async () => {
      const tagsTable = defineTable('tags', {
        id: column.integer().primaryKey(),
        name: column.text(),
      }).build()

      const pivotTable = defineTable('post_tags', {
        postId: column.integer().primaryKey(),
        tagId:  column.integer().primaryKey(),
      }).build()

      const postsWithTags = defineTable('posts', {
        id:       column.integer().primaryKey(),
        title:    column.text(),
        authorId: column.integer(),
      })
        .manyToMany('tags', () => tagsTable, pivotTable, 'postId', 'tagId')
        .build()

      const adapter = new SQLiteAdapter()
      await adapter.execute(toCreateTableSql(postsWithTags))
      // Insert a row so _executeWith is not short-circuited by empty result
      await adapter.execute(`INSERT INTO "posts" ("title", "authorId") VALUES (?, ?)`, ['P', 1])

      const hooks = new HookExecutor()
      const db = new VelnDB(adapter, hooks).withCtx({})

      // manyToMany: with() should throw at runtime (not at the .with() call)
      await expect(
        db.from(postsWithTags).with({ tags: true }).select(),
      ).rejects.toThrow(/manyToMany eager loading is not yet supported/)
    })
  })

  describe('type safety', () => {
    test('inferred result type includes relation field', async () => {
      const db = await makeDB()
      // TypeScript should infer posts as WithRelations<Post, postsTable, 'author'>
      const posts = await db.from(postsTable).with({ author: true }).select()

      // These are type-level checks — if they compile, the types are correct.
      // Runtime: just verify values.
      const post = posts[0]
      const _author: { id: number; name: string } | null = post.author
      const _title:  string = post.title
      expect(_author).not.toBeUndefined()
      expect(_title).not.toBeUndefined()
    })

    test('hasMany inferred as array type', async () => {
      const db = await makeDB()
      const posts = await db.from(postsTable).with({ comments: true }).select()
      const _comments: { id: number; body: string; postId: number }[] = posts[0].comments
      expect(Array.isArray(_comments)).toBe(true)
    })
  })
})
