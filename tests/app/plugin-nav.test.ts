import { describe, test, expect } from 'bun:test'
import { definePlugin } from '../../packages/core/src/app/plugin'
import type { NavItem } from '../../packages/core/src/app/plugin'
import { createApp } from '../../packages/core/src/app/index'
import type { AuthAdapter, AuthUser } from '../../packages/core/src/app/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAuth(user: AuthUser | null): AuthAdapter {
  return {
    getUser:       async () => user,
    hasPermission: (u, p) => u.permissions.includes(p),
  }
}

function makeUser(permissions: string[]): AuthUser {
  return { id: 'u1', permissions }
}

async function getNav(app: ReturnType<typeof createApp>, path = '/nav'): Promise<NavItem[]> {
  const res = await app.fetch(new Request(`http://localhost${path}`))
  const body = await res.json() as { nav: NavItem[] }
  return body.nav
}

// ── 1. Plugin without permission — items always visible ───────────────────────

describe('plugin nav — no permission gate', () => {
  test('nav items returned without auth', async () => {
    const plugin = definePlugin<object>('public-plugin')
      .nav({ label: 'Home', route: '/' })
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)
    const nav = await getNav(app)
    expect(nav).toHaveLength(1)
    expect(nav[0]?.label).toBe('Home')
    expect(nav[0]?.route).toBe('/')
  })

  test('nav items returned even when user is null', async () => {
    const plugin = definePlugin<object>('also-public')
      .nav([{ label: 'Dashboard', route: '/dashboard', icon: 'home' }])
      .extend(() => ({}))

    const app = createApp({ auth: makeAuth(null) })
    app.plugin(plugin)
    const nav = await getNav(app)
    expect(nav).toHaveLength(1)
  })
})

// ── 2. Plugin with permission — user has it → items visible ──────────────────

describe('plugin nav — with permission, user authorized', () => {
  test('user has permission → nav items included', async () => {
    const plugin = definePlugin<object>('crm')
      .permission('crm:read')
      .nav({ label: 'CRM', route: '/crm', icon: 'users' })
      .extend(() => ({}))

    const app = createApp({ auth: makeAuth(makeUser(['crm:read'])) })
    app.plugin(plugin)
    const nav = await getNav(app)
    expect(nav).toHaveLength(1)
    expect(nav[0]?.label).toBe('CRM')
  })

  test('user has one of multiple required permissions → items included', async () => {
    const plugin = definePlugin<object>('billing')
      .permission(['billing:read', 'admin'])
      .nav({ label: 'Billing', route: '/billing' })
      .extend(() => ({}))

    const app = createApp({ auth: makeAuth(makeUser(['admin'])) })
    app.plugin(plugin)
    const nav = await getNav(app)
    expect(nav).toHaveLength(1)
  })
})

// ── 3. Plugin with permission — user lacks it → items hidden ──────────────────

describe('plugin nav — with permission, user unauthorized', () => {
  test('user lacks permission → nav items not returned', async () => {
    const plugin = definePlugin<object>('restricted')
      .permission('secret:access')
      .nav({ label: 'Secret', route: '/secret' })
      .extend(() => ({}))

    const app = createApp({ auth: makeAuth(makeUser(['user:read'])) })
    app.plugin(plugin)
    const nav = await getNav(app)
    expect(nav).toHaveLength(0)
  })

  test('user with empty permissions → nav items not returned', async () => {
    const plugin = definePlugin<object>('locked')
      .permission('any:perm')
      .nav({ label: 'Locked', route: '/locked' })
      .extend(() => ({}))

    const app = createApp({ auth: makeAuth(makeUser([])) })
    app.plugin(plugin)
    const nav = await getNav(app)
    expect(nav).toHaveLength(0)
  })
})

// ── 4. No user → empty array, no error ───────────────────────────────────────

describe('plugin nav — no user in context', () => {
  test('permissioned plugin + no user → empty array, 200', async () => {
    const plugin = definePlugin<object>('gated')
      .permission('crm:read')
      .nav({ label: 'CRM', route: '/crm' })
      .extend(() => ({}))

    const app = createApp()  // no auth adapter → ctx.user = null
    app.plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/nav'))
    expect(res.status).toBe(200)
    const body = await res.json() as { nav: NavItem[] }
    expect(body.nav).toHaveLength(0)
  })
})

// ── 5. Multiple plugins — nav merged correctly ────────────────────────────────

describe('multiple plugins — nav merging', () => {
  test('nav items from all visible plugins are merged', async () => {
    const publicPlugin = definePlugin<object>('p1')
      .nav({ label: 'Public', route: '/public' })
      .extend(() => ({}))

    const crmPlugin = definePlugin<object>('p2')
      .permission('crm:read')
      .nav({ label: 'CRM', route: '/crm' })
      .extend(() => ({}))

    const billingPlugin = definePlugin<object>('p3')
      .permission('billing:read')
      .nav({ label: 'Billing', route: '/billing' })
      .extend(() => ({}))

    const app = createApp({ auth: makeAuth(makeUser(['crm:read'])) })
    app.plugin(publicPlugin).plugin(crmPlugin).plugin(billingPlugin)
    const nav = await getNav(app)

    expect(nav).toHaveLength(2)
    const labels = nav.map((n) => n.label)
    expect(labels).toContain('Public')
    expect(labels).toContain('CRM')
    expect(labels).not.toContain('Billing')
  })
})

// ── 6. Sorting — order then alphabetical ─────────────────────────────────────

describe('nav sorting', () => {
  test('sorted by order ascending, then alphabetically by label', async () => {
    const plugin = definePlugin<object>('sorted')
      .nav([
        { label: 'Zebra',    route: '/z', order: 5  },
        { label: 'Alpha',    route: '/a', order: 10 },
        { label: 'Beta',     route: '/b', order: 5  },
        { label: 'Dashboard', route: '/d', order: 0 },
      ])
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)
    const nav = await getNav(app)

    expect(nav.map((n) => n.label)).toEqual(['Dashboard', 'Beta', 'Zebra', 'Alpha'])
  })

  test('items without order default to 0, sorted alphabetically among them', async () => {
    const plugin = definePlugin<object>('default-order')
      .nav([
        { label: 'Zeta',  route: '/z' },
        { label: 'Alpha', route: '/a' },
      ])
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)
    const nav = await getNav(app)
    expect(nav.map((n) => n.label)).toEqual(['Alpha', 'Zeta'])
  })
})

// ── 7. Children passed through without further filtering ─────────────────────

describe('nav children', () => {
  test('children are included in the response as-is', async () => {
    const plugin = definePlugin<object>('with-children')
      .nav({
        label:    'Settings',
        route:    '/settings',
        children: [
          { label: 'Profile',  route: '/settings/profile' },
          { label: 'Security', route: '/settings/security' },
        ],
      })
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)
    const nav = await getNav(app)
    expect(nav).toHaveLength(1)
    expect(nav[0]?.children).toHaveLength(2)
    expect(nav[0]?.children?.[0]?.label).toBe('Profile')
  })
})

// ── 8. Custom nav path ────────────────────────────────────────────────────────

describe('custom nav path', () => {
  test('GET /api/nav works when configured', async () => {
    const plugin = definePlugin<object>('custom-path-plugin')
      .nav({ label: 'Home', route: '/' })
      .extend(() => ({}))

    const app = createApp({ nav: { path: '/api/nav' } })
    app.plugin(plugin)

    const customRes = await app.fetch(new Request('http://localhost/api/nav'))
    expect(customRes.status).toBe(200)
    const nav = await getNav(app, '/api/nav')
    expect(nav).toHaveLength(1)
  })

  test('default /nav path still works without configuration', async () => {
    const plugin = definePlugin<object>('default-path-plugin')
      .nav({ label: 'Home', route: '/' })
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/nav'))
    expect(res.status).toBe(200)
  })
})

// ── 9. Plugin.nav field ───────────────────────────────────────────────────────

describe('Plugin.nav field', () => {
  test('single item → stored as array', () => {
    const plugin = definePlugin<object>('p').nav({ label: 'X', route: '/x' }).extend(() => ({}))
    expect(plugin.nav).toHaveLength(1)
    expect(plugin.nav?.[0]?.label).toBe('X')
  })

  test('array → stored as-is', () => {
    const plugin = definePlugin<object>('p')
      .nav([{ label: 'A', route: '/a' }, { label: 'B', route: '/b' }])
      .extend(() => ({}))
    expect(plugin.nav).toHaveLength(2)
  })

  test('no .nav() call → nav is undefined', () => {
    const plugin = definePlugin<object>('p').extend(() => ({}))
    expect(plugin.nav).toBeUndefined()
  })
})
