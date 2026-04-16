import { describe, test, expect } from 'bun:test'
import { definePlugin } from '../../packages/core/src/app/plugin'
import { defineModule } from '../../packages/core/src/app/module'
import { createApp } from '../../packages/core/src/app/index'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeModule(prefix: string) {
  return defineModule(prefix)
    .route({ method: 'GET', path: '/', handler: (ctx) => ctx.json({ ok: true }) })
    .build()
}

function blockingGuard(status: number, code: string) {
  return () => Response.json({ code }, { status })
}

const passingGuard = () => null

// ── 1. Basic: plugin guard blocks all module routes ───────────────────────────

describe('plugin .guard() — basic blocking', () => {
  test('guard returns Response → 403 for all plugin modules', async () => {
    const mod = makeModule('/guarded')
    const plugin = definePlugin<object>('guarded-plugin')
      .modules([mod])
      .guard(blockingGuard(403, 'FORBIDDEN'))
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/guarded'))
    expect(res.status).toBe(403)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('FORBIDDEN')
  })

  test('guard returns null → request passes through', async () => {
    const mod = makeModule('/open')
    const plugin = definePlugin<object>('open-plugin')
      .modules([mod])
      .guard(passingGuard)
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/open'))
    expect(res.status).toBe(200)
  })
})

// ── 2. Multiple modules in one plugin — guard applies to all ──────────────────

describe('plugin .guard() — multiple modules', () => {
  test('guard blocks all modules in the plugin', async () => {
    const modA = makeModule('/mod-a')
    const modB = makeModule('/mod-b')
    const plugin = definePlugin<object>('multi-plugin')
      .modules([modA, modB])
      .guard(blockingGuard(401, 'UNAUTHORIZED'))
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)

    const resA = await app.fetch(new Request('http://localhost/mod-a'))
    const resB = await app.fetch(new Request('http://localhost/mod-b'))
    expect(resA.status).toBe(401)
    expect(resB.status).toBe(401)
  })

  test('passing guard allows all modules', async () => {
    const modA = makeModule('/pass-a')
    const modB = makeModule('/pass-b')
    const plugin = definePlugin<object>('pass-plugin')
      .modules([modA, modB])
      .guard(passingGuard)
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)

    const resA = await app.fetch(new Request('http://localhost/pass-a'))
    const resB = await app.fetch(new Request('http://localhost/pass-b'))
    expect(resA.status).toBe(200)
    expect(resB.status).toBe(200)
  })
})

// ── 3. Multiple guards — all must pass ───────────────────────────────────────

describe('plugin .guard() — multiple guards', () => {
  test('first guard blocks — second never runs', async () => {
    const mod = makeModule('/multi-guard')
    let secondRan = false

    const plugin = definePlugin<object>('multi-guard-plugin')
      .modules([mod])
      .guard(blockingGuard(401, 'FIRST_BLOCKED'))
      .guard(() => { secondRan = true; return null })
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/multi-guard'))
    expect(res.status).toBe(401)
    expect(secondRan).toBe(false)
  })

  test('first passes, second blocks', async () => {
    const mod = makeModule('/second-blocks')
    const plugin = definePlugin<object>('second-blocks-plugin')
      .modules([mod])
      .guard(passingGuard)
      .guard(blockingGuard(403, 'SECOND_BLOCKED'))
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/second-blocks'))
    expect(res.status).toBe(403)
  })

  test('both pass → 200', async () => {
    const mod = makeModule('/both-pass')
    const plugin = definePlugin<object>('both-pass-plugin')
      .modules([mod])
      .guard(passingGuard)
      .guard(passingGuard)
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/both-pass'))
    expect(res.status).toBe(200)
  })
})

// ── 4. Guard tier order: global → plugin → module → route ────────────────────

describe('guard tier order', () => {
  test('plugin A guard runs before plugin B guard (registration order)', async () => {
    // Two plugins — A has no modules (acts as "global"), B has a module with a guard.
    // Plugin A's guard runs first because it's registered first.
    const order: string[] = []
    const mod = makeModule('/order-a-before-b')

    const pluginA = definePlugin<object>('order-a')
      .modules([makeModule('/order-a-own')])
      .guard(() => { order.push('pluginA'); return null })
      .extend(() => ({}))

    const pluginB = definePlugin<object>('order-b')
      .modules([mod])
      .guard(() => { order.push('pluginB'); return null })
      .extend(() => ({}))

    const app = createApp()
    app.plugin(pluginA).plugin(pluginB)

    await app.fetch(new Request('http://localhost/order-a-before-b'))
    // pluginA guard does NOT run for pluginB routes — guards are isolated per plugin
    expect(order).toEqual(['pluginB'])
  })

  test('plugin guard runs before module guard', async () => {
    const order: string[] = []
    const mod = defineModule('/order-plugin-module')
      .guard(() => { order.push('module'); return null })
      .route({ method: 'GET', path: '/', handler: (ctx) => ctx.json({ ok: true }) })
      .build()

    const plugin = definePlugin<object>('order-pm-plugin')
      .modules([mod])
      .guard(() => { order.push('plugin'); return null })
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)

    await app.fetch(new Request('http://localhost/order-plugin-module'))
    expect(order).toEqual(['plugin', 'module'])
  })

  test('module guard runs before route guard', async () => {
    const order: string[] = []
    const mod = defineModule('/order-module-route')
      .guard(() => { order.push('module'); return null })
      .route({
        method: 'GET',
        path: '/',
        guard: () => { order.push('route'); return null },
        handler: (ctx) => ctx.json({ ok: true }),
      })
      .build()

    const plugin = definePlugin<object>('order-mr-plugin')
      .modules([mod])
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)

    await app.fetch(new Request('http://localhost/order-module-route'))
    expect(order).toEqual(['module', 'route'])
  })

  test('full chain: global-plugin → plugin → module → route', async () => {
    // "global" here means a plugin registered before the tested plugin (no .modules()),
    // which is the closest public API to a global guard
    const order: string[] = []
    const mod = defineModule('/order-full')
      .guard(() => { order.push('module'); return null })
      .route({
        method: 'GET',
        path: '/',
        guard: () => { order.push('route'); return null },
        handler: (ctx) => ctx.json({ ok: true }),
      })
      .build()

    const plugin = definePlugin<object>('order-full-plugin')
      .modules([mod])
      .guard(() => { order.push('plugin'); return null })
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)

    await app.fetch(new Request('http://localhost/order-full'))
    expect(order).toEqual(['plugin', 'module', 'route'])
  })

  test('plugin guard blocks — module + route guards never run', async () => {
    const order: string[] = []
    const mod = defineModule('/plugin-blocks-all')
      .guard(() => { order.push('module'); return null })
      .route({
        method: 'GET',
        path: '/',
        guard: () => { order.push('route'); return null },
        handler: (ctx) => ctx.json({ ok: true }),
      })
      .build()

    const plugin = definePlugin<object>('plugin-blocks-all-plugin')
      .modules([mod])
      .guard(() => { order.push('plugin'); return Response.json({ code: 'BLOCKED' }, { status: 401 }) })
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)

    const res = await app.fetch(new Request('http://localhost/plugin-blocks-all'))
    expect(res.status).toBe(401)
    expect(order).toEqual(['plugin'])
  })

  test('plugin guard blocks — module guard never runs', async () => {
    const order: string[] = []
    const mod = defineModule('/plugin-blocks-module')
      .guard(() => { order.push('module'); return null })
      .route({ method: 'GET', path: '/', handler: (ctx) => ctx.json({ ok: true }) })
      .build()

    const plugin = definePlugin<object>('plugin-blocks-mod-plugin')
      .modules([mod])
      .guard(() => { order.push('plugin'); return Response.json({ code: 'BLOCKED' }, { status: 403 }) })
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)

    const res = await app.fetch(new Request('http://localhost/plugin-blocks-module'))
    expect(res.status).toBe(403)
    expect(order).toEqual(['plugin'])
  })
})

// ── 5. Plugin isolation — guard only affects its own modules ──────────────────

describe('plugin guard isolation', () => {
  test('plugin guard does not affect routes from another plugin', async () => {
    const modA = makeModule('/iso-a')
    const modB = makeModule('/iso-b')

    const pluginA = definePlugin<object>('iso-plugin-a')
      .modules([modA])
      .guard(blockingGuard(403, 'BLOCKED_A'))
      .extend(() => ({}))

    const pluginB = definePlugin<object>('iso-plugin-b')
      .modules([modB])
      .extend(() => ({}))

    const app = createApp()
    app.plugin(pluginA).plugin(pluginB)

    const resA = await app.fetch(new Request('http://localhost/iso-a'))
    const resB = await app.fetch(new Request('http://localhost/iso-b'))
    expect(resA.status).toBe(403)
    expect(resB.status).toBe(200)
  })

  test('plugin guard does not affect directly registered routes', async () => {
    const mod = makeModule('/guarded-only')
    const plugin = definePlugin<object>('guarded-only-plugin')
      .modules([mod])
      .guard(blockingGuard(403, 'BLOCKED'))
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)
    app.get('/public', (ctx) => ctx.json({ public: true }))

    const guardedRes = await app.fetch(new Request('http://localhost/guarded-only'))
    const publicRes  = await app.fetch(new Request('http://localhost/public'))
    expect(guardedRes.status).toBe(403)
    expect(publicRes.status).toBe(200)
  })
})

// ── 6. Plugin.guards field ────────────────────────────────────────────────────

describe('Plugin.guards field', () => {
  test('no .guard() call → guards undefined', () => {
    const plugin = definePlugin<object>('no-guard').extend(() => ({}))
    expect(plugin.guards).toBeUndefined()
  })

  test('single guard → stored as array with one entry', () => {
    const g = passingGuard
    const plugin = definePlugin<object>('one-guard').guard(g).extend(() => ({}))
    expect(plugin.guards).toHaveLength(1)
    expect(plugin.guards![0]).toBe(g)
  })

  test('array of guards → all stored', () => {
    const g1 = passingGuard
    const g2 = passingGuard
    const plugin = definePlugin<object>('arr-guard').guard([g1, g2]).extend(() => ({}))
    expect(plugin.guards).toHaveLength(2)
  })

  test('chained .guard() calls accumulate', () => {
    const plugin = definePlugin<object>('chained')
      .guard(passingGuard)
      .guard(passingGuard)
      .guard(passingGuard)
      .extend(() => ({}))
    expect(plugin.guards).toHaveLength(3)
  })
})

// ── 7. Guard throws — error is handled gracefully ─────────────────────────────

describe('plugin guard error handling', () => {
  test('guard throws → 500 response, does not crash server', async () => {
    const mod = makeModule('/guard-throws')
    const plugin = definePlugin<object>('guard-throws-plugin')
      .modules([mod])
      .guard(() => { throw new Error('guard exploded') })
      .extend(() => ({}))

    const app = createApp()
    app.plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/guard-throws'))
    expect(res.status).toBe(500)
  })
})
