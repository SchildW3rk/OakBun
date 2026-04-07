/**
 * SQL-G — Raw SQL Type Safety + JoinBuilder Generic Cast
 *
 * db.raw(sql, params?, schema?)
 *   Ohne Schema → Record<string, unknown>[]
 *   Mit Zod     → validiertes T[], wirft ValidationError bei ungültiger Row
 *
 * db.join(...).select<T>()
 *   Expliziter Generic-Cast — TypeScript-seitig, kein Runtime-Check.
 *   Für echte Validierung: db.raw() mit Schema verwenden.
 */

import { createApp, dbPlugin } from 'oakbun'
import { SQLiteAdapter }       from 'oakbun/adapter/sqlite'
import { z }                   from 'zod'
import { postsTable }          from './schema'

const adapter = new SQLiteAdapter()
const app = createApp().plugin(dbPlugin(adapter))

// ── db.raw() ohne Schema ──────────────────────────────────────────────────────

// GET /posts/raw — komplexe Query die der Builder nicht ausdrückt
app.get('/posts/raw', async (ctx) => {
  // Freitext SQL, Params gebunden via ?
  const rows = await ctx.db.raw(
    `SELECT p.id, p.title, COUNT(p.id) AS view_rank
     FROM "posts" p
     WHERE p.published = ?
     GROUP BY p.id
     ORDER BY p.views DESC
     LIMIT ?`,
    [1, 10],
  )
  // rows: Record<string, unknown>[]
  return ctx.json(rows)
})

// ── db.raw() mit Zod-Schema ───────────────────────────────────────────────────

const postStatsSchema = z.object({
  id:        z.number(),
  title:     z.string(),
  view_rank: z.number(),
})

// GET /posts/stats — gleiche Query, aber validiert + typisiert
app.get('/posts/stats', async (ctx) => {
  const rows = await ctx.db.raw(
    `SELECT p.id, p.title, p.views AS view_rank
     FROM "posts" p
     WHERE p.published = ?
     ORDER BY p.views DESC
     LIMIT ?`,
    [1, 10],
    postStatsSchema,  // wirft ValidationError wenn Row nicht passt
  )
  // rows: { id: number; title: string; view_rank: number }[]
  return ctx.json(rows)
})

// ── JoinBuilder.select<T>() Generic-Cast ─────────────────────────────────────

// GET /posts/joined — Join mit explizitem Typ
app.get('/posts/joined', async (ctx) => {
  const rows = await ctx.db
    .join('posts')
    .columns(['posts.id', 'posts.title', 'users.name'])
    .join('users', 'posts.authorId = users.id')
    .where('posts.published = ?', [1])
    .orderBy('posts.id', 'ASC')
    .select<{ id: number; title: string; name: string }>()

  // rows[0].title und rows[0].name sind typisiert — kein any-Cast nötig
  return ctx.json(rows)
})

// GET /posts/first-joined — first<T>() — null wenn kein Ergebnis
app.get('/posts/first-joined', async (ctx) => {
  const row = await ctx.db
    .join('posts')
    .columns(['posts.id', 'posts.title', 'users.name'])
    .join('users', 'posts.authorId = users.id')
    .orderBy('posts.views', 'DESC')
    .first<{ id: number; title: string; name: string }>()

  if (!row) return ctx.json({ error: 'no posts' }, 404)
  return ctx.json(row)
})

// ── Vergleich: raw() mit Schema vs. JoinBuilder ───────────────────────────────

// raw() mit Schema:     Laufzeit-Validierung — sicher, Fehler sofort sichtbar
// JoinBuilder<T>:       Compile-Time-Cast — schneller, kein Overhead, kein Check
//
// Faustregel:
//   Daten aus der eigenen DB, Schema bekannt    → JoinBuilder<T>
//   Daten aus externer Quelle / unsicherem SQL  → raw() mit Zod-Schema

export { app }
