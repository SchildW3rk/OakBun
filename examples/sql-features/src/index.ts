/**
 * SQL Features — Komplettes Beispiel
 *
 * Dieses Beispiel zeigt alle 8 SQL-Specs in einem laufenden Server:
 *
 *   SQL-A  Query Logging + Slow-Query Detection  →  dbPlugin({ log: ... })
 *   SQL-B  Pagination                            →  .limit() .offset() .page()
 *   SQL-C  WHERE-Erweiterungen                   →  .where({ op, value }) .whereRaw()
 *   SQL-D  Aggregation                           →  .groupBy() .aggregate() .count() .sum() ...
 *   SQL-E  N+1 Detection                         →  createApp({ db: { log: { n1Threshold } } })
 *   SQL-F  Relation Loader                       →  .loadRelation() .loadRelationOne()
 *   SQL-G  Raw SQL + JoinBuilder Generic         →  .raw(sql, params, schema) .select<T>()
 *   SQL-H  Migrations: allowDestructive + Hooks  →  createMigrator({ onBeforeMigrate, ... })
 *
 * Routes (alle GET für einfaches Testen im Browser):
 *
 *   GET  /users                    — alle User
 *   GET  /users/search?name=alice  — ILIKE-Suche (SQL-C)
 *   GET  /users/admins             — role IN ['admin', 'superadmin'] (SQL-C)
 *   GET  /users/no-email           — IS NULL check (SQL-C)
 *   GET  /users/with-orders        — 1:n Relation (SQL-F)
 *
 *   GET  /posts                    — paginiert (SQL-B)
 *   GET  /posts/window             — LIMIT/OFFSET (SQL-B)
 *   GET  /posts/recent             — createdAt > 7 Tage (SQL-C)
 *   GET  /posts/published          — AND-Gruppe (SQL-C)
 *   GET  /posts/with-authors       — n:1 Relation (SQL-F)
 *   GET  /posts/full               — verschachtelt: Posts + Authors + Orders (SQL-F)
 *   GET  /posts/ids                — columns() Projektion (SQL-D)
 *   GET  /posts/top                — WHERE + columns + orderBy + limit (SQL-D)
 *   GET  /posts/raw                — db.raw() ohne Schema (SQL-G)
 *   GET  /posts/stats              — db.raw() mit Zod-Schema (SQL-G)
 *   GET  /posts/joined             — JoinBuilder.select<T>() (SQL-G)
 *   GET  /posts/first-joined       — JoinBuilder.first<T>() (SQL-G)
 *   GET  /posts-bad                — N+1 Anti-Pattern → Warning (SQL-E)
 *   GET  /posts-good               — loadRelationOne → kein Warning (SQL-E, SQL-F)
 *
 *   GET  /orders/stats             — skalare Aggregates (SQL-D)
 *   GET  /orders/by-status         — GROUP BY + multiple aggregates (SQL-D)
 *   GET  /orders/big-groups        — GROUP BY + HAVING (SQL-D)
 *   GET  /orders/filter            — OR-Gruppe (SQL-C)
 *   GET  /orders/custom            — whereRaw (SQL-C)
 */

import { createApp, dbPlugin, toCreateTableSql } from 'oakbun'
import { SQLiteAdapter }                          from 'oakbun/adapter/sqlite'
import { z }                                      from 'zod'
import { usersTable, postsTable, ordersTable }    from './schema'

// ── Setup ─────────────────────────────────────────────────────────────────────

const adapter = new SQLiteAdapter()

// Seed the DB on startup
await adapter.execute(toCreateTableSql(usersTable))
await adapter.execute(toCreateTableSql(postsTable))
await adapter.execute(toCreateTableSql(ordersTable))

// Seed users
for (const [name, email, role] of [
  ['Alice', 'alice@example.com', 'admin'],
  ['Bob',   'bob@example.com',   'user'],
  ['Carol', 'carol@example.com', 'user'],
]) {
  await adapter.execute(
    `INSERT OR IGNORE INTO "users" ("name", "email", "role") VALUES (?, ?, ?)`,
    [name, email, role],
  )
}

// Seed posts
for (const [title, authorId, published, views] of [
  ['Hello World',   1, 1, 42],
  ['Draft Post',    1, 0, 0],
  ['Bun is fast',   2, 1, 120],
  ['TypeScript FTW', 2, 1, 87],
  ['Draft 2',       3, 0, 5],
]) {
  await adapter.execute(
    `INSERT OR IGNORE INTO "posts" ("title", "authorId", "published", "views") VALUES (?, ?, ?, ?)`,
    [title, authorId, published, views],
  )
}

// Seed orders
for (const [userId, amount, status] of [
  [1, 100, 'paid'],   [1, 200, 'paid'],   [1, 50,  'refunded'],
  [2, 300, 'paid'],   [2, 80,  'pending'],
  [3, 600, 'pending'],
]) {
  await adapter.execute(
    `INSERT OR IGNORE INTO "orders" ("userId", "amount", "status") VALUES (?, ?, ?)`,
    [userId, amount, status],
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

const app = createApp({
  db: {
    log: {
      enabled:     true,
      n1Threshold: 5,     // SQL-E: warnt ab 6 Queries pro Request
      logQueries:  true,
    },
  },
}).plugin(dbPlugin(adapter))

// ── SQL-B — Pagination ────────────────────────────────────────────────────────

app.get('/posts',
  { query: z.object({ page: z.coerce.number().min(1).default(1), size: z.coerce.number().min(1).max(100).default(10) }) },
  async (ctx) => {
    const posts = await ctx.db
      .from(postsTable)
      .orderBy('views', 'DESC')
      .page(ctx.query.page, ctx.query.size)
      .select()
    return ctx.json({ page: ctx.query.page, size: ctx.query.size, data: posts })
  },
)

app.get('/posts/window',
  { query: z.object({ limit: z.coerce.number().default(5), offset: z.coerce.number().default(0) }) },
  async (ctx) => {
    const posts = await ctx.db
      .from(postsTable)
      .limit(ctx.query.limit)
      .offset(ctx.query.offset)
      .select()
    return ctx.json(posts)
  },
)

// ── SQL-C — WHERE Operators ───────────────────────────────────────────────────

app.get('/users', async (ctx) =>
  ctx.json(await ctx.db.from(usersTable).select()),
)

app.get('/users/search',
  { query: z.object({ name: z.string().optional() }) },
  async (ctx) => {
    let q = ctx.db.from(usersTable)
    if (ctx.query.name) {
      q = q.where({ name: { op: 'ILIKE', value: `%${ctx.query.name}%` } })
    }
    return ctx.json(await q.select())
  },
)

app.get('/users/admins', async (ctx) =>
  ctx.json(
    await ctx.db.from(usersTable)
      .where({ role: { op: 'IN', value: ['admin', 'superadmin'] } })
      .select(),
  ),
)

app.get('/users/no-email', async (ctx) =>
  ctx.json(
    await ctx.db.from(usersTable)
      .where({ email: { op: 'IS NULL' } })
      .select(),
  ),
)

app.get('/posts/recent', async (ctx) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  return ctx.json(
    await ctx.db.from(postsTable)
      .where({ createdAt: { op: '>', value: since } })
      .orderBy('createdAt', 'DESC')
      .select(),
  )
})

app.get('/posts/published', async (ctx) =>
  ctx.json(
    await ctx.db.from(postsTable)
      .where({ AND: [{ published: true }, { views: { op: '>=', value: 10 } }] })
      .select(),
  ),
)

app.get('/orders/filter', async (ctx) =>
  ctx.json(
    await ctx.db.from(ordersTable)
      .where({ OR: [{ status: 'paid' }, { amount: { op: '>', value: 200 } }] })
      .select(),
  ),
)

app.get('/orders/custom', async (ctx) =>
  ctx.json(
    await ctx.db.from(ordersTable)
      .whereRaw('"amount" * 1.19 > ?', [100])
      .select(),
  ),
)

// ── SQL-D — Aggregation ───────────────────────────────────────────────────────

app.get('/orders/stats', async (ctx) => {
  const base = ctx.db.from(ordersTable).where({ status: 'paid' })
  const [count, total, avg, min, max] = await Promise.all([
    base.count(),
    base.sum('amount'),
    base.avg('amount'),
    base.min('amount'),
    base.max('amount'),
  ])
  return ctx.json({ count, total, avg, min, max })
})

app.get('/orders/by-status', async (ctx) => {
  const rows = await ctx.db.from(ordersTable)
    .groupBy('status')
    .aggregate<{ cnt: number; total: number; avg: number }>({
      cnt:   { fn: 'COUNT' },
      total: { fn: 'SUM', col: 'amount' },
      avg:   { fn: 'AVG', col: 'amount' },
    })
  return ctx.json(rows)
})

app.get('/orders/big-groups', async (ctx) => {
  const rows = await ctx.db.from(ordersTable)
    .groupBy('status')
    .having({ cnt: { op: '>', value: 1 } } as any)
    .aggregate<{ cnt: number }>({ cnt: { fn: 'COUNT' } })
  return ctx.json(rows)
})

app.get('/posts/ids', async (ctx) =>
  ctx.json(
    await ctx.db.from(postsTable).columns('id', 'title').select(),
  ),
)

app.get('/posts/top', async (ctx) =>
  ctx.json(
    await ctx.db.from(postsTable)
      .where({ published: true })
      .columns('id', 'title', 'views')
      .orderBy('views', 'DESC')
      .limit(3)
      .select(),
  ),
)

// ── SQL-E — N+1 Detection ─────────────────────────────────────────────────────

app.get('/posts-bad', async (ctx) => {
  const posts = await ctx.db.from(postsTable).select()
  // Anti-Pattern: 1 Query pro Post → N+1-Warning wenn > 5 Posts
  const enriched = await Promise.all(
    posts.map(async (p) => ({
      ...p,
      author: await ctx.db.from(usersTable).where({ id: p.authorId }).first(),
    })),
  )
  return ctx.json(enriched)
})

app.get('/posts-good', async (ctx) => {
  const posts     = await ctx.db.from(postsTable).select()
  const authorMap = await ctx.db.loadRelationOne(posts, 'authorId', usersTable, 'id')
  return ctx.json(posts.map((p) => ({ ...p, author: authorMap.get(p.authorId) ?? null })))
})

// ── SQL-F — Relation Loader ───────────────────────────────────────────────────

app.get('/posts/with-authors', async (ctx) => {
  const posts     = await ctx.db.from(postsTable).select()
  const authorMap = await ctx.db.loadRelationOne(posts, 'authorId', usersTable, 'id')
  return ctx.json(posts.map((p) => ({ ...p, author: authorMap.get(p.authorId) ?? null })))
})

app.get('/users/with-orders', async (ctx) => {
  const users    = await ctx.db.from(usersTable).select()
  const orderMap = await ctx.db.loadRelation(users, 'id', ordersTable, 'userId')
  return ctx.json(users.map((u) => ({ ...u, orders: orderMap.get(u.id) ?? [] })))
})

app.get('/posts/full', async (ctx) => {
  const posts     = await ctx.db.from(postsTable).where({ published: true }).select()
  const authorMap = await ctx.db.loadRelationOne(posts, 'authorId', usersTable, 'id')
  const authors   = [...authorMap.values()]
  const orderMap  = await ctx.db.loadRelation(authors, 'id', ordersTable, 'userId')
  return ctx.json(
    posts.map((p) => {
      const author = authorMap.get(p.authorId) ?? null
      return { ...p, author: author ? { ...author, orders: orderMap.get(author.id) ?? [] } : null }
    }),
  )
})

// ── SQL-G — Raw SQL + JoinBuilder Generic ─────────────────────────────────────

const postStatsSchema = z.object({ id: z.number(), title: z.string(), views: z.number() })

app.get('/posts/raw', async (ctx) =>
  ctx.json(await ctx.db.raw(
    `SELECT "id", "title", "views" FROM "posts" WHERE "published" = ? ORDER BY "views" DESC LIMIT ?`,
    [1, 5],
  )),
)

app.get('/posts/stats', async (ctx) =>
  ctx.json(await ctx.db.raw(
    `SELECT "id", "title", "views" FROM "posts" WHERE "published" = ? ORDER BY "views" DESC LIMIT ?`,
    [1, 5],
    postStatsSchema,
  )),
)

app.get('/posts/joined', async (ctx) =>
  ctx.json(
    await ctx.db
      .join('posts')
      .columns(['posts.id', 'posts.title', 'users.name'])
      .join('users', 'posts.authorId = users.id')
      .where('posts.published = ?', [1])
      .select<{ id: number; title: string; name: string }>(),
  ),
)

app.get('/posts/first-joined', async (ctx) => {
  const row = await ctx.db
    .join('posts')
    .columns(['posts.id', 'posts.title', 'users.name'])
    .join('users', 'posts.authorId = users.id')
    .orderBy('posts.views', 'DESC')
    .first<{ id: number; title: string; name: string }>()
  return row ? ctx.json(row) : ctx.json({ error: 'no posts' }, 404)
})

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 4561)
app.listen(PORT, () => {
  console.log(`SQL Features example running on http://localhost:${PORT}`)
  console.log('')
  console.log('SQL-A  Query Logging:   GET /posts                (check console for N+1 warnings)')
  console.log('SQL-B  Pagination:      GET /posts?page=1&size=3  /posts/window?limit=2&offset=2')
  console.log('SQL-C  WHERE ops:       GET /users/search?name=a  /users/admins  /orders/filter')
  console.log('SQL-D  Aggregation:     GET /orders/stats         /orders/by-status  /posts/top')
  console.log('SQL-E  N+1 Detection:   GET /posts-bad (warning)  /posts-good (clean)')
  console.log('SQL-F  Relations:       GET /posts/with-authors   /users/with-orders  /posts/full')
  console.log('SQL-G  Raw SQL:         GET /posts/raw            /posts/stats  /posts/joined')
  console.log('SQL-H  Migrations:      see 08-migrations.ts')
})
