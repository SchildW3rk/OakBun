/**
 * Hono benchmark server — minimal, native setup.
 * Runs on port 3001 by default.
 *
 * No middleware, no logging — pure router + handler overhead.
 */

import { Hono } from 'hono'

const PORT = Number(process.env.PORT ?? 3001)

const app = new Hono()

app.get('/health', (c) => c.text('OK'))

app.get('/api/users/:id', async (c) => {
  const id = c.req.param('id')
  await new Promise((r) => setTimeout(r, 1))
  return c.json({ id, name: 'Test User', status: 'active' })
})

Bun.serve({
  port: PORT,
  fetch: app.fetch,
})

console.log(`[hono] listening on http://localhost:${PORT}`)
