import { describe, test, expect } from 'bun:test'
import { z } from 'zod'
import { createApp } from '../../packages/core/src/app/index'
import { ValidationError } from '../../packages/core/src/app/types'

// ── Route Schema — params ─────────────────────────────────────

describe('Route Schema — params', () => {
  test('valid params → ctx.params is parsed and typed', async () => {
    const app = createApp()
    app.get('/users/:id', {
      params: z.object({ id: z.string() }),
      handler: (ctx) => ctx.json({ id: ctx.params.id }),
    })

    const res = await app.fetch(new Request('http://localhost/users/42'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.id).toBe('42')
  })

  test('invalid params → 422, handler not called', async () => {
    const app = createApp()
    let handlerCalled = false
    app.get('/items/:id', {
      params: z.object({ id: z.string().regex(/^\d+$/, 'must be numeric') }),
      handler: (ctx) => {
        handlerCalled = true
        return ctx.json({ id: ctx.params.id })
      },
    })
    app.onError((err, ctx) => {
      if (err instanceof ValidationError) {
        return ctx.json({ error: 'Validation failed', issues: err.issues }, 422)
      }
      return ctx.json({ error: String(err) }, 500)
    })

    const res = await app.fetch(new Request('http://localhost/items/abc'))
    expect(res.status).toBe(422)
    expect(handlerCalled).toBe(false)
    const body = await res.json() as any
    expect(body.issues).toBeDefined()
    expect(body.issues.length).toBeGreaterThan(0)
  })

  test('z.coerce.number() → string "1" becomes number 1', async () => {
    const app = createApp()
    app.get('/users/:id', {
      params: z.object({ id: z.coerce.number() }),
      handler: (ctx) => ctx.json({ id: ctx.params.id, type: typeof ctx.params.id }),
    })

    const res = await app.fetch(new Request('http://localhost/users/1'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.id).toBe(1)
    expect(body.type).toBe('number')
  })
})

// ── Route Schema — query ──────────────────────────────────────

describe('Route Schema — query', () => {
  test('valid query → ctx.query is parsed', async () => {
    const app = createApp()
    app.get('/search', {
      query: z.object({ q: z.string(), limit: z.coerce.number().optional() }),
      handler: (ctx) => ctx.json({ q: ctx.query.q, limit: ctx.query.limit }),
    })

    const res = await app.fetch(new Request('http://localhost/search?q=hello&limit=10'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.q).toBe('hello')
    expect(body.limit).toBe(10)
  })

  test('invalid query → 422', async () => {
    const app = createApp()
    app.get('/items', {
      query: z.object({ page: z.coerce.number().int().positive() }),
      handler: (ctx) => ctx.json({ page: ctx.query.page }),
    })
    app.onError((err, ctx) => {
      if (err instanceof ValidationError) {
        return ctx.json({ error: 'Validation failed', issues: err.issues }, 422)
      }
      return ctx.json({ error: String(err) }, 500)
    })

    // page=-1 fails positive() check
    const res = await app.fetch(new Request('http://localhost/items?page=-1'))
    expect(res.status).toBe(422)
    const body = await res.json() as any
    expect(body.issues).toBeDefined()
    expect(body.issues.length).toBeGreaterThan(0)
  })
})

// ── Route Schema — body ───────────────────────────────────────

describe('Route Schema — body', () => {
  test('valid body → ctx.body is parsed and typed', async () => {
    const app = createApp()
    app.post('/users', {
      body: z.object({ name: z.string().min(1), email: z.string().email() }),
      handler: (ctx) => {
        const body = ctx.body as { name: string; email: string }
        return ctx.json({ name: body.name, email: body.email }, 201)
      },
    })

    const res = await app.fetch(new Request('http://localhost/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }),
    }))
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.name).toBe('Alice')
    expect(body.email).toBe('alice@example.com')
  })

  test('invalid body → 422', async () => {
    const app = createApp()
    app.post('/users', {
      body: z.object({ name: z.string().min(1), email: z.string().email() }),
      handler: (ctx) => ctx.json({ ok: true }, 201),
    })
    app.onError((err, ctx) => {
      if (err instanceof ValidationError) {
        return ctx.json({ error: 'Validation failed', issues: err.issues }, 422)
      }
      return ctx.json({ error: String(err) }, 500)
    })

    // email is missing
    const res = await app.fetch(new Request('http://localhost/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Email' }),
    }))
    expect(res.status).toBe(422)
    const resBody = await res.json() as any
    expect(resBody.issues).toBeDefined()
    expect(resBody.issues.length).toBeGreaterThan(0)
  })

  test('body schema defined but no JSON body → 422', async () => {
    const app = createApp()
    app.post('/upload', {
      body: z.object({ name: z.string() }),
      handler: (ctx) => ctx.json({ ok: true }),
    })
    app.onError((err, ctx) => {
      if (err instanceof ValidationError) {
        return ctx.json({ error: 'Validation failed', issues: err.issues }, 422)
      }
      return ctx.json({ error: String(err) }, 500)
    })

    // No body at all
    const res = await app.fetch(new Request('http://localhost/upload', {
      method: 'POST',
    }))
    expect(res.status).toBe(422)
  })

  test('no body schema → ctx.body is undefined', async () => {
    const app = createApp()
    let capturedBody: unknown = 'not-checked'
    app.post('/echo', (ctx) => {
      capturedBody = ctx.body
      return ctx.json({ ok: true })
    })

    await app.fetch(new Request('http://localhost/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'test' }),
    }))

    expect(capturedBody).toBeUndefined()
  })
})

// ── Route Schema — coexistence ────────────────────────────────

describe('Route Schema — coexistence', () => {
  test('Style A (no schema) and Style B (with schema) coexist in same app', async () => {
    const app = createApp()

    // Style A — plain function
    app.get('/health', (ctx) => ctx.json({ ok: true }))

    // Style B — with schema
    app.post('/users', {
      body: z.object({ name: z.string() }),
      handler: (ctx) => {
        const body = ctx.body as { name: string }
        return ctx.json({ created: body.name }, 201)
      },
    })

    const healthRes = await app.fetch(new Request('http://localhost/health'))
    expect(healthRes.status).toBe(200)

    const userRes = await app.fetch(new Request('http://localhost/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    }))
    expect(userRes.status).toBe(201)
    const body = await userRes.json() as any
    expect(body.created).toBe('Alice')
  })

  test('response schema has no runtime effect — handler still works', async () => {
    const app = createApp()
    app.get('/items', {
      response: z.object({ items: z.array(z.string()) }),
      handler: (ctx) => ctx.json({ items: ['a', 'b'] }),
    })

    const res = await app.fetch(new Request('http://localhost/items'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    // Handler response is not validated at runtime in Phase 4a
    expect(body.items).toEqual(['a', 'b'])
  })
})

// ── ValidationError ───────────────────────────────────────────

describe('ValidationError', () => {
  test('status is 422', () => {
    const zodError = z.object({ name: z.string() }).safeParse({})
    expect(zodError.success).toBe(false)
    const err = new ValidationError((zodError as any).error)
    expect(err.status).toBe(422)
  })

  test('has issues array from ZodError', () => {
    const result = z.object({ email: z.string().email() }).safeParse({ email: 'not-an-email' })
    expect(result.success).toBe(false)
    const err = new ValidationError((result as any).error)
    expect(Array.isArray(err.issues)).toBe(true)
    expect(err.issues.length).toBeGreaterThan(0)
    expect(err.issues[0]).toHaveProperty('message')
  })

  test('global error handler receives ValidationError — can return issues', async () => {
    const app = createApp()
    app.post('/submit', {
      body: z.object({ title: z.string().min(3) }),
      handler: (ctx) => ctx.json({ ok: true }),
    })

    let receivedErr: unknown = null
    app.onError((err, ctx) => {
      receivedErr = err
      if (err instanceof ValidationError) {
        return ctx.json({ error: 'Validation failed', issues: err.issues }, 422)
      }
      return ctx.json({ error: String(err) }, 500)
    })

    const res = await app.fetch(new Request('http://localhost/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'ab' }),  // too short
    }))

    expect(res.status).toBe(422)
    expect(receivedErr).toBeInstanceOf(ValidationError)
    const body = await res.json() as any
    expect(body.issues).toBeDefined()
    expect(body.issues[0].message).toBeDefined()
  })
})
