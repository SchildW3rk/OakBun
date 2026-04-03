import { describe, test, expect } from 'bun:test'
import { definePlugin } from '../../packages/core/src/app/plugin'
import { defineModule } from '../../packages/core/src/app/module'
import { createApp } from '../../packages/core/src/app/index'
import { VelnError } from '../../packages/core/src/errors/index'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeModule(prefix: string, body: Record<string, unknown> = { ok: true }) {
  return defineModule(prefix)
    .route({ method: 'GET', path: '/', handler: (ctx) => ctx.json(body) })
    .build()
}

// ── 1. Basic: plugin contributes a module ─────────────────────────────────────

describe('definePlugin — .modules()', () => {
  test('routes from .modules([mod]) are reachable', async () => {
    const mod = makeModule('/greet', { hello: 'world' })
    const plugin = definePlugin<{ x: number }>('with-routes')
      .modules([mod])
      .extend(() => ({ x: 1 }))

    const app = createApp().plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/greet'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ hello: 'world' })
  })

  test('plugin ctx-extension still works alongside .modules()', async () => {
    const mod = makeModule('/ping', { pong: true })
    const plugin = definePlugin<{ tag: string }>('combo')
      .modules([mod])
      .extend(() => ({ tag: 'test' }))

    const app = createApp().plugin(plugin)
    app.get('/tag', (ctx) => ctx.json({ tag: ctx.tag }))

    const pingRes = await app.fetch(new Request('http://localhost/ping'))
    expect((await pingRes.json() as { pong: boolean }).pong).toBe(true)

    const tagRes = await app.fetch(new Request('http://localhost/tag'))
    expect((await tagRes.json() as { tag: string }).tag).toBe('test')
  })

  test('plugin without .modules() — behaviour unchanged', async () => {
    const plugin = definePlugin<{ v: number }>('plain').extend(() => ({ v: 42 }))
    expect(plugin.modules).toBeUndefined()

    const app = createApp().plugin(plugin)
    app.get('/', (ctx) => ctx.json({ v: ctx.v }))
    const res = await app.fetch(new Request('http://localhost/'))
    expect((await res.json() as { v: number }).v).toBe(42)
  })

  test('plugin with empty .modules([]) — no error, modules undefined', () => {
    const plugin = definePlugin<object>('empty-mods').modules([]).extend(() => ({}))
    // Empty array → normalised to undefined so the field stays clean
    expect(plugin.modules).toBeUndefined()
  })

  test('two plugins each with their own modules — both route sets reachable', async () => {
    const modA = makeModule('/a', { from: 'a' })
    const modB = makeModule('/b', { from: 'b' })

    const pluginA = definePlugin<{ a: true }>('plugin-a').modules([modA]).extend(() => ({ a: true as const }))
    const pluginB = definePlugin<{ b: true }>('plugin-b').modules([modB]).extend(() => ({ b: true as const }))

    const app = createApp().plugin(pluginA).plugin(pluginB)

    const resA = await app.fetch(new Request('http://localhost/a'))
    expect((await resA.json() as { from: string }).from).toBe('a')

    const resB = await app.fetch(new Request('http://localhost/b'))
    expect((await resB.json() as { from: string }).from).toBe('b')
  })

  test('.modules() works with .build() as well as .extend()', async () => {
    const mod = makeModule('/built', { via: 'build' })
    const plugin = definePlugin<{ n: number }>('build-test')
      .modules([mod])
      .build({ request: () => ({ n: 7 }) })

    const app = createApp().plugin(plugin)
    const res = await app.fetch(new Request('http://localhost/built'))
    expect((await res.json() as { via: string }).via).toBe('build')
  })
})

// ── 2. Fail-fast: .requires() fails → modules NOT registered ─────────────────

describe('.requires() fail-fast with .modules()', () => {
  test('unsatisfied .requires() throws before modules are registered', () => {
    const mod = makeModule('/should-not-exist')
    const plugin = definePlugin<object>('needs-db')
      .requires(['db'])
      .modules([mod])
      .extend(() => ({}))

    const app = createApp()
    expect(() => app.plugin(plugin)).toThrow(VelnError)

    // Route must not be present — fetch should 404
    // (app.plugin threw, so register() was never called)
  })

  test('after .requires() failure the route is not mounted', async () => {
    const mod = makeModule('/secret')
    const plugin = definePlugin<object>('blocked')
      .requires(['missing-dep'])
      .modules([mod])
      .extend(() => ({}))

    const app = createApp()
    try { app.plugin(plugin) } catch { /* expected */ }

    const res = await app.fetch(new Request('http://localhost/secret'))
    expect(res.status).toBe(404)
  })
})

// ── 3. modules field on Plugin interface ─────────────────────────────────────

describe('Plugin.modules field', () => {
  test('plugin.modules contains the passed modules', () => {
    const modA = makeModule('/x')
    const modB = makeModule('/y')
    const plugin = definePlugin<object>('multi').modules([modA, modB]).extend(() => ({}))
    expect(plugin.modules).toHaveLength(2)
    expect(plugin.modules![0]).toBe(modA)
    expect(plugin.modules![1]).toBe(modB)
  })
})
