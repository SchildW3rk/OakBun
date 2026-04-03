import { describe, test, expect } from 'bun:test'
import { definePlugin } from '../../packages/core/src/app/plugin'
import { defineModule } from '../../packages/core/src/app/module'
import { createApp } from '../../packages/core/src/app/index'
import type { AuthAdapter, AuthUser } from '../../packages/core/src/app/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAuth(user: AuthUser | null): AuthAdapter {
  return {
    getUser: async () => user,
    hasPermission: (u, p) => u.permissions.includes(p),
  }
}

function makeUser(permissions: string[]): AuthUser {
  return { id: 'u1', permissions }
}

function makeModule(prefix: string) {
  return defineModule(prefix)
    .route({ method: 'GET', path: '/', handler: (ctx) => ctx.json({ ok: true }) })
    .build()
}

// ── 1. Plugin without .permission() — no gate ─────────────────────────────────

describe('plugin without .permission()', () => {
  test('route reachable without auth — behaviour unchanged', async () => {
    const mod = makeModule('/open')
    const plugin = definePlugin<object>('open-plugin')
      .modules([mod])
      .extend(() => ({}))

    const app = createApp()  // no auth adapter
    app.plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/open'))
    expect(res.status).toBe(200)
  })

  test('plugin.permissions is undefined', () => {
    const plugin = definePlugin<object>('no-perm').extend(() => ({}))
    expect(plugin.permissions).toBeUndefined()
  })
})

// ── 2. User has required permission → 200 ────────────────────────────────────

describe('plugin with .permission() — user has permission', () => {
  test('single permission — user has it → 200', async () => {
    const mod = makeModule('/crm')
    const plugin = definePlugin<object>('crm')
      .modules([mod])
      .permission('crm:read')
      .extend(() => ({}))

    const app = createApp({ auth: makeAuth(makeUser(['crm:read'])) })
    app.plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/crm'))
    expect(res.status).toBe(200)
  })

  test('permission array — user has one of them → 200', async () => {
    const mod = makeModule('/admin')
    const plugin = definePlugin<object>('admin')
      .modules([mod])
      .permission(['admin', 'superuser'])
      .extend(() => ({}))

    const app = createApp({ auth: makeAuth(makeUser(['admin'])) })
    app.plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/admin'))
    expect(res.status).toBe(200)
  })

  test('permission array — user has second one → 200', async () => {
    const mod = makeModule('/admin2')
    const plugin = definePlugin<object>('admin2')
      .modules([mod])
      .permission(['admin', 'superuser'])
      .extend(() => ({}))

    const app = createApp({ auth: makeAuth(makeUser(['superuser'])) })
    app.plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/admin2'))
    expect(res.status).toBe(200)
  })
})

// ── 3. User lacks permission → 403 ───────────────────────────────────────────

describe('plugin with .permission() — user lacks permission', () => {
  test('user authenticated but missing permission → 403', async () => {
    const mod = makeModule('/secret')
    const plugin = definePlugin<object>('secret')
      .modules([mod])
      .permission('crm:read')
      .extend(() => ({}))

    const app = createApp({ auth: makeAuth(makeUser(['user:read'])) })
    app.plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/secret'))
    expect(res.status).toBe(403)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('FORBIDDEN')
  })

  test('user with empty permissions → 403', async () => {
    const mod = makeModule('/locked')
    const plugin = definePlugin<object>('locked')
      .modules([mod])
      .permission('any:perm')
      .extend(() => ({}))

    const app = createApp({ auth: makeAuth(makeUser([])) })
    app.plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/locked'))
    expect(res.status).toBe(403)
  })
})

// ── 4. No user in context → 401 ──────────────────────────────────────────────

describe('plugin with .permission() — no user', () => {
  test('no auth adapter configured → 401', async () => {
    const mod = makeModule('/guarded')
    const plugin = definePlugin<object>('guarded')
      .modules([mod])
      .permission('crm:read')
      .extend(() => ({}))

    // No auth adapter — ctx.user will be null
    const app = createApp()
    app.plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/guarded'))
    expect(res.status).toBe(401)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('UNAUTHORIZED')
  })

  test('auth adapter returns null user → 401', async () => {
    const mod = makeModule('/members')
    const plugin = definePlugin<object>('members')
      .modules([mod])
      .permission('members:read')
      .extend(() => ({}))

    const app = createApp({ auth: makeAuth(null) })
    app.plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/members'))
    expect(res.status).toBe(401)
  })
})

// ── 5. Two plugins — permission isolation ────────────────────────────────────

describe('two plugins with different permissions — isolation', () => {
  test('user with crm:read can reach /crm but not /billing', async () => {
    const crmMod     = makeModule('/crm-iso')
    const billingMod = makeModule('/billing-iso')

    const crmPlugin = definePlugin<object>('crm-iso')
      .modules([crmMod])
      .permission('crm:read')
      .extend(() => ({}))

    const billingPlugin = definePlugin<object>('billing-iso')
      .modules([billingMod])
      .permission('billing:read')
      .extend(() => ({}))

    const app = createApp({ auth: makeAuth(makeUser(['crm:read'])) })
    app.plugin(crmPlugin).plugin(billingPlugin)

    const crmRes     = await app.fetch(new Request('http://localhost/crm-iso'))
    const billingRes = await app.fetch(new Request('http://localhost/billing-iso'))

    expect(crmRes.status).toBe(200)
    expect(billingRes.status).toBe(403)
  })

  test('routes not from a permissioned plugin are unaffected', async () => {
    const mod = makeModule('/permissioned')
    const plugin = definePlugin<object>('perm-plugin')
      .modules([mod])
      .permission('special')
      .extend(() => ({}))

    const app = createApp({ auth: makeAuth(null) })
    app.plugin(plugin)
    // Route registered directly on app — no plugin gate
    app.get('/public', (ctx) => ctx.json({ pub: true }))

    const permRes   = await app.fetch(new Request('http://localhost/permissioned'))
    const publicRes = await app.fetch(new Request('http://localhost/public'))

    expect(permRes.status).toBe(401)
    expect(publicRes.status).toBe(200)
  })
})

// ── 6. Check runs before plugin.request() ────────────────────────────────────

describe('permission check order — before plugin.request()', () => {
  test('plugin.request() is NOT called when permission denied', async () => {
    const mod = makeModule('/side-effect')
    let requestCalled = false

    const plugin = definePlugin<object>('side-effect-plugin')
      .modules([mod])
      .permission('blocked:perm')
      .extend(() => {
        requestCalled = true
        return {}
      })

    const app = createApp({ auth: makeAuth(makeUser([])) })
    app.plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/side-effect'))

    expect(res.status).toBe(403)
    expect(requestCalled).toBe(false)
  })
})

// ── 7. Plugin.permissions field ───────────────────────────────────────────────

describe('Plugin.permissions field', () => {
  test('single string → stored as array', () => {
    const plugin = definePlugin<object>('p').permission('a:b').extend(() => ({}))
    expect(plugin.permissions).toEqual(['a:b'])
  })

  test('array → stored as-is', () => {
    const plugin = definePlugin<object>('p').permission(['a:b', 'c:d']).extend(() => ({}))
    expect(plugin.permissions).toEqual(['a:b', 'c:d'])
  })

  test('no .permission() call → permissions undefined', () => {
    const plugin = definePlugin<object>('p').extend(() => ({}))
    expect(plugin.permissions).toBeUndefined()
  })
})
