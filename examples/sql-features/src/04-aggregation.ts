/**
 * SQL-D — Aggregation: GROUP BY / COUNT / SUM / AVG / MIN / MAX / HAVING
 *
 * Skalare Terminals (geben direkt einen Wert zurück):
 *   .count()          → SELECT COUNT(*) → number
 *   .count('col')     → SELECT COUNT("col") → number
 *   .sum('col')       → SELECT SUM("col") → number (0 wenn keine Rows)
 *   .avg('col')       → SELECT AVG("col") → number (0 wenn keine Rows)
 *   .min('col')       → SELECT MIN("col") → number | string | null
 *   .max('col')       → SELECT MAX("col") → number | string | null
 *
 * Gruppierte Aggregation:
 *   .groupBy(...cols).aggregate({ alias: { fn, col? } })
 *   → gibt (Partial<T> & TAgg)[] zurück — eine Row pro Gruppe
 *
 * Spaltenauswahl:
 *   .columns('id', 'name') → SELECT "id", "name" — Pick<T, K>-Typ
 *
 * HAVING:
 *   .having(conditions) — gleiche Syntax wie .where(), filtert Gruppen
 */

import { createApp, dbPlugin } from 'oakbun'
import { SQLiteAdapter }       from 'oakbun/adapter/sqlite'
import { ordersTable, postsTable } from './schema'

const adapter = new SQLiteAdapter()
const app = createApp().plugin(dbPlugin(adapter))

// GET /orders/stats — skalare Aggregates auf gefiltertem Set
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

// GET /orders/by-status — GROUP BY status mit mehreren Aggregates
app.get('/orders/by-status', async (ctx) => {
  const rows = await ctx.db
    .from(ordersTable)
    .groupBy('status')
    .aggregate<{ cnt: number; total: number; avg: number }>({
      cnt:   { fn: 'COUNT' },
      total: { fn: 'SUM', col: 'amount' },
      avg:   { fn: 'AVG', col: 'amount' },
    })

  // rows: { status: string; cnt: number; total: number; avg: number }[]
  return ctx.json(rows)
})

// GET /orders/big-groups — HAVING: nur Gruppen mit > 2 Bestellungen
app.get('/orders/big-groups', async (ctx) => {
  const rows = await ctx.db
    .from(ordersTable)
    .groupBy('status')
    .having({ cnt: { op: '>', value: 2 } } as any)
    .aggregate<{ cnt: number }>({ cnt: { fn: 'COUNT' } })

  return ctx.json(rows)
})

// GET /posts/ids — nur bestimmte Spalten selektieren
app.get('/posts/ids', async (ctx) => {
  const posts = await ctx.db
    .from(postsTable)
    .columns('id', 'title')  // → Pick<Post, 'id' | 'title'>[]
    .select()

  // posts[0].id und posts[0].title sind typisiert
  // posts[0].authorId würde TypeScript-Fehler werfen
  return ctx.json(posts)
})

// GET /posts/top — kombiniert: WHERE + columns + orderBy + limit
app.get('/posts/top', async (ctx) => {
  const posts = await ctx.db
    .from(postsTable)
    .where({ published: true })
    .columns('id', 'title', 'views')
    .orderBy('views', 'DESC')
    .limit(5)
    .select()

  return ctx.json(posts)
})

export { app }
