import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { createOnRequest } from '../../packages/core/src/app/types'
import type { AuthAdapter, AuthUser, BaseCtx } from '../../packages/core/src/app/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAdapter(user: AuthUser | null): AuthAdapter {
  return {
    getUser: async () => user,
    hasPermission: (u, p) => u.permissions.includes(p),
  }
}

// ── 1. createApp() without auth ───────────────────────────────────────────────

describe('createApp() — no auth adapter', () => {
  test('ctx.user is null when no adapter is configured', async () => {
    const app = createApp()
    let captured: AuthUser | null | undefined

    app.get('/', (ctx) => {
      captured = ctx.user
      return ctx.json({ ok: true })
    })

    await app.fetch(new Request('http://localhost/'))
    expect(captured).toBeNull()
  })

  test('existing apps without auth option still work (backward compat)', async () => {
    const app = createApp()
    app.get('/ping', (ctx) => ctx.json({ pong: true }))
    const res = await app.fetch(new Request('http://localhost/ping'))
    expect(res.status).toBe(200)
  })
})

// ── 2. createApp() with auth adapter ─────────────────────────────────────────

describe('createApp({ auth }) — with adapter', () => {
  test('ctx.user is populated when getUser() returns a user', async () => {
    const user: AuthUser = { id: 'u1', permissions: ['post:write', 'role:admin'] }
    const app = createApp({ auth: makeAdapter(user) })
    let captured: AuthUser | null | undefined

    app.get('/', (ctx) => {
      captured = ctx.user
      return ctx.json({ ok: true })
    })

    await app.fetch(new Request('http://localhost/'))
    expect(captured).toEqual(user)
  })

  test('ctx.user is null when getUser() returns null', async () => {
    const app = createApp({ auth: makeAdapter(null) })
    let captured: AuthUser | null | undefined

    app.get('/', (ctx) => {
      captured = ctx.user
      return ctx.json({ ok: true })
    })

    await app.fetch(new Request('http://localhost/'))
    expect(captured).toBeNull()
  })

  test('ctx.user is available in onRequest hooks', async () => {
    const user: AuthUser = { id: 'u2', permissions: [] }
    const app = createApp({ auth: makeAdapter(user) })
    let capturedInHook: AuthUser | null | undefined

    app.onRequest(createOnRequest((ctx) => { capturedInHook = ctx.user }))
    app.get('/', (ctx) => ctx.json({ ok: true }))

    await app.fetch(new Request('http://localhost/'))
    expect(capturedInHook).toEqual(user)
  })

  test('ctx.user is available in plugins (plugins run after auth)', async () => {
    const user: AuthUser = { id: 'u3', permissions: ['read'] }
    const app = createApp({ auth: makeAdapter(user) })
    let capturedInPlugin: AuthUser | null | undefined

    const { definePlugin } = await import('../../packages/core/src/app/plugin')
    const p = definePlugin<object>('spy').extend((ctx) => {
      capturedInPlugin = ctx.user
      return {}
    })

    app.plugin(p)
    app.get('/', (ctx) => ctx.json({ ok: true }))
    await app.fetch(new Request('http://localhost/'))
    expect(capturedInPlugin).toEqual(user)
  })

  test('getUser() throwing → ctx.user is null, no crash', async () => {
    const throwingAdapter: AuthAdapter = {
      getUser: async () => { throw new Error('auth service down') },
      hasPermission: () => false,
    }
    const app = createApp({ auth: throwingAdapter })
    let captured: AuthUser | null | undefined

    app.get('/', (ctx) => {
      captured = ctx.user
      return ctx.json({ ok: true })
    })

    const res = await app.fetch(new Request('http://localhost/'))
    expect(res.status).toBe(200)
    expect(captured).toBeNull()
  })
})

// ── 3. hasPermission() — default implementations ──────────────────────────────

describe('AuthAdapter.hasPermission()', () => {
  test('user has permission → true', () => {
    const adapter = makeAdapter(null)
    const user: AuthUser = { id: 'u1', permissions: ['post:write', 'user:read'] }
    expect(adapter.hasPermission(user, 'post:write')).toBe(true)
  })

  test('user does not have permission → false', () => {
    const adapter = makeAdapter(null)
    const user: AuthUser = { id: 'u1', permissions: ['user:read'] }
    expect(adapter.hasPermission(user, 'post:write')).toBe(false)
  })

  test('empty permissions → false for any permission', () => {
    const adapter = makeAdapter(null)
    const user: AuthUser = { id: 'u1', permissions: [] }
    expect(adapter.hasPermission(user, 'anything')).toBe(false)
  })

  test('exact match only — substring does not match', () => {
    const adapter = makeAdapter(null)
    const user: AuthUser = { id: 'u1', permissions: ['post:write'] }
    expect(adapter.hasPermission(user, 'post')).toBe(false)
    expect(adapter.hasPermission(user, 'write')).toBe(false)
  })
})

// ── 4. AuthUser shape ────────────────────────────────────────────────────────

describe('AuthUser interface', () => {
  test('has id and permissions fields', () => {
    const user: AuthUser = { id: 'abc', permissions: ['x', 'y'] }
    expect(user.id).toBe('abc')
    expect(user.permissions).toEqual(['x', 'y'])
  })
})
