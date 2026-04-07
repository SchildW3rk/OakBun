/**
 * SQL-F — Relationship Loader: db.loadRelation() / db.loadRelationOne()
 *
 * DataLoader-Pattern — kein N+1, genau 1 IN-Query:
 *
 *   loadRelation(parents, fk, childTable, pk)
 *   → Map<fkValue, TChild[]>    — für 1:n (ein Post, viele Comments)
 *
 *   loadRelationOne(parents, fk, childTable, pk)
 *   → Map<fkValue, TChild>      — für n:1 (ein Post, ein Author)
 *
 * Beide Methoden:
 *   - Deduplizieren die FK-Werte via Set vor dem IN-Query
 *   - Geben bei leeren parents sofort eine leere Map zurück (kein Query)
 *   - Sind vollständig typisiert — kein any, kein as
 *
 * Erzeugte SQL (Beispiel mit 3 Posts von 2 Autoren):
 *   SELECT * FROM "users" WHERE "id" IN (1, 2)    ← exakt 1 Query
 */

import { createApp, dbPlugin } from 'oakbun'
import { SQLiteAdapter }       from 'oakbun/adapter/sqlite'
import { postsTable, usersTable, ordersTable } from './schema'

const adapter = new SQLiteAdapter()
const app = createApp().plugin(dbPlugin(adapter))

// GET /posts/with-authors — n:1 (jeder Post hat einen Author)
app.get('/posts/with-authors', async (ctx) => {
  const posts = await ctx.db.from(postsTable).select()

  // loadRelationOne: posts.authorId → users.id
  // → Map<authorId, User>
  const authorMap = await ctx.db.loadRelationOne(
    posts,
    'authorId',
    usersTable,
    'id',
  )

  const result = posts.map((post) => ({
    ...post,
    author: authorMap.get(post.authorId) ?? null,
  }))

  return ctx.json(result)
})

// GET /users/with-orders — 1:n (jeder User kann viele Orders haben)
app.get('/users/with-orders', async (ctx) => {
  const users = await ctx.db.from(usersTable).select()

  // loadRelation: users.id → orders.userId
  // → Map<userId, Order[]>
  const orderMap = await ctx.db.loadRelation(
    users,
    'id',
    ordersTable,
    'userId',
  )

  const result = users.map((user) => ({
    ...user,
    orders: orderMap.get(user.id) ?? [],
  }))

  return ctx.json(result)
})

// GET /posts/full — verschachtelt: Posts + Authors + Orders des Authors
app.get('/posts/full', async (ctx) => {
  const posts = await ctx.db
    .from(postsTable)
    .where({ published: true })
    .select()

  // Schritt 1: Authors laden (n:1)
  const authorMap = await ctx.db.loadRelationOne(posts, 'authorId', usersTable, 'id')

  // Schritt 2: Orders der Authors laden (1:n) — nur unique Authors
  const authors = [...authorMap.values()]
  const orderMap = await ctx.db.loadRelation(authors, 'id', ordersTable, 'userId')

  const result = posts.map((post) => {
    const author = authorMap.get(post.authorId) ?? null
    return {
      ...post,
      author: author
        ? { ...author, orders: orderMap.get(author.id) ?? [] }
        : null,
    }
  })

  // Gesamte Query-Anzahl: immer exakt 3, unabhängig von Datenmenge
  return ctx.json(result)
})

export { app }
