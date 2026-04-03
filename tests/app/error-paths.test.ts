import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { definePlugin } from '../../packages/core/src/app/plugin'
import { defineGuard } from '../../packages/core/src/app/types'
import {
  ForbiddenError,
  NotFoundError,
} from '../../packages/core/src/errors/index'
import type { AuthAdapter, AuthUser } from '../../packages/core/src/app/types'
import { z } from 'zod'

// ── Case 1 — Validation fail → Error-Cascade ──────────────────────────────────

describe('Case 1 — Validation fail → Error-Cascade', () => {
  test('invalid body → 422 with VALIDATION_ERROR, handler never called', async () => {
    let handlerCalled = false

    const mod = defineModule('/v1')
      .post('/items', {
        body:    z.object({ name: z.string().min(1), qty: z.number().int().positive() }),
        handler: (ctx) => {
          handlerCalled = true
          return ctx.json({ ok: true }, 201)
        },
      })
      .build()

    const app = createApp()
    app.register(mod)

    const res = await app.fetch(
      new Request('http://localhost/v1/items', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: '', qty: -5 }),
      }),
    )

    expect(res.status).toBe(422)
    const body = await res.json() as { code: string; issues: unknown[] }
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(Array.isArray(body.issues)).toBe(true)
    expect(body.issues.length).toBeGreaterThan(0)
    expect(handlerCalled).toBe(false)
  })

  test('module onError receives validation error', async () => {
    let caughtCode: string | undefined

    const mod = defineModule('/v2')
      .onError((err) => {
        const e = err as { code?: string }
        caughtCode = e.code
        return Response.json({ caught: true }, { status: 422 })
      })
      .post('/items', {
        body:    z.object({ name: z.string().min(3) }),
        handler: (ctx) => ctx.json({ ok: true }),
      })
      .build()

    const app = createApp()
    app.register(mod)

    const res = await app.fetch(
      new Request('http://localhost/v2/items', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: 'x' }),
      }),
    )

    expect(res.status).toBe(422)
    expect(caughtCode).toBe('VALIDATION_ERROR')
    const body = await res.json() as { caught: boolean }
    expect(body.caught).toBe(true)
  })
})

// ── Case 2 — Guard reject → Error-Cascade ────────────────────────────────────

describe('Case 2 — Guard reject → Error-Cascade', () => {
  test('module guard throws ForbiddenError → 403, onBeforeHandle never called', async () => {
    let beforeHandleCalled = false

    const blockingGuard = defineGuard('block-case2a').check(() => {
      throw new ForbiddenError('no entry')
    })

    const mod = defineModule('/guarded')
      .guard(blockingGuard)
      .get('/resource', { handler: (ctx) => ctx.json({ ok: true }) })
      .build()

    const app = createApp()
    app.register(mod)

    app.onBeforeHandle(() => {
      beforeHandleCalled = true
    })

    const res = await app.fetch(new Request('http://localhost/guarded/resource'))

    expect(res.status).toBe(403)
    expect(beforeHandleCalled).toBe(false)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('FORBIDDEN')
  })

  test('module guard throws ForbiddenError → global onError receives it', async () => {
    let onErrorCalled = false

    const blockingGuard = defineGuard('block-case2b').check(() => {
      throw new ForbiddenError('no entry')
    })

    const mod = defineModule('/guarded2')
      .guard(blockingGuard)
      .get('/resource', { handler: (ctx) => ctx.json({ ok: true }) })
      .build()

    const app = createApp()
    app.register(mod)

    app.onError((err) => {
      onErrorCalled = true
      const e = err as { code?: string; status?: number }
      return Response.json({ intercepted: true, code: e.code }, { status: e.status ?? 500 })
    })

    const res = await app.fetch(new Request('http://localhost/guarded2/resource'))

    expect(res.status).toBe(403)
    expect(onErrorCalled).toBe(true)
    const body = await res.json() as { intercepted: boolean; code: string }
    expect(body.intercepted).toBe(true)
    expect(body.code).toBe('FORBIDDEN')
  })
})

// ── Case 3 — Service throw → Error-Cascade ───────────────────────────────────

describe('Case 3 — Service throw → Error-Cascade', () => {
  test('NotFoundError in handler cascades: module → global → fallback', async () => {
    const callOrder: string[] = []

    const mod = defineModule('/svc')
      .onError((err) => {
        callOrder.push('module')
        throw err   // rethrow → falls to global
      })
      .get('/:id', (_ctx) => {
        throw new NotFoundError('Resource not found')
      })
      .build()

    const app = createApp()
    app.register(mod)
    app.onError((err) => {
      callOrder.push('global')
      throw err   // rethrow → falls to built-in fallback
    })

    const res = await app.fetch(new Request('http://localhost/svc/99'))

    expect(res.status).toBe(404)
    const body = await res.json() as { code: string; message: string }
    expect(body.code).toBe('NOT_FOUND')
    expect(body.message).toBe('Resource not found')
    expect(callOrder).toEqual(['module', 'global'])
  })

  test('module onError handles error — global not called', async () => {
    const callOrder: string[] = []

    const mod = defineModule('/svc2')
      .onError(() => {
        callOrder.push('module')
        return Response.json({ handled: 'module' }, { status: 404 })
      })
      .get('/item', (_ctx) => {
        throw new NotFoundError('not here')
      })
      .build()

    const app = createApp()
    app.register(mod)
    app.onError(() => {
      callOrder.push('global')
      return Response.json({ handled: 'global' }, { status: 500 })
    })

    const res = await app.fetch(new Request('http://localhost/svc2/item'))

    expect(res.status).toBe(404)
    expect(callOrder).toEqual(['module'])
    const body = await res.json() as { handled: string }
    expect(body.handled).toBe('module')
  })
})

// ── Case 4 — Handler error → no event flush ───────────────────────────────────
// The framework guarantees events are flushed only on the success path
// (requestQueue is discarded on error). This test verifies that a handler
// throw does not flush the event queue by observing that the subscriber
// registered via app.on() is never called.

describe('Case 4 — Handler error → event queue not flushed', () => {
  test('handler throws → ctx.emit() event never delivered to subscriber', async () => {
    let subscriberFired = false

    const app = createApp()
    app.on('order.created', () => {
      subscriberFired = true
    })

    app.post('/orders', (ctx) => {
      ctx.emit('order.created', { id: 1 })
      throw new Error('DB down')
    })

    const res = await app.fetch(
      new Request('http://localhost/orders', { method: 'POST' }),
    )

    expect(res.status).toBe(500)
    expect(subscriberFired).toBe(false)
  })
})

// ── Case 5 — Error-Cascade order ──────────────────────────────────────────────

describe('Case 5 — Error-Cascade order: module-onError wins over global', () => {
  test('module-onError handles error — global not called', async () => {
    const callOrder: string[] = []

    const mod = defineModule('/cascade')
      .onError(() => {
        callOrder.push('module')
        return Response.json({ level: 'module' }, { status: 418 })
      })
      .get('/boom', () => {
        throw new Error('intentional')
      })
      .build()

    const app = createApp()
    app.register(mod)
    app.onError(() => {
      callOrder.push('global')
      return Response.json({ level: 'global' }, { status: 500 })
    })

    const res = await app.fetch(new Request('http://localhost/cascade/boom'))

    expect(res.status).toBe(418)
    const body = await res.json() as { level: string }
    expect(body.level).toBe('module')
    // Global must NOT have been invoked
    expect(callOrder).toEqual(['module'])
  })
})

// ── Case 6 — Unknown error → no stack-trace leak ─────────────────────────────

describe('Case 6 — Unknown error → no internal details in response', () => {
  test('Error with internal message → 500 with generic message only', async () => {
    const app = createApp()
    app.get('/secret', () => {
      throw new Error('internal details here: password=hunter2, token=abc123')
    })

    const res = await app.fetch(new Request('http://localhost/secret'))

    expect(res.status).toBe(500)
    const body = await res.json() as { error: string; code: string; message: string }
    expect(body.error).toBe('Internal Server Error')
    expect(body.code).toBe('INTERNAL_ERROR')
    expect(body.message).toBe('An unexpected error occurred')

    // Ensure the internal message is not leaked anywhere in the response
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('internal details here')
    expect(raw).not.toContain('hunter2')
    expect(raw).not.toContain('abc123')
  })
})

// ── Case 7 — Plugin Permission Denied → Cascade ───────────────────────────────

describe('Case 7 — Plugin permission denied → 403 before handler', () => {
  test('user without required permission → 403, handler never called', async () => {
    let handlerCalled = false
    let onErrorCalled = false

    const adminMod = defineModule('/admin')
      .get('/', {
        handler: (ctx) => {
          handlerCalled = true
          return ctx.json({ ok: true })
        },
      })
      .build()

    const adminPlugin = definePlugin<object>('admin-plugin')
      .permission('admin')
      .modules([adminMod])
      .extend(() => ({}))

    const auth: AuthAdapter = {
      getUser:       async () => ({ id: 'u1', permissions: ['user'] } satisfies AuthUser),
      hasPermission: (u, p) => u.permissions.includes(p),
    }

    const app = createApp({ auth })

    app.onError((_err) => {
      onErrorCalled = true
      throw _err  // fall through to built-in
    })

    app.plugin(adminPlugin)

    const res = await app.fetch(new Request('http://localhost/admin'))

    expect(res.status).toBe(403)
    expect(handlerCalled).toBe(false)
    expect(onErrorCalled).toBe(true)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('FORBIDDEN')
  })

  test('unauthenticated request (no user) → 401 before handler', async () => {
    const adminMod = defineModule('/secure')
      .get('/', {
        handler: (ctx) => ctx.json({ ok: true }),
      })
      .build()

    const securePlugin = definePlugin<object>('secure-plugin')
      .permission('admin')
      .modules([adminMod])
      .extend(() => ({}))

    const auth: AuthAdapter = {
      getUser:       async () => null,
      hasPermission: (u, p) => u.permissions.includes(p),
    }

    const app = createApp({ auth })
    app.plugin(securePlugin)

    const res = await app.fetch(new Request('http://localhost/secure'))

    expect(res.status).toBe(401)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('UNAUTHORIZED')
  })
})
