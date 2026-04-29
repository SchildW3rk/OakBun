/**
 * OakBun benchmark server — minimal, native setup.
 * Runs on port 3000 by default.
 *
 * No plugins, no middleware, no logging — pure router + handler overhead.
 */

import { createApp } from 'oakbun'

const PORT = Number(process.env.PORT ?? 3000)

const app = createApp()

app.get('/health', (ctx) => ctx.text('OK'))

app.get('/api/users/:id', async (ctx) => {
  const { id } = ctx.params
  await new Promise((r) => setTimeout(r, 1))
  return ctx.json({ id, name: 'Test User', status: 'active' })
})

app.listen(PORT, (port) => {
  console.log(`[oakbun] listening on http://localhost:${port}`)
})
