import { describe, test, expect } from 'bun:test'
import { z } from 'zod'
import { createApp } from '../../packages/core/src/app/index'
import { createClient, VelnClientError } from '../../packages/core/src/client/index'
import { ValidationError } from '../../packages/core/src/app/types'

// ── Shared test app ────────────────────────────────────────────────────────────

function makeTestApp() {
  return createApp()
    .get(
      '/users/:id',
      {
        params:   z.object({ id: z.coerce.number() }),
        response: z.object({ id: z.number(), name: z.string() }),
      },
      (ctx) => ctx.json({ id: ctx.params.id, name: 'Alice' }),
    )
    .post(
      '/users',
      {
        body:     z.object({ name: z.string().min(1) }),
        response: z.object({ id: z.number(), name: z.string() }),
      },
      (ctx) => ctx.json({ id: 1, name: ctx.body.name }, 201),
    )
    .get(
      '/search',
      {
        query:    z.object({ q: z.string() }),
        response: z.object({ results: z.array(z.string()) }),
      },
      (ctx) => ctx.json({ results: [ctx.query.q] }),
    )
    .get(
      '/untyped',
      (ctx) => ctx.json({ value: 42 }),
    )
    .onError((err, ctx) => {
      if (err instanceof ValidationError) {
        return ctx.json({ error: 'Validation failed', issues: err.issues }, 422)
      }
      return ctx.json({ error: String(err) }, 500)
    })
}

// ── Happy Path ─────────────────────────────────────────────────────────────────

describe('createClient — happy path', () => {
  test('GET with params — correct response and path substitution', async () => {
    const app = makeTestApp()
    const client = createClient<typeof app>('http://localhost', {
      fetch: app.fetch.bind(app),
    })

    const res = await client.get('/users/:id', { params: { id: 7 } })
    expect(res.id).toBe(7)
    expect(res.name).toBe('Alice')
  })

  test('POST with body — typed response', async () => {
    const app = makeTestApp()
    const client = createClient<typeof app>('http://localhost', {
      fetch: app.fetch.bind(app),
    })

    const res = await client.post('/users', { body: { name: 'Bob' } })
    expect(res.name).toBe('Bob')
    expect(res.id).toBe(1)
  })

  test('GET with query — query params serialized as URLSearchParams', async () => {
    const app = makeTestApp()
    const client = createClient<typeof app>('http://localhost', {
      fetch: app.fetch.bind(app),
    })

    const res = await client.get('/search', { query: { q: 'hello' } })
    expect(res.results).toEqual(['hello'])
  })

  test('route without response schema → unknown returned, no error', async () => {
    const app = makeTestApp()
    const client = createClient<typeof app>('http://localhost', {
      fetch: app.fetch.bind(app),
    })

    // /untyped has no schema so it won't be in TRoutes — use a fresh untyped app
    const app2 = createApp()
      .get('/noresp', (ctx) => ctx.json({ value: 42 }))

    const client2 = createClient<typeof app2>('http://localhost', {
      fetch: app2.fetch.bind(app2),
    })

    // This should work without errors even though the route has no schema
    // Use a dynamically-typed path (type is unknown)
    const res = await (client2 as any).get('/noresp')
    expect((res as any).value).toBe(42)
  })
})

// ── Unhappy Path ───────────────────────────────────────────────────────────────

describe('createClient — unhappy path', () => {
  test('404 → VelnClientError with status 404', async () => {
    const app = makeTestApp()
    const client = createClient<typeof app>('http://localhost', {
      fetch: app.fetch.bind(app),
    })

    let thrown: unknown
    try {
      await (client as any).get('/nonexistent-route')
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(VelnClientError)
    expect((thrown as VelnClientError).status).toBe(404)
  })

  test('422 → VelnClientError with status 422 and issues array', async () => {
    const app = makeTestApp()
    const client = createClient<typeof app>('http://localhost', {
      fetch: app.fetch.bind(app),
    })

    let thrown: unknown
    try {
      await client.post('/users', { body: { name: '' } })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(VelnClientError)
    expect((thrown as VelnClientError).status).toBe(422)
    expect((thrown as VelnClientError).issues).toBeDefined()
    expect(Array.isArray((thrown as VelnClientError).issues)).toBe(true)
    expect((thrown as VelnClientError).issues!.length).toBeGreaterThan(0)
  })

  test('500 → VelnClientError with status 500', async () => {
    const app = createApp()
    app.get('/boom', () => {
      throw new Error('internal error')
    })
    // No onError handler → default 500

    const client = createClient<typeof app>('http://localhost', {
      fetch: app.fetch.bind(app),
    })

    let thrown: unknown
    try {
      await (client as any).get('/boom')
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(VelnClientError)
    expect((thrown as VelnClientError).status).toBe(500)
  })
})
