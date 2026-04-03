/**
 * module-route.test.ts — Spec 05 test suite
 *
 * Covers all cases required by Spec 05 — .route() Feature Parity with Method Shortcuts.
 */

import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { createGuard } from '../../packages/core/src/app/types'
import { z } from 'zod'

// ── .route() with body schema — validation fails → 422 ───────────────────────

describe('.route() with body schema', () => {
  test('valid body → 200 and handler receives body', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .route({
          method:  'POST',
          path:    '/items',
          schema:  { body: z.object({ name: z.string() }) },
          handler: (ctx) => ctx.json({ name: ctx.body.name }),
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/items', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: 'Widget' }),
    }))
    expect(res.status).toBe(200)
    const data = await res.json() as { name: string }
    expect(data.name).toBe('Widget')
  })

  test('invalid body → 422', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .route({
          method:  'POST',
          path:    '/items',
          schema:  { body: z.object({ name: z.string().min(1) }) },
          handler: (ctx) => ctx.json({ ok: true }),
        })
        .build()
    )
    // name is empty — fails min(1)
    const res = await app.fetch(new Request('http://localhost/api/items', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: '' }),
    }))
    expect(res.status).toBe(422)
  })

  // Flat body form (Overload 2) — runtime validation still enforced
  test('flat body: invalid body → 422', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .route({
          method:  'POST',
          path:    '/widgets',
          body:    z.object({ count: z.number().positive() }),
          handler: (ctx) => ctx.json({ ok: true }),
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/widgets', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ count: -1 }),
    }))
    expect(res.status).toBe(422)
  })

  test('flat body: valid body → 200', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .route({
          method:  'POST',
          path:    '/widgets',
          body:    z.object({ count: z.number().positive() }),
          handler: (ctx) => ctx.json({ ok: true }),
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/widgets', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ count: 5 }),
    }))
    expect(res.status).toBe(200)
  })
})

// ── .route() with params schema — coercion works ─────────────────────────────

describe('.route() with params schema', () => {
  test('schema form — z.coerce.number() coerces string to number', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .route({
          method:  'GET',
          path:    '/:id',
          schema:  { params: z.object({ id: z.coerce.number() }) },
          handler: (ctx) => ctx.json({ id: ctx.params.id }),
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/42'))
    expect(res.status).toBe(200)
    const data = await res.json() as { id: number }
    expect(data.id).toBe(42)
    expect(typeof data.id).toBe('number')
  })

  test('flat params form — z.coerce.number() coercion works', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .route({
          method:  'GET',
          path:    '/users/:id',
          params:  z.object({ id: z.coerce.number() }),
          handler: (ctx) => ctx.json({ id: ctx.params.id }),
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/users/7'))
    expect(res.status).toBe(200)
    const data = await res.json() as { id: number }
    expect(data.id).toBe(7)
    expect(typeof data.id).toBe('number')
  })

  test('flat params form — invalid params → 422', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .route({
          method:  'GET',
          path:    '/items/:id',
          params:  z.object({ id: z.coerce.number().positive() }),
          handler: (ctx) => ctx.json({ ok: true }),
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/items/0'))
    expect(res.status).toBe(422)
  })
})

// ── .route() with response schema — schema present in RouteMap type ──────────

describe('.route() with response schema', () => {
  test('response schema — no runtime effect, handler still works', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .route({
          method:    'GET',
          path:      '/items',
          schema:    { response: z.object({ items: z.array(z.string()) }) },
          handler:   (ctx) => ctx.json({ items: ['a', 'b'] }),
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/items'))
    expect(res.status).toBe(200)
    const data = await res.json() as { items: string[] }
    expect(data.items).toEqual(['a', 'b'])
  })

  test('flat response — response schema stored in route.schema', async () => {
    const ResponseSchema = z.object({ ok: z.boolean() })
    const mod = defineModule('/api')
      .route({
        method:    'GET',
        path:      '/health',
        response:  ResponseSchema,
        handler:   (ctx) => ctx.json({ ok: true }),
      })
      .build()
    // Response schema is stored on the route object
    expect(mod.routes[0]!.schema?.response).toBe(ResponseSchema)
  })
})

// ── .route() with guard — guard executed ─────────────────────────────────────

describe('.route() with guard', () => {
  test('guard blocks → returns error response, handler not called', async () => {
    const app = createApp()
    let handlerCalled = false
    const blockGuard = createGuard(() => new Response('Blocked', { status: 403 }))

    app.register(
      defineModule('/api')
        .route({
          method:  'GET',
          path:    '/secret',
          guard:   blockGuard,
          handler: (_ctx) => {
            handlerCalled = true
            return new Response('OK')
          },
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/secret'))
    expect(res.status).toBe(403)
    expect(handlerCalled).toBe(false)
  })

  test('guard passes (returns null) → handler runs', async () => {
    const app = createApp()
    const passGuard = createGuard(() => null)

    app.register(
      defineModule('/api')
        .route({
          method:  'GET',
          path:    '/allowed',
          guard:   passGuard,
          handler: (ctx) => ctx.json({ ok: true }),
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/allowed'))
    expect(res.status).toBe(200)
  })
})

// ── .route() with docs.summary — correctly set ───────────────────────────────

describe('.route() with docs.summary', () => {
  test('docs.summary appears in OpenAPI spec', () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .meta({ tag: 'Items' })
        .route({
          method:  'GET',
          path:    '/items',
          docs:    { summary: 'List all items' },
          handler: (ctx) => ctx.json([]),
        })
        .build()
    )
    const spec = app.getOpenApiSpec()
    const op = spec.paths['/api/items']?.['get']
    expect(op?.summary).toBe('List all items')
  })

  test('docs.summary on route object is stored correctly', () => {
    const mod = defineModule('/api')
      .route({
        method:  'GET',
        path:    '/check',
        docs:    { summary: 'Check', description: 'A check route' },
        handler: (ctx) => ctx.json({ ok: true }),
      })
      .build()
    expect(mod.routes[0]!.docs?.summary).toBe('Check')
    expect(mod.routes[0]!.docs?.description).toBe('A check route')
  })
})

// ── .route() with deprecated top-level summary — still works ─────────────────

describe('.route() deprecated top-level summary', () => {
  test('summary field appears in OpenAPI spec (backward compat)', () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .meta({ tag: 'Health' })
        .route({
          method:  'GET',
          path:    '/health',
          summary: 'Health check',   // deprecated — should still work
          handler: (_ctx) => _ctx.json({ ok: true }),
        })
        .build()
    )
    const spec = app.getOpenApiSpec()
    const op = spec.paths['/api/health']?.['get']
    expect(op?.summary).toBe('Health check')
  })

  test('legacy summary stored on route.summary', () => {
    const mod = defineModule('/api')
      .route({
        method:  'GET',
        path:    '/ping',
        summary: 'Ping',
        handler: (ctx) => ctx.json({ ok: true }),
      })
      .build()
    // summary is stored both in route.summary and in route.docs.summary
    expect(mod.routes[0]!.summary).toBe('Ping')
    expect(mod.routes[0]!.docs?.summary).toBe('Ping')
  })

  test('docs.summary takes precedence over deprecated top-level summary', () => {
    const mod = defineModule('/api')
      .route({
        method:   'GET',
        path:     '/ping',
        summary:  'Old summary',
        docs:     { summary: 'New summary' },
        handler:  (ctx) => ctx.json({ ok: true }),
      })
      .build()
    expect(mod.routes[0]!.docs?.summary).toBe('New summary')
  })
})

// ── Simple .route() without schemas — unchanged (no breaking change) ──────────

describe('.route() without schemas — backward compat', () => {
  test('plain handler — no schema, no changes', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .route({
          method:  'GET',
          path:    '/health',
          handler: (ctx) => ctx.json({ ok: true }),
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/health'))
    expect(res.status).toBe(200)
    const data = await res.json() as { ok: boolean }
    expect(data.ok).toBe(true)
  })

  test('multiple .route() calls — all registered', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .route({ method: 'GET',    path: '/a', handler: (ctx) => ctx.json({ route: 'a' }) })
        .route({ method: 'POST',   path: '/b', handler: (ctx) => ctx.json({ route: 'b' }) })
        .route({ method: 'DELETE', path: '/c', handler: (ctx) => ctx.json({ route: 'c' }) })
        .build()
    )
    const a = await app.fetch(new Request('http://localhost/api/a'))
    const b = await app.fetch(new Request('http://localhost/api/b', { method: 'POST' }))
    const c = await app.fetch(new Request('http://localhost/api/c', { method: 'DELETE' }))
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(c.status).toBe(200)
  })

  test('existing schema: {} form still works', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .route({
          method:  'POST',
          path:    '/users',
          summary: 'Create user',
          schema:  { body: z.object({ name: z.string() }) },
          handler: (ctx) => ctx.json({ name: ctx.body.name }, 201),
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/users', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: 'Alice' }),
    }))
    expect(res.status).toBe(201)
    const data = await res.json() as { name: string }
    expect(data.name).toBe('Alice')
  })
})

// ── .get(), .post() method shortcuts — existing behavior unchanged ─────────────

describe('method shortcuts — existing behavior unchanged', () => {
  test('.get() plain handler — still works', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .get('/health', (ctx) => ctx.json({ ok: true }))
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/health'))
    expect(res.status).toBe(200)
  })

  test('.post() with schema — validation still works', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .post('/users', {
          body:    z.object({ name: z.string().min(1) }),
          handler: (ctx) => ctx.json({ name: ctx.body.name }, 201),
        })
        .build()
    )
    // Valid
    const valid = await app.fetch(new Request('http://localhost/api/users', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: 'Bob' }),
    }))
    expect(valid.status).toBe(201)

    // Invalid
    const invalid = await app.fetch(new Request('http://localhost/api/users', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: '' }),
    }))
    expect(invalid.status).toBe(422)
  })

  test('.get() with params — coercion works', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .get('/:id', {
          params:  z.object({ id: z.coerce.number() }),
          handler: (ctx) => ctx.json({ id: ctx.params.id }),
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/99'))
    expect(res.status).toBe(200)
    const data = await res.json() as { id: number }
    expect(data.id).toBe(99)
  })

  test('.put(), .patch(), .delete() — still work', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .put('/r', (ctx) => ctx.json({ m: 'put' }))
        .patch('/r', (ctx) => ctx.json({ m: 'patch' }))
        .delete('/r', (ctx) => ctx.json({ m: 'delete' }))
        .build()
    )
    const put    = await app.fetch(new Request('http://localhost/api/r', { method: 'PUT' }))
    const patch  = await app.fetch(new Request('http://localhost/api/r', { method: 'PATCH' }))
    const del    = await app.fetch(new Request('http://localhost/api/r', { method: 'DELETE' }))
    expect(put.status).toBe(200)
    expect(patch.status).toBe(200)
    expect(del.status).toBe(200)
  })
})
