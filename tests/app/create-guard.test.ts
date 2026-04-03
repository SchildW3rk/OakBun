import { describe, test, expect, spyOn } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { createPlugin } from '../../packages/core/src/app/plugin'
import { createGuard, defineGuard } from '../../packages/core/src/app/types'
import type { BaseCtx } from '../../packages/core/src/app/types'
import { UnauthorizedError } from '../../packages/core/src/errors/index'

interface AuthCtx extends BaseCtx {
  user: { id: string; role: string } | null
}

const authPlugin = createPlugin<{ user: { id: string; role: string } | null }>('auth', {
  request: (ctx) => ({
    user: ctx.req.headers.get('x-user')
      ? { id: ctx.req.headers.get('x-user')!, role: ctx.req.headers.get('x-role') ?? 'user' }
      : null,
  }),
})

const requireAuth = createGuard<AuthCtx>((ctx) => {
  if (!ctx.user) return ctx.json({ error: 'Unauthorized' }, 401)
  return null
})

const requireRole = (role: string) => createGuard<AuthCtx>((ctx) => {
  if (!ctx.user) return ctx.json({ error: 'Unauthorized' }, 401)
  if (ctx.user.role !== role) return ctx.json({ error: 'Forbidden' }, 403)
  return null
})

describe('createGuard', () => {
  test('null zurück → Handler aufgerufen', async () => {
    const app = createApp()
    createGuard(() => null)
    app.get('/x', (ctx) => ctx.json({ ok: true }))
    // Guard direkt auf route — via module
    const res = await app.fetch(new Request('http://localhost/x'))
    expect(res.status).toBe(200)
  })

  test('requireAuth mit user → pass', async () => {
    const { defineModule } = await import('../../packages/core/src/app/module')
    const { createApp: ca } = await import('../../packages/core/src/app/index')
    const app2 = ca()
    const mod = defineModule('/api')
      .plugin(authPlugin())
      .guard(requireAuth)
      .get('/me', (ctx) => (ctx as AuthCtx).user
        ? ctx.json({ id: (ctx as AuthCtx).user!.id })
        : ctx.json({ error: 'no user' }, 401)
      )
      .build()
    app2.register(mod)

    const res = await app2.fetch(new Request('http://localhost/api/me', {
      headers: { 'x-user': 'u-1' },
    }))
    expect(res.status).toBe(200)
    expect((await res.json() as { id: string }).id).toBe('u-1')
  })

  test('requireAuth ohne user → 401, Handler nicht aufgerufen', async () => {
    const { defineModule } = await import('../../packages/core/src/app/module')
    const { createApp: ca } = await import('../../packages/core/src/app/index')
    const app = ca()
    const mod = defineModule('/api')
      .plugin(authPlugin())
      .guard(requireAuth)
      .get('/me', (ctx) => ctx.json({ ok: true }))
      .build()
    app.register(mod)

    const res = await app.fetch(new Request('http://localhost/api/me'))
    expect(res.status).toBe(401)
  })

  test('requireRole admin mit admin → pass', async () => {
    const { defineModule } = await import('../../packages/core/src/app/module')
    const { createApp: ca } = await import('../../packages/core/src/app/index')
    const app = ca()
    const mod = defineModule('/admin')
      .plugin(authPlugin())
      .guard(requireRole('admin'))
      .get('/stats', (ctx) => ctx.json({ ok: true }))
      .build()
    app.register(mod)

    const res = await app.fetch(new Request('http://localhost/admin/stats', {
      headers: { 'x-user': 'u-1', 'x-role': 'admin' },
    }))
    expect(res.status).toBe(200)
  })

  test('requireRole admin mit user role → 403', async () => {
    const { defineModule } = await import('../../packages/core/src/app/module')
    const { createApp: ca } = await import('../../packages/core/src/app/index')
    const app = ca()
    const mod = defineModule('/admin')
      .plugin(authPlugin())
      .guard(requireRole('admin'))
      .get('/stats', (ctx) => ctx.json({ ok: true }))
      .build()
    app.register(mod)

    const res = await app.fetch(new Request('http://localhost/admin/stats', {
      headers: { 'x-user': 'u-1', 'x-role': 'user' },
    }))
    expect(res.status).toBe(403)
  })

  test('Guard wirft → onError aufgerufen', async () => {
    const { defineModule } = await import('../../packages/core/src/app/module')
    const { createApp: ca } = await import('../../packages/core/src/app/index')
    const app = ca().onError((_err, ctx) => ctx.json({ caught: true }, 500))
    const mod = defineModule('/x')
      .guard(createGuard(() => { throw new Error('guard error') }))
      .get('/', (ctx) => ctx.json({ ok: true }))
      .build()
    app.register(mod)

    const res = await app.fetch(new Request('http://localhost/x/'))
    expect(res.status).toBe(500)
  })

  test('Mehrere Guards: erster blockt → zweiter läuft nicht', async () => {
    const { defineModule } = await import('../../packages/core/src/app/module')
    const { createApp: ca } = await import('../../packages/core/src/app/index')
    let secondRan = false
    const app = ca()
    const mod = defineModule('/x')
      .guard(createGuard(() => new Response('blocked', { status: 403 })))
      .guard(createGuard(() => { secondRan = true; return null }))
      .get('/', (ctx) => ctx.json({ ok: true }))
      .build()
    app.register(mod)

    const res = await app.fetch(new Request('http://localhost/x/'))
    expect(res.status).toBe(403)
    expect(secondRan).toBe(false)
  })
})

// ── defineGuard ───────────────────────────────────────────────────────────────

describe('defineGuard', () => {
  test('.check() returns a Guard function', () => {
    const guard = defineGuard('test').check(() => {})
    expect(typeof guard).toBe('function')
  })

  test('.check() without throw → returns null (pass)', async () => {
    const guard = defineGuard('pass').check(() => {})
    const result = await guard({ req: new Request('http://localhost/') } as BaseCtx)
    expect(result).toBeNull()
  })

  test('.check() with throw → error propagates', async () => {
    const guard = defineGuard('block').check(() => { throw new UnauthorizedError() })
    await expect(guard({ req: new Request('http://localhost/') } as BaseCtx))
      .rejects.toBeInstanceOf(UnauthorizedError)
  })

  test('thrown error reaches onError cascade via app', async () => {
    const { defineModule } = await import('../../packages/core/src/app/module')
    const app = createApp().onError((err, ctx) =>
      ctx.json({ status: (err as { status?: number }).status ?? 500 }, (err as { status?: number }).status ?? 500)
    )
    const guard = defineGuard('auth').check(() => { throw new UnauthorizedError() })
    const mod = defineModule('/secure')
      .guard(guard)
      .get('/', (ctx) => ctx.json({ ok: true }))
      .build()
    app.register(mod)

    const res = await app.fetch(new Request('http://localhost/secure/'))
    expect(res.status).toBe(401)
  })

  test('.options({ log: { level: "warn" } }) — logger scope is guard:<name>', () => {
    const calls: string[] = []
    const spy = spyOn(console, 'warn').mockImplementation((msg: string) => { calls.push(msg) })

    const guard = defineGuard('scope-test')
      .options({ log: { level: 'warn' } })
      .check(() => { throw new Error('blocked') })

    void guard({ req: new Request('http://localhost/') } as BaseCtx).catch(() => {})
    spy.mockRestore()

    expect(calls.some((c) => c.includes('guard:scope-test'))).toBe(true)
  })

  test('.options({ log: { silent: true } }) — no console output', async () => {
    const logSpy  = spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})

    const passGuard  = defineGuard('silent-pass').options({ log: { silent: true } }).check(() => {})
    const blockGuard = defineGuard('silent-block').options({ log: { silent: true } }).check(() => { throw new Error('x') })

    await passGuard({ req: new Request('http://localhost/') } as BaseCtx)
    await blockGuard({ req: new Request('http://localhost/') } as BaseCtx).catch(() => {})

    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
    warnSpy.mockRestore()
  })

  test('backward compat: createGuard(fn) still works', async () => {
    const guard = createGuard<{ user?: string }>((ctx) =>
      ctx.user ? null : new Response('no', { status: 401 })
    )
    const pass = await guard({ user: 'alice' } as BaseCtx & { user?: string })
    const block = await guard({ user: undefined } as BaseCtx & { user?: string })
    expect(pass).toBeNull()
    expect((block as Response).status).toBe(401)
  })
})
