import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import type { BaseCtx } from '../../packages/core/src/app/types'
import type { Plugin } from '../../packages/core/src/app/plugin'

// ── Test 1: Module plugin request() is called per request ────

describe('Module Plugin — request() called per request', () => {
  test('request() is invoked once per fetch()', async () => {
    let callCount = 0

    const countPlugin: Plugin<BaseCtx, { count: number }> = {
      name: 'counter',
      request: (ctx) => {
        callCount++
        return { ...ctx, count: callCount }
      },
    }

    const app = createApp()
    const mod = defineModule('/test')
      .plugin(countPlugin)
      .get('/', (ctx) => ctx.json({ count: ctx.count }))
      .build()

    app.register(mod)

    await app.fetch(new Request('http://localhost/test/'))
    await app.fetch(new Request('http://localhost/test/'))
    expect(callCount).toBe(2)
  })
})

// ── Test 2: Second plugin sees ctx from first plugin ─────────

describe('Module Plugin — plugin chain ordering', () => {
  test('second plugin receives ctx extended by first plugin', async () => {
    let secondPluginSawFirst = false

    const firstPlugin: Plugin<BaseCtx, { fromFirst: string }> = {
      name: 'first',
      request: (ctx) => ({ ...ctx, fromFirst: 'yes' }),
    }

    type AfterFirst = BaseCtx & { fromFirst: string }
    const secondPlugin: Plugin<AfterFirst, { fromSecond: string }> = {
      name: 'second',
      request: (ctx) => {
        secondPluginSawFirst = ctx.fromFirst === 'yes'
        return { ...ctx, fromSecond: 'also-yes' }
      },
    }

    const app = createApp()
    const mod = defineModule('/chain')
      .plugin(firstPlugin)
      .plugin(secondPlugin)
      .get('/', (ctx) => ctx.json({ fromFirst: ctx.fromFirst, fromSecond: ctx.fromSecond }))
      .build()

    app.register(mod)

    const res = await app.fetch(new Request('http://localhost/chain/'))
    expect(res.status).toBe(200)
    expect(secondPluginSawFirst).toBe(true)
    const body = await res.json() as { fromFirst: string; fromSecond: string }
    expect(body.fromFirst).toBe('yes')
    expect(body.fromSecond).toBe('also-yes')
  })
})

// ── Test 3: Handler receives fully extended ctx ──────────────

describe('Module Plugin — handler sees extended ctx', () => {
  test('handler ctx has property added by module plugin', async () => {
    const counterPlugin: Plugin<BaseCtx, { count: number }> = {
      name: 'counter',
      request: async (ctx) => ({ ...ctx, count: 42 }),
    }

    const app = createApp()
    const mod = defineModule('/test')
      .plugin(counterPlugin)
      .get('/', (ctx) => ctx.json({ count: ctx.count }))
      .build()

    app.register(mod)

    const res = await app.fetch(new Request('http://localhost/test/'))
    const body = await res.json() as { count: number }
    expect(body.count).toBe(42)
  })
})

// ── Test 4: Module isolation — plugin A has no effect on B ───

describe('Module Plugin — isolation', () => {
  test('plugin on module A does not affect module B routes', async () => {
    let moduleAPluginCalledForB = false

    const moduleAPlugin: Plugin<BaseCtx, { fromA: string }> = {
      name: 'module-a-plugin',
      request: (ctx) => {
        // Track if this is called for any route
        moduleAPluginCalledForB = true
        return { ...ctx, fromA: 'hello' }
      },
    }

    const app = createApp()

    const modA = defineModule('/a')
      .plugin(moduleAPlugin)
      .get('/', (ctx) => ctx.json({ module: 'a', fromA: ctx.fromA }))
      .build()

    const modB = defineModule('/b')
      .get('/', (ctx) => ctx.json({ module: 'b' }))
      .build()

    app.register(modA)
    app.register(modB)

    // Reset flag after module A registration
    moduleAPluginCalledForB = false

    // Call module B — module A's plugin must NOT run
    const resB = await app.fetch(new Request('http://localhost/b/'))
    expect(resB.status).toBe(200)
    expect(moduleAPluginCalledForB).toBe(false)

    const bodyB = await resB.json() as { module: string }
    expect(bodyB.module).toBe('b')

    // Confirm module A still works
    moduleAPluginCalledForB = false
    const resA = await app.fetch(new Request('http://localhost/a/'))
    expect(resA.status).toBe(200)
    expect(moduleAPluginCalledForB).toBe(true)
  })
})

// ── Test 5: Plugin throws in request() → onError, handler NOT called ──

describe('Module Plugin — error in request() runs onError', () => {
  test('plugin throwing in request() calls module onError, not handler', async () => {
    let handlerCalled = false
    let onErrorCalled = false

    const badPlugin: Plugin<BaseCtx, { never: never }> = {
      name: 'bad',
      request: (_ctx) => {
        throw new Error('plugin explosion')
      },
    }

    const app = createApp()

    const mod = defineModule('/failing')
      .plugin(badPlugin)
      .get('/', (_ctx) => {
        handlerCalled = true
        return new Response('should not reach', { status: 200 })
      })
      .onError((err, ctx) => {
        onErrorCalled = true
        return ctx.json({ error: String(err) }, 500)
      })
      .build()

    app.register(mod)

    const res = await app.fetch(new Request('http://localhost/failing/'))
    expect(res.status).toBe(500)
    expect(handlerCalled).toBe(false)
    expect(onErrorCalled).toBe(true)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('plugin explosion')
  })
})

// ── Test 6: install() called on first fetch, not again ───────

describe('Module Plugin — install() lifecycle', () => {
  test('install() called exactly once on first fetch()', async () => {
    let installCalls = 0

    const installablePlugin: Plugin<BaseCtx, { installed: true }> = {
      name: 'installable',
      install: async () => { installCalls++ },
      request: (ctx) => ({ ...ctx, installed: true as const }),
    }

    const app = createApp()
    const mod = defineModule('/installtest')
      .plugin(installablePlugin)
      .get('/', (ctx) => ctx.json({ installed: ctx.installed }))
      .build()

    app.register(mod)

    // First request — install() should be called
    const res1 = await app.fetch(new Request('http://localhost/installtest/'))
    expect(res1.status).toBe(200)
    expect(installCalls).toBe(1)

    // Second request — install() must NOT be called again
    const res2 = await app.fetch(new Request('http://localhost/installtest/'))
    expect(res2.status).toBe(200)
    expect(installCalls).toBe(1)
  })
})
