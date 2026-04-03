import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { z } from 'zod'

describe('response validation', () => {
  test('validateResponse: false (default) — no check', async () => {
    const app = createApp()
    app.post(
      '/items',
      { body: z.object({ name: z.string() }), response: z.object({ id: z.number() }) },
      (ctx) => ctx.json({ wrong: 'field' }),  // invalid response
    )
    // Should pass through — validateResponse is false by default
    const res = await app.fetch(new Request('http://localhost/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    }))
    expect(res.status).toBe(200)  // not 500
  })

  test('validateResponse: true — valid response passes through', async () => {
    const app = createApp()
    app.options({ validateResponse: true })
    app.post(
      '/items',
      { body: z.object({ name: z.string() }), response: z.object({ id: z.number() }) },
      (ctx) => ctx.json({ id: 1 }),
    )
    const res = await app.fetch(new Request('http://localhost/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    }))
    expect(res.status).toBe(200)
  })

  test('validateResponse: true — invalid response → 500', async () => {
    const app = createApp()
    app.options({ validateResponse: true })
    app.post(
      '/items',
      { body: z.object({ name: z.string() }), response: z.object({ id: z.number() }) },
      (ctx) => ctx.json({ wrong: 'no id field' }),  // missing id
    )
    const res = await app.fetch(new Request('http://localhost/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    }))
    expect(res.status).toBe(500)
  })

  test('no response schema — no check regardless of setting', async () => {
    const app = createApp()
    app.options({ validateResponse: true })
    app.get('/health', (ctx) => ctx.json({ anything: true }))
    const res = await app.fetch(new Request('http://localhost/health'))
    expect(res.status).toBe(200)
  })
})
