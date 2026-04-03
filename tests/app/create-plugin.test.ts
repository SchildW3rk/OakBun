import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { createPlugin } from '../../packages/core/src/app/plugin'

describe('createPlugin', () => {
  test('request() merged ctx — TAdd properties vorhanden', async () => {
    const plugin = createPlugin<{ count: number }>('test', {
      request: () => ({ count: 42 }),
    })

    const app = createApp().plugin(plugin())
    app.get('/x', (ctx) => ctx.json({ count: ctx.count }))

    const res = await app.fetch(new Request('http://localhost/x'))
    const body = await res.json() as { count: number }
    expect(body.count).toBe(42)
  })

  test('User schreibt keinen ...ctx spread', async () => {
    // Beweis: request() gibt nur { value: string } zurück, nicht { ...ctx, value: string }
    // Framework merged intern — ctx.json() funktioniert trotzdem im Handler
    const plugin = createPlugin<{ value: string }>('test', {
      request: () => ({ value: 'hello' }),
    })

    const app = createApp().plugin(plugin())
    app.get('/x', (ctx) => ctx.json({ v: ctx.value, ok: true }))

    const res = await app.fetch(new Request('http://localhost/x'))
    expect(res.status).toBe(200)
    const body = await res.json() as { v: string; ok: boolean }
    expect(body.v).toBe('hello')
    expect(body.ok).toBe(true)  // ctx.json still works = ctx was merged correctly
  })

  test('install() wird beim ersten fetch() aufgerufen', async () => {
    const installed: string[] = []
    const plugin = createPlugin<{ x: number }>('test', {
      install: () => { installed.push('installed') },
      request: () => ({ x: 1 }),
    })

    const app = createApp().plugin(plugin())
    app.get('/x', (ctx) => ctx.json({}))

    await app.fetch(new Request('http://localhost/x'))
    await app.fetch(new Request('http://localhost/x'))
    expect(installed).toHaveLength(1)  // einmalig
  })

  test('Plugin ohne install/teardown funktioniert', async () => {
    const plugin = createPlugin<{ n: number }>('test', {
      request: () => ({ n: 7 }),
    })
    const app = createApp().plugin(plugin())
    app.get('/x', (ctx) => ctx.json({ n: ctx.n }))
    const res = await app.fetch(new Request('http://localhost/x'))
    expect((await res.json() as { n: number }).n).toBe(7)
  })

  test('Zwei Plugins hintereinander: zweites sieht erstes', async () => {
    const p1 = createPlugin<{ a: string }>('p1', { request: () => ({ a: 'from-p1' }) })
    const p2 = createPlugin<{ b: string }>('p2', { request: (ctx) => ({ b: (ctx as any).a + '-plus' }) })

    const app = createApp().plugin(p1()).plugin(p2())
    app.get('/x', (ctx) => ctx.json({ a: ctx.a, b: ctx.b }))
    const res = await app.fetch(new Request('http://localhost/x'))
    const body = await res.json() as { a: string; b: string }
    expect(body.a).toBe('from-p1')
    expect(body.b).toBe('from-p1-plus')
  })

  test('request() wirft → onError aufgerufen, Handler nicht', async () => {
    const plugin = createPlugin<{ x: number }>('test', {
      request: () => { throw new Error('plugin error') },
    })
    let handlerCalled = false
    const app = createApp()
      .plugin(plugin())
      .onError((_err, ctx) => ctx.json({ error: 'caught' }, 500))
    app.get('/x', (_ctx) => { handlerCalled = true; return new Response('ok') })

    const res = await app.fetch(new Request('http://localhost/x'))
    expect(res.status).toBe(500)
    expect(handlerCalled).toBe(false)
  })
})
