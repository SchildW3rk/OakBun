import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import type { Plugin, BaseCtx } from '../../packages/core/src/app/index'

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Builds a counting plugin that records how many times install() was called. */
function makeCountingPlugin(name: string): {
  plugin: Plugin<BaseCtx, Record<string, never>>
  installCount: () => number
} {
  let count = 0
  const plugin: Plugin<BaseCtx, Record<string, never>> = {
    name,
    install: async () => {
      count++
      // Simulate async work (e.g. DB connection setup) — this is the yield point
      // where a second concurrent request could interleave if the Set were not marked first.
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
    },
    request: (ctx) => ctx,
  }
  return { plugin, installCount: () => count }
}

// ── 1. Parallel requests — install runs exactly once ─────────────────────────

describe('module plugin install — parallel requests', () => {
  test('install() called exactly once even when 10 requests hit the route simultaneously', async () => {
    const { plugin, installCount } = makeCountingPlugin('counter-plugin')

    const mod = defineModule('/api')
      .plugin(plugin)
      .get('/hit', { handler: (ctx) => ctx.json({ ok: true }) })
      .build()

    const app = createApp()
    app.register(mod)

    // Fire 10 requests in parallel — all hit the same route at the same time.
    // The plugin's install() has a 5ms async delay, so without the optimistic-add
    // pattern all 10 would see has() = false before any add() completes.
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.fetch(new Request('http://localhost/api/hit')),
      ),
    )

    // All requests must succeed
    for (const res of responses) {
      expect(res.status).toBe(200)
    }

    // install() must have been called exactly once
    expect(installCount()).toBe(1)
  })

  test('install() called once even across 50 parallel requests', async () => {
    const { plugin, installCount } = makeCountingPlugin('heavy-plugin')

    const mod = defineModule('/heavy')
      .plugin(plugin)
      .get('/work', { handler: (ctx) => ctx.json({ ok: true }) })
      .build()

    const app = createApp()
    app.register(mod)

    await Promise.all(
      Array.from({ length: 50 }, () =>
        app.fetch(new Request('http://localhost/heavy/work')),
      ),
    )

    expect(installCount()).toBe(1)
  })
})

// ── 2. Two modules with separate plugins — independent install ────────────────

describe('two modules — independent plugin install', () => {
  test('each module plugin installed exactly once, no cross-interference', async () => {
    const { plugin: pluginA, installCount: countA } = makeCountingPlugin('plugin-a')
    const { plugin: pluginB, installCount: countB } = makeCountingPlugin('plugin-b')

    const modA = defineModule('/a')
      .plugin(pluginA)
      .get('/go', { handler: (ctx) => ctx.json({ module: 'a' }) })
      .build()

    const modB = defineModule('/b')
      .plugin(pluginB)
      .get('/go', { handler: (ctx) => ctx.json({ module: 'b' }) })
      .build()

    const app = createApp()
    app.register(modA)
    app.register(modB)

    // Hit both modules in parallel
    await Promise.all([
      ...Array.from({ length: 5 }, () => app.fetch(new Request('http://localhost/a/go'))),
      ...Array.from({ length: 5 }, () => app.fetch(new Request('http://localhost/b/go'))),
    ])

    expect(countA()).toBe(1)
    expect(countB()).toBe(1)
  })
})

// ── 3. Same plugin name on two modules — installed once, shared ───────────────

describe('same plugin name on two modules — installed only once', () => {
  test('plugin with same name shared across modules: install() runs once', async () => {
    const { plugin, installCount } = makeCountingPlugin('shared-plugin')

    // Two modules that both declare the same plugin instance
    const modA = defineModule('/x')
      .plugin(plugin)
      .get('/ping', { handler: (ctx) => ctx.json({ ok: true }) })
      .build()

    const modB = defineModule('/y')
      .plugin(plugin)
      .get('/pong', { handler: (ctx) => ctx.json({ ok: true }) })
      .build()

    const app = createApp()
    app.register(modA)
    app.register(modB)

    await Promise.all([
      app.fetch(new Request('http://localhost/x/ping')),
      app.fetch(new Request('http://localhost/y/pong')),
    ])

    // Plugin name is used as the key — same name = installed once
    expect(installCount()).toBe(1)
  })
})

// ── 4. Plugin without install() — no Set mutation, no issue ──────────────────

describe('plugin without install() — no-op', () => {
  test('plugin with no install function works correctly in parallel', async () => {
    let requestCount = 0
    const noInstallPlugin: Plugin<BaseCtx, Record<string, never>> = {
      name: 'no-install',
      // No install() function
      request: (ctx) => {
        requestCount++
        return ctx
      },
    }

    const mod = defineModule('/simple')
      .plugin(noInstallPlugin)
      .get('/check', { handler: (ctx) => ctx.json({ ok: true }) })
      .build()

    const app = createApp()
    app.register(mod)

    await Promise.all(
      Array.from({ length: 10 }, () =>
        app.fetch(new Request('http://localhost/simple/check')),
      ),
    )

    // request() runs per-request — 10 requests = 10 calls
    expect(requestCount).toBe(10)
  })
})
