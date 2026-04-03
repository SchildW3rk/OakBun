/**
 * plugin-modules-typed.test.ts — Spec 04: Typed Module Context
 *
 * Tests Option A (.modules(factory)) and Option B (defineModule<TCtx>).
 * Both are pure compile-time features; these tests verify:
 *   - Correct runtime behaviour (routes register and respond correctly)
 *   - Backward compatibility (no breaking changes to existing array form or untyped defineModule)
 */

import { describe, test, expect } from 'bun:test'
import { definePlugin } from '../../packages/core/src/app/plugin'
import { defineModule } from '../../packages/core/src/app/module'
import { createApp } from '../../packages/core/src/app/index'
import type { BaseCtx } from '../../packages/core/src/app/types'

// ── Shared fixtures ───────────────────────────────────────────────────────────

type FooCtx = BaseCtx & { foo: string }
type BarCtx = BaseCtx & { bar: number }
type BothCtx = BaseCtx & { foo: string; bar: number }

// ── Option B: defineModule<TCtx> ─────────────────────────────────────────────

describe('Option B — defineModule<TCtx> generic', () => {
  test('handler can access typed ctx field without cast', async () => {
    // defineModule<FooCtx> means ctx.foo is typed — no `as` needed
    const mod = defineModule<FooCtx>('/typed-b')
      .get('/', (ctx) => ctx.json({ foo: ctx.foo }))
      .build()

    const plugin = definePlugin<{ foo: string }>('foo-plugin')
      .modules([mod])
      .extend(() => ({ foo: 'hello-typed' }))

    const app = createApp().plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/typed-b'))
    expect(res.status).toBe(200)
    expect((await res.json() as { foo: string }).foo).toBe('hello-typed')
  })

  test('typed module works with .route() structured form', async () => {
    const mod = defineModule<FooCtx>('/typed-b-route')
      .route({
        method:  'GET',
        path:    '/',
        handler: (ctx) => ctx.json({ foo: ctx.foo }),
      })
      .build()

    const plugin = definePlugin<{ foo: string }>('foo-route-plugin')
      .modules([mod])
      .extend(() => ({ foo: 'structured' }))

    const app = createApp().plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/typed-b-route'))
    expect(res.status).toBe(200)
    expect((await res.json() as { foo: string }).foo).toBe('structured')
  })

  test('defineModule without generic — defaults to BaseCtx, existing tests pass', async () => {
    // No generic = BaseCtx default — identical to existing behaviour
    const mod = defineModule('/no-generic')
      .get('/', (ctx) => ctx.json({ ok: true }))
      .build()

    const plugin = definePlugin<object>('no-generic-plugin')
      .modules([mod])
      .extend(() => ({}))

    const app = createApp().plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/no-generic'))
    expect(res.status).toBe(200)
    expect((await res.json() as { ok: boolean }).ok).toBe(true)
  })
})

// ── Option A: .modules(factory) ──────────────────────────────────────────────

describe('Option A — .modules(factory) typed ctx', () => {
  test('factory form registers routes correctly', async () => {
    const plugin = definePlugin<{ foo: string }>('factory-plugin')
      .modules((_ctx: FooCtx) => [
        defineModule<FooCtx>('/factory-a')
          .get('/', (ctx) => ctx.json({ foo: ctx.foo }))
          .build(),
      ])
      .extend(() => ({ foo: 'from-factory' }))

    const app = createApp().plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/factory-a'))
    expect(res.status).toBe(200)
    expect((await res.json() as { foo: string }).foo).toBe('from-factory')
  })

  test('factory can return multiple modules', async () => {
    const plugin = definePlugin<{ bar: number }>('multi-factory-plugin')
      .modules((_ctx: BarCtx) => [
        defineModule<BarCtx>('/factory-m1')
          .get('/', (ctx) => ctx.json({ bar: ctx.bar }))
          .build(),
        defineModule<BarCtx>('/factory-m2')
          .get('/', (ctx) => ctx.json({ bar: ctx.bar * 2 }))
          .build(),
      ])
      .extend(() => ({ bar: 21 }))

    const app = createApp().plugin(plugin)

    const r1 = await app.fetch(new Request('http://localhost/factory-m1'))
    expect((await r1.json() as { bar: number }).bar).toBe(21)

    const r2 = await app.fetch(new Request('http://localhost/factory-m2'))
    expect((await r2.json() as { bar: number }).bar).toBe(42)
  })

  test('factory is called at plugin-build time, not per-request', () => {
    // The factory must be resolved once — we count calls
    let callCount = 0
    const plugin = definePlugin<object>('count-plugin')
      .modules((_ctx: BaseCtx) => {
        callCount++
        return [
          defineModule('/count-test')
            .get('/', (ctx) => ctx.json({ ok: true }))
            .build(),
        ]
      })
      .extend(() => ({}))

    // Factory was called once during .modules() invocation (plugin-build time)
    expect(callCount).toBe(1)
    // plugin.modules is already a plain array
    expect(Array.isArray(plugin.modules)).toBe(true)
  })
})

// ── Both options together in one plugin ───────────────────────────────────────

describe('Both options in one plugin — no collision', () => {
  test('Option B module alongside Option A factory module', async () => {
    // Option B: pre-built typed module
    const optionBModule = defineModule<BothCtx>('/both-b')
      .get('/', (ctx) => ctx.json({ foo: ctx.foo, bar: ctx.bar }))
      .build()

    // Plugin uses Option A factory but includes the Option B module
    const plugin = definePlugin<{ foo: string; bar: number }>('both-plugin')
      .modules((_ctx: BothCtx) => [
        optionBModule,
        defineModule<BothCtx>('/both-a')
          .get('/', (ctx) => ctx.json({ foo: ctx.foo, bar: ctx.bar }))
          .build(),
      ])
      .extend(() => ({ foo: 'combo', bar: 99 }))

    const app = createApp().plugin(plugin)

    const rb = await app.fetch(new Request('http://localhost/both-b'))
    expect(rb.status).toBe(200)
    const rb_json = await rb.json() as { foo: string; bar: number }
    expect(rb_json.foo).toBe('combo')
    expect(rb_json.bar).toBe(99)

    const ra = await app.fetch(new Request('http://localhost/both-a'))
    expect(ra.status).toBe(200)
    const ra_json = await ra.json() as { foo: string; bar: number }
    expect(ra_json.foo).toBe('combo')
    expect(ra_json.bar).toBe(99)
  })
})

// ── Backward compatibility ────────────────────────────────────────────────────

describe('Backward compatibility — existing array form unchanged', () => {
  test('existing .modules([...]) array form still works', async () => {
    const mod = defineModule('/compat')
      .get('/', (ctx) => ctx.json({ legacy: true }))
      .build()

    const plugin = definePlugin<object>('compat-plugin')
      .modules([mod])
      .extend(() => ({}))

    const app = createApp().plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/compat'))
    expect(res.status).toBe(200)
    expect((await res.json() as { legacy: boolean }).legacy).toBe(true)
  })

  test('plugin.modules is always a plain VelnModule[] (array or factory both produce array)', () => {
    const mod = defineModule('/arr').get('/', (ctx) => ctx.json({})).build()

    const arrayPlugin = definePlugin<object>('arr').modules([mod]).extend(() => ({}))
    const factoryPlugin = definePlugin<object>('fact')
      .modules((_ctx: BaseCtx) => [mod])
      .extend(() => ({}))

    // Both must produce a plain array on the plugin object
    expect(Array.isArray(arrayPlugin.modules)).toBe(true)
    expect(Array.isArray(factoryPlugin.modules)).toBe(true)
    expect(arrayPlugin.modules).toHaveLength(1)
    expect(factoryPlugin.modules).toHaveLength(1)
  })

  test('empty array form produces undefined modules (existing behaviour)', () => {
    const plugin = definePlugin<object>('empty').modules([]).extend(() => ({}))
    expect(plugin.modules).toBeUndefined()
  })
})
