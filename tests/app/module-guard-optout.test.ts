import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { defineGuard } from '../../packages/core/src/app/types'
import { UnauthorizedError } from '../../packages/core/src/errors/index'

// ── Helpers ────────────────────────────────────────────────────────────────────

let blocked = false

const blockingGuard = defineGuard('blockingGuard')
  .check(() => {
    blocked = true
    throw new UnauthorizedError('blocked by guard')
  })

const passingGuard = defineGuard('passingGuard')
  .check(() => {
    // passes — does nothing
  })

function resetBlockFlag() { blocked = false }

// ── 1. Module guard with no route override → guard runs ───────────────────────

describe('module guard — no route override → guard runs', () => {
  test('route without guard field inherits module guard → 401', async () => {
    resetBlockFlag()
    const mod = defineModule('/api')
      .guard(blockingGuard)
      .get('/protected', { handler: (ctx) => ctx.json({ ok: true }) })
      .build()

    const app = createApp()
    app.register(mod)
    const res = await app.fetch(new Request('http://localhost/api/protected'))
    expect(res.status).toBe(401)
    expect(blocked).toBe(true)
  })
})

// ── 2. guard: false → module guard skipped ────────────────────────────────────

describe('module guard — guard: false → module guard skipped', () => {
  test('route with guard: false bypasses module guard → 200', async () => {
    resetBlockFlag()
    const mod = defineModule('/api')
      .guard(blockingGuard)
      .get('/public', { guard: false, handler: (ctx) => ctx.json({ ok: true }) })
      .build()

    const app = createApp()
    app.register(mod)
    const res = await app.fetch(new Request('http://localhost/api/public'))
    expect(res.status).toBe(200)
    expect(blocked).toBe(false)
  })

  test('guard: false on .post() also skips module guard → 200', async () => {
    resetBlockFlag()
    const mod = defineModule('/api')
      .guard(blockingGuard)
      .post('/open', { guard: false, handler: (ctx) => ctx.json({ ok: true }) })
      .build()

    const app = createApp()
    app.register(mod)
    const res = await app.fetch(new Request('http://localhost/api/open', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(blocked).toBe(false)
  })
})

// ── 3. guard: Guard → route guard runs (module guard also runs) ───────────────

describe('module guard — route with own guard → both run', () => {
  test('route with own blocking guard → 401 (module guard also runs)', async () => {
    resetBlockFlag()
    const mod = defineModule('/api')
      .guard(passingGuard)   // module guard passes
      .get('/strict', {
        guard:   blockingGuard,  // route guard blocks
        handler: (ctx) => ctx.json({ ok: true }),
      })
      .build()

    const app = createApp()
    app.register(mod)
    const res = await app.fetch(new Request('http://localhost/api/strict'))
    expect(res.status).toBe(401)
    expect(blocked).toBe(true)
  })
})

// ── 4. No module guard + guard: false → no error ─────────────────────────────

describe('no module guard — guard: false on route → no error', () => {
  test('module without .guard() + route guard: false → 200', async () => {
    const mod = defineModule('/api')
      // no .guard() on module
      .get('/open', { guard: false, handler: (ctx) => ctx.json({ ok: true }) })
      .build()

    const app = createApp()
    app.register(mod)
    const res = await app.fetch(new Request('http://localhost/api/open'))
    expect(res.status).toBe(200)
  })
})

// ── 5. Two routes — one opt-out, one inheriting ───────────────────────────────

describe('two routes in same module — isolation', () => {
  test('guard: false route is public, other route is protected', async () => {
    resetBlockFlag()
    const mod = defineModule('/api')
      .guard(blockingGuard)
      .get('/public', { guard: false, handler: (ctx) => ctx.json({ public: true }) })
      .get('/private', { handler: (ctx) => ctx.json({ private: true }) })
      .build()

    const app = createApp()
    app.register(mod)

    const pub = await app.fetch(new Request('http://localhost/api/public'))
    expect(pub.status).toBe(200)
    const body = await pub.json() as { public: boolean }
    expect(body.public).toBe(true)

    resetBlockFlag()
    const priv = await app.fetch(new Request('http://localhost/api/private'))
    expect(priv.status).toBe(401)
    expect(blocked).toBe(true)
  })
})
