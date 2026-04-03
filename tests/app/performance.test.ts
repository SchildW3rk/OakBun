import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { z } from 'zod'

// ── P3: Route-Matching Cache ───────────────────────────────────────────────────

describe('P3 — Route-matching cache', () => {
  test('cache hit: same path twice — cache size stays at 1', async () => {
    const app = createApp()
    app.get('/users/:id', (ctx) => ctx.json({ id: ctx.params.id }))

    const cache = (app as unknown as { _routeCache: Map<string, unknown> })._routeCache

    // First request — cache miss → populates cache
    await app.fetch(new Request('http://localhost/users/42'))
    expect(cache.size).toBe(1)
    expect(cache.has('GET:/users/42')).toBe(true)

    // Second request — cache hit → no new entry added
    await app.fetch(new Request('http://localhost/users/42'))
    expect(cache.size).toBe(1)
  })

  test('cache miss: new path adds new entry', async () => {
    const app = createApp()
    app.get('/items/:id', (ctx) => ctx.json({ id: ctx.params.id }))

    const cache = (app as unknown as { _routeCache: Map<string, unknown> })._routeCache

    await app.fetch(new Request('http://localhost/items/1'))
    await app.fetch(new Request('http://localhost/items/2'))

    // Two distinct paths → two cache entries
    expect(cache.has('GET:/items/1')).toBe(true)
    expect(cache.has('GET:/items/2')).toBe(true)
  })

  test('cache eviction: > 500 entries removes oldest', async () => {
    const app = createApp()
    // Single route with wildcard-style matching won't be needed — we fill the cache manually
    app.get('/x/:id', (ctx) => ctx.json({ id: ctx.params.id }))

    const cache = (app as unknown as { _routeCache: Map<string, unknown> })._routeCache
    const MAX = (app as unknown as { _ROUTE_CACHE_MAX: number })._ROUTE_CACHE_MAX

    // Fill to exactly MAX entries
    for (let i = 0; i < MAX; i++) {
      cache.set(`GET:/x/${i}`, null)
    }
    // The first key inserted is 'GET:/x/0'
    expect(cache.has('GET:/x/0')).toBe(true)
    expect(cache.size).toBe(MAX)

    // One more fetch triggers eviction
    await app.fetch(new Request('http://localhost/x/evict'))

    // Oldest entry evicted, new one added — size stays at MAX
    expect(cache.size).toBe(MAX)
    expect(cache.has('GET:/x/0')).toBe(false)
    expect(cache.has('GET:/x/evict')).toBe(true)
  })

  test('cache invalidation: register() clears the cache', async () => {
    const app = createApp()
    app.get('/ping', (ctx) => ctx.json({ ok: true }))

    const cache = (app as unknown as { _routeCache: Map<string, unknown> })._routeCache

    // Warm up the cache
    await app.fetch(new Request('http://localhost/ping'))
    expect(cache.size).toBeGreaterThan(0)

    // register() must clear it
    const mod = defineModule('/ext').get('/hello', (ctx) => ctx.json({ hi: true })).build()
    app.register(mod)

    expect(cache.size).toBe(0)
  })
})

// ── P4: Response Validation Clone ─────────────────────────────────────────────

describe('P4 — Response validation clone', () => {
  function makeValidatedApp() {
    const app = createApp({ onInternalError: () => {} })
    app.options({ validateResponse: true })
    return app
  }

  test('validateResponse: true + JSON response → validation runs (schema mismatch → 500)', async () => {
    const app = makeValidatedApp()
    app.get('/typed', { response: z.object({ name: z.string() }) }, (ctx) => ctx.json({ wrong: 'field' }))
    const res = await app.fetch(new Request('http://localhost/typed'))
    expect(res.status).toBe(500)
  })

  test('validateResponse: true + JSON response → passes when schema matches', async () => {
    const app = makeValidatedApp()
    app.get('/typed', { response: z.object({ name: z.string() }) }, (ctx) => ctx.json({ name: 'Alice' }))
    const res = await app.fetch(new Request('http://localhost/typed'))
    expect(res.status).toBe(200)
  })

  test('validateResponse: true + non-JSON (text/event-stream) → no clone, 200 passes through', async () => {
    const app = makeValidatedApp()
    // schema would fail for SSE body — but clone must not be attempted for non-JSON
    app.get('/sse', { response: z.object({ name: z.string() }) }, (_ctx) =>
      new Response('data: hello\n\n', { headers: { 'Content-Type': 'text/event-stream' } }),
    )
    const res = await app.fetch(new Request('http://localhost/sse'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
  })

  test('validateResponse: true + 204 No Content → no clone, passes through', async () => {
    const app = makeValidatedApp()
    app.delete('/items/:id', { response: z.object({ id: z.string() }) }, (_ctx) =>
      new Response(null, { status: 204 }),
    )
    const res = await app.fetch(new Request('http://localhost/items/1', { method: 'DELETE' }))
    expect(res.status).toBe(204)
  })

  test('validateResponse: false → schema never evaluated, response passes through', async () => {
    const app = createApp()  // validateResponse defaults to false
    app.get('/unvalidated', { response: z.object({ name: z.string() }) }, (ctx) =>
      ctx.json({ wrong: 'field' }),  // would fail if validated
    )
    const res = await app.fetch(new Request('http://localhost/unvalidated'))
    expect(res.status).toBe(200)
  })
})
