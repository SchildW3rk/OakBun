import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { z } from 'zod'

describe('.route() — happy path', () => {
  test('.route() with full schema — handler receives typed ctx', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .route({
          method: 'POST',
          path: '/users',
          summary: 'Create user',
          description: 'Creates a new user',
          schema: {
            body: z.object({ name: z.string() }),
          },
          handler: (ctx) => ctx.json({ ok: true }),
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    }))
    expect(res.status).toBe(200)
  })

  test('.route() without schema — handler receives BaseCtx', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .route({
          method: 'GET',
          path: '/health',
          handler: (ctx) => ctx.json({ ok: true }),
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/health'))
    expect(res.status).toBe(200)
  })

  test('.get() without schema — unchanged behavior', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .get('/health', (ctx) => ctx.json({ ok: true }))
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/health'))
    expect(res.status).toBe(200)
  })

  test('.get() with schema in object — params validated and typed', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .get('/:id', {
          params:  z.object({ id: z.coerce.number() }),
          handler: (ctx) => ctx.json({ id: ctx.params.id }),
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/42'))
    expect(res.status).toBe(200)
  })

  test('.post() object form — ctx.body is typed, not unknown', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .post('/users', {
          body:    z.object({ name: z.string() }),
          handler: (ctx) => {
            // @ts-expect-error — number is not assignable to string; proves ctx.body.name is string
            const _bad: number = ctx.body.name
            return ctx.json({ name: ctx.body.name }, 201)
          },
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/users', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: 'Alice' }),
    }))
    expect(res.status).toBe(201)
  })

  test('.route() object form — ctx.body is typed, not unknown', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .route({
          method: 'POST',
          path:   '/items',
          schema: { body: z.object({ label: z.string() }) },
          handler: (ctx) => {
            // @ts-expect-error — number is not assignable to string; proves ctx.body.label is string
            const _bad: number = ctx.body.label
            return ctx.json({ label: ctx.body.label })
          },
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/items', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ label: 'hello' }),
    }))
    expect(res.status).toBe(200)
  })

  test('.meta() sets tag + description on VelnModule', () => {
    const mod = defineModule('/api')
      .meta({ tag: 'Users', description: 'User Management' })
      .build()
    expect(mod.meta?.tag).toBe('Users')
    expect(mod.meta?.description).toBe('User Management')
  })

  test('route visibility overrides module visibility', () => {
    const mod = defineModule('/api')
      .visibility('public')
      .route({
        method: 'GET',
        path: '/secret',
        visibility: 'hidden',
        handler: (ctx) => ctx.json({ secret: true }),
      })
      .build()
    expect(mod.visibility).toBe('public')
    expect(mod.routes[0]!.visibility).toBe('hidden')
  })

  test('summary + description appear in OpenAPI spec', () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .meta({ tag: 'Users' })
        .route({
          method: 'GET',
          path: '/users',
          summary: 'List users',
          description: 'Returns all users',
          handler: (ctx) => ctx.json([]),
        })
        .build()
    )
    const spec = app.getOpenApiSpec()
    const op = spec.paths['/api/users']?.['get']
    expect(op?.summary).toBe('List users')
    expect(op?.description).toBe('Returns all users')
    expect(op?.tags).toEqual(['Users'])
  })
})

describe('.route() — unhappy path', () => {
  test('.route() with invalid body → 422', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .route({
          method: 'POST',
          path: '/users',
          schema: { body: z.object({ name: z.string().min(1) }) },
          handler: (ctx) => ctx.json({ ok: true }),
        })
        .build()
    )
    const res = await app.fetch(new Request('http://localhost/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    }))
    expect(res.status).toBe(422)
  })

  test('.route() with invalid params → 422', async () => {
    const app = createApp()
    app.register(
      defineModule('/api')
        .route({
          method: 'GET',
          path: '/:id',
          schema: { params: z.object({ id: z.coerce.number().min(1) }) },
          handler: (ctx) => ctx.json({ ok: true }),
        })
        .build()
    )
    // id=0 fails min(1)
    const res = await app.fetch(new Request('http://localhost/api/0'))
    expect(res.status).toBe(422)
  })
})
