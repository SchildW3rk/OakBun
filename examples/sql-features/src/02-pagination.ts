/**
 * SQL-B — Pagination: .limit() / .offset() / .page()
 *
 * Drei äquivalente Wege um zu paginieren:
 *   .limit(n)          — LIMIT n
 *   .offset(n)         — OFFSET n (braucht LIMIT, sonst LIMIT -1)
 *   .page(page, size)  — Shorthand: LIMIT size OFFSET (page-1)*size
 *
 * .page(1, 20) → erste Seite, 20 Einträge
 * .page(2, 20) → zweite Seite (OFFSET 20)
 */

import { createApp, dbPlugin } from 'oakbun'
import { SQLiteAdapter }       from 'oakbun/adapter/sqlite'
import { z }                   from 'zod'
import { postsTable }          from './schema'

const adapter = new SQLiteAdapter()
const app = createApp().plugin(dbPlugin(adapter))

// GET /posts?page=1&size=10 — cursor-freie Pagination
app.get('/posts',
  { query: z.object({ page: z.coerce.number().min(1).default(1), size: z.coerce.number().min(1).max(100).default(10) }) },
  async (ctx) => {
    const { page, size } = ctx.query
    const posts = await ctx.db
      .from(postsTable)
      .orderBy('createdAt', 'DESC')
      .page(page, size)
      .select()
    return ctx.json({ page, size, data: posts })
  },
)

// GET /posts/window?limit=5&offset=20 — explizites LIMIT/OFFSET
app.get('/posts/window',
  { query: z.object({ limit: z.coerce.number().min(1).max(100).default(20), offset: z.coerce.number().min(0).default(0) }) },
  async (ctx) => {
    const posts = await ctx.db
      .from(postsTable)
      .orderBy('id', 'ASC')
      .limit(ctx.query.limit)
      .offset(ctx.query.offset)
      .select()
    return ctx.json(posts)
  },
)

export { app }
