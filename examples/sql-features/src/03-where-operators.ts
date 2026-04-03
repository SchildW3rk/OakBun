/**
 * SQL-C — WHERE-Erweiterungen
 *
 * Alle unterstützten Operatoren:
 *   Equality shorthand:  { col: value }            → "col" = ?
 *   Explicit op:         { col: { op, value } }     → "col" op ?
 *   Operators:           =  !=  >  >=  <  <=  IN  NOT IN  LIKE  ILIKE  IS NULL  IS NOT NULL
 *   OR-Gruppe:           { OR: [cond, cond, ...] }
 *   AND-Gruppe:          { AND: [cond, cond, ...] }
 *   Raw SQL:             .whereRaw('sql fragment', [params])
 *
 * ILIKE: nativ auf Postgres, SQLite-Fallback via LOWER(col) LIKE LOWER(?)
 * IN []:     WHERE 1 = 0  (immer false — kein ungültiges SQL)
 * NOT IN []: WHERE 1 = 1  (immer true)
 */

import { createApp, dbPlugin } from 'oakbun'
import { SQLiteAdapter }       from 'oakbun/adapter/sqlite'
import { z }                   from 'zod'
import { usersTable, postsTable, ordersTable } from './schema'

const adapter = new SQLiteAdapter()
const app = createApp()
app.plugin(dbPlugin(adapter))

// GET /users/search?name=alice — case-insensitive LIKE
app.get('/users/search', {
  query: z.object({ name: z.string().optional() }),
  handler: async (ctx) => {
    let query = ctx.db.from(usersTable)
    if (ctx.query.name) {
      query = query.where({ name: { op: 'ILIKE', value: `%${ctx.query.name}%` } })
    }
    return ctx.json(await query.select())
  },
})

// GET /users/admins — role IN list
app.get('/users/admins', async (ctx) => {
  const users = await ctx.db
    .from(usersTable)
    .where({ role: { op: 'IN', value: ['admin', 'superadmin'] } })
    .select()
  return ctx.json(users)
})

// GET /posts/recent — createdAt > 7 Tage
app.get('/posts/recent', async (ctx) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const posts = await ctx.db
    .from(postsTable)
    .where({ createdAt: { op: '>', value: since } })
    .orderBy('createdAt', 'DESC')
    .select()
  return ctx.json(posts)
})

// GET /orders/filter — OR-Gruppe: status paid ODER amount > 500
app.get('/orders/filter', async (ctx) => {
  const orders = await ctx.db
    .from(ordersTable)
    .where({
      OR: [
        { status: 'paid' },
        { amount: { op: '>', value: 500 } },
      ],
    })
    .select()
  return ctx.json(orders)
})

// GET /posts/published — AND-Gruppe mit mehreren Bedingungen
app.get('/posts/published', async (ctx) => {
  const posts = await ctx.db
    .from(postsTable)
    .where({
      AND: [
        { published: true },
        { views: { op: '>=', value: 10 } },
      ],
    })
    .select()
  return ctx.json(posts)
})

// GET /users/no-email — IS NULL check
app.get('/users/no-email', async (ctx) => {
  const users = await ctx.db
    .from(usersTable)
    .where({ email: { op: 'IS NULL' } })
    .select()
  return ctx.json(users)
})

// GET /orders/custom — raw SQL für komplexe Ausdrücke
app.get('/orders/custom', async (ctx) => {
  const orders = await ctx.db
    .from(ordersTable)
    .whereRaw('"amount" * 1.19 > ?', [100])  // Betrag inkl. MwSt > 100
    .select()
  return ctx.json(orders)
})

export { app }
