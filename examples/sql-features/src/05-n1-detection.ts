/**
 * SQL-E — N+1 Detection per Request
 *
 * createApp({ db: { log: { ... } } }) aktiviert einen QueryLog pro Request.
 * Nach jedem Request prüft das Framework: queries > n1Threshold?
 * → console.warn('[db:n+1] 11 queries in GET /posts — threshold: 10')
 *
 * logQueries: true gibt jedes einzelne SQL mit Timing darunter aus:
 *   [db:n+1] 11 queries in GET /posts — threshold: 10
 *     SELECT * FROM "posts" (0.12ms)
 *     SELECT * FROM "users" WHERE "id" = ? (0.08ms)
 *     ...
 *
 * Der QueryLog wird pro Request zurückgesetzt — kein shared state zwischen
 * gleichzeitigen Requests (BoundVelnDB wrappt den Adapter per-Request).
 */

import { createApp, dbPlugin } from 'oakbun'
import { SQLiteAdapter }       from 'oakbun/adapter/sqlite'
import { postsTable, usersTable } from './schema'

const adapter = new SQLiteAdapter()

const app = createApp({
  db: {
    log: {
      enabled:     true,
      n1Threshold: 10,    // standard: warnt ab 11 Queries
      logQueries:  true,  // SQL-Details im Warning
    },
  },
})

app.plugin(dbPlugin(adapter))

// ❌ Anti-Pattern — löst N+1-Warning aus wenn > 10 Posts vorhanden
app.get('/posts-bad', async (ctx) => {
  const posts = await ctx.db.from(postsTable).select()

  // Ein Query pro Post → N Queries für N Posts
  const enriched = await Promise.all(
    posts.map(async (post) => {
      const author = await ctx.db.from(usersTable).where({ id: post.authorId }).first()
      return { ...post, author }
    }),
  )

  return ctx.json(enriched)
})

// ✅ Korrekt — immer exakt 2 Queries, egal wie viele Posts vorhanden
app.get('/posts-good', async (ctx) => {
  const posts = await ctx.db.from(postsTable).select()

  // loadRelation: ein IN-Query für alle Authors → kein N+1
  const authorMap = await ctx.db.loadRelationOne(posts, 'authorId', usersTable, 'id')

  const enriched = posts.map((post) => ({
    ...post,
    author: authorMap.get(post.authorId) ?? null,
  }))

  return ctx.json(enriched)
})

export { app }
