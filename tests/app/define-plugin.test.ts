import { describe, test, expect, spyOn } from 'bun:test'
import { definePlugin } from '../../packages/core/src/app/plugin'
import { createPlugin } from '../../packages/core/src/app/plugin'
import { createApp } from '../../packages/core/src/app/index'

// ── 1. Structure ──────────────────────────────────────────────────────────────

describe('definePlugin — structure', () => {
  test('.extend(fn) returns a Plugin object (not a factory)', () => {
    const p = definePlugin<{ x: number }>('test').extend(() => ({ x: 1 }))
    expect(typeof p).toBe('object')
    expect(p.name).toBe('test')
    expect(typeof p.request).toBe('function')
  })

  test('.build({ request }) returns a Plugin object', () => {
    const p = definePlugin<{ x: number }>('test').build({ request: () => ({ x: 1 }) })
    expect(typeof p).toBe('object')
    expect(p.name).toBe('test')
  })

  test('.requires(deps) sets requires on the Plugin', () => {
    const p = definePlugin('test').requires(['db', 'logger']).extend(() => ({}))
    expect(p.requires).toEqual(['db', 'logger'])
  })

  test('no .requires() → requires is undefined', () => {
    const p = definePlugin('test').extend(() => ({}))
    expect(p.requires).toBeUndefined()
  })

  test('install/teardown undefined on .extend()', () => {
    const p = definePlugin('test').extend(() => ({}))
    expect(p.install).toBeUndefined()
    expect(p.teardown).toBeUndefined()
  })

  test('.build() forwards install and teardown', () => {
    const installFn  = () => {}
    const teardownFn = () => {}
    const p = definePlugin('test').build({
      install:  installFn,
      request:  () => ({}),
      teardown: teardownFn,
    })
    expect(p.install).toBe(installFn)
    expect(p.teardown).toBe(teardownFn)
  })
})

// ── 2. app.plugin(definePlugin result) — no () ────────────────────────────────

describe('app.plugin(plugin) — direct (no factory call)', () => {
  test('.extend(fn) — ctx additions available in handler', async () => {
    const p = definePlugin<{ score: number }>('score').extend(() => ({ score: 99 }))
    const app = createApp().plugin(p)
    app.get('/', (ctx) => ctx.json({ score: ctx.score }))
    const res = await app.fetch(new Request('http://localhost/'))
    expect((await res.json() as { score: number }).score).toBe(99)
  })

  test('.extend(fn) — second plugin sees first', async () => {
    const p1 = definePlugin<{ a: string }>('p1').extend(() => ({ a: 'from-p1' }))
    const p2 = definePlugin<{ b: string }>('p2').extend((ctx) => ({ b: (ctx as { a?: string }).a + '-ok' }))
    const app = createApp().plugin(p1).plugin(p2)
    app.get('/', (ctx) => ctx.json({ a: ctx.a, b: ctx.b }))
    const res = await app.fetch(new Request('http://localhost/'))
    const body = await res.json() as { a: string; b: string }
    expect(body.a).toBe('from-p1')
    expect(body.b).toBe('from-p1-ok')
  })

  test('.build({ install, request }) — install called once', async () => {
    const calls: string[] = []
    const p = definePlugin<{ n: number }>('test').build({
      install:  () => { calls.push('installed') },
      request:  () => ({ n: 1 }),
    })
    const app = createApp().plugin(p)
    app.get('/', (ctx) => ctx.json({ n: ctx.n }))
    await app.fetch(new Request('http://localhost/'))
    await app.fetch(new Request('http://localhost/'))
    expect(calls).toHaveLength(1)
  })

  test('request() throws → onError called, handler skipped', async () => {
    const p = definePlugin<{ x: number }>('broken').extend(() => { throw new Error('plugin error') })
    let handlerCalled = false
    const app = createApp()
      .plugin(p)
      .onError((_err, ctx) => ctx.json({ error: 'caught' }, 500))
    app.get('/', () => { handlerCalled = true; return new Response('ok') })
    const res = await app.fetch(new Request('http://localhost/'))
    expect(res.status).toBe(500)
    expect(handlerCalled).toBe(false)
  })
})

// ── 3. Logger options ─────────────────────────────────────────────────────────

describe('definePlugin — .options({ log })', () => {
  test('.options({ log: { level: "debug" } }) — scope is plugin:<name>', () => {
    const calls: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { calls.push(msg) })

    const p = definePlugin<{ v: number }>('scope-test')
      .options({ log: { level: 'debug' } })
      .extend(() => ({ v: 1 }))

    void p.request({ req: new Request('http://localhost/') } as Parameters<typeof p.request>[0])
    spy.mockRestore()

    expect(calls.some((c) => c.includes('plugin:scope-test'))).toBe(true)
  })

  test('.options({ log: { silent: true } }) — no console output', async () => {
    const spy = spyOn(console, 'log').mockImplementation(() => {})

    const p = definePlugin<{ v: number }>('silent')
      .options({ log: { silent: true } })
      .extend(() => ({ v: 1 }))

    await p.request({ req: new Request('http://localhost/') } as Parameters<typeof p.request>[0])
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

// ── 4. Backward compat — createPlugin ─────────────────────────────────────────

describe('backward compat — createPlugin', () => {
  test('createPlugin(name, { request })() still works', async () => {
    const plugin = createPlugin<{ val: string }>('compat', { request: () => ({ val: 'ok' }) })
    const app = createApp().plugin(plugin())
    app.get('/', (ctx) => ctx.json({ val: ctx.val }))
    const res = await app.fetch(new Request('http://localhost/'))
    expect((await res.json() as { val: string }).val).toBe('ok')
  })

  test('createPlugin with install fires once', async () => {
    const hits: number[] = []
    const plugin = createPlugin<{ x: number }>('compat-install', {
      install:  () => { hits.push(1) },
      request:  () => ({ x: 7 }),
    })
    const app = createApp().plugin(plugin())
    app.get('/', (ctx) => ctx.json({ x: ctx.x }))
    await app.fetch(new Request('http://localhost/'))
    await app.fetch(new Request('http://localhost/'))
    expect(hits).toHaveLength(1)
  })
})
