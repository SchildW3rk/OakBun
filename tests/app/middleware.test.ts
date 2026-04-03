import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { createOnRequest, createOnBeforeHandle, createOnResponse } from '../../packages/core/src/app/types'
import { createPlugin } from '../../packages/core/src/app/plugin'

describe('onRequest', () => {

  test('runs and continues — void return', async () => {
    let called = false
    const app = createApp()
    app.onRequest(createOnRequest((_ctx) => { called = true }))
    app.get('/x', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(new Request('http://localhost/x'))
    expect(res.status).toBe(200)
    expect(called).toBe(true)
  })

  test('short-circuits — returns Response', async () => {
    let handlerCalled = false
    const app = createApp()
    app.onRequest(createOnRequest((_ctx) => new Response('blocked', { status: 403 })))
    app.get('/x', (_ctx) => { handlerCalled = true; return new Response('ok') })
    const res = await app.fetch(new Request('http://localhost/x'))
    expect(res.status).toBe(403)
    expect(handlerCalled).toBe(false)
  })

  test('runs even when guard returns 401', async () => {
    let onRequestCalled = false
    const app = createApp()
    app.onRequest(createOnRequest((_ctx) => { onRequestCalled = true }))
    const mod = defineModule('')
      .guard((_ctx) => new Response('Unauthorized', { status: 401 }))
      .get('/guarded', (ctx) => ctx.json({ ok: true }))
      .build()
    app.register(mod)
    const res = await app.fetch(new Request('http://localhost/guarded'))
    expect(res.status).toBe(401)
    expect(onRequestCalled).toBe(true)
  })

  test('runs even when plugin throws', async () => {
    let onRequestCalled = false
    const app = createApp()
    app.onRequest(createOnRequest((_ctx) => { onRequestCalled = true }))
    app.plugin({
      name: 'throwing',
      request: () => { throw new Error('plugin error') },
    })
    app.onError((_err, ctx) => ctx.json({ error: true }, 500))
    app.get('/x', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(new Request('http://localhost/x'))
    expect(res.status).toBe(500)
    expect(onRequestCalled).toBe(true)
  })

  test('registration order preserved — A before B', async () => {
    const order: string[] = []
    const app = createApp()
    app.onRequest(createOnRequest((_ctx) => { order.push('A') }))
    app.onRequest(createOnRequest((_ctx) => { order.push('B') }))
    app.get('/x', (ctx) => ctx.json({ ok: true }))
    await app.fetch(new Request('http://localhost/x'))
    expect(order).toEqual(['A', 'B'])
  })

  test('app-level runs for all routes', async () => {
    const called: string[] = []
    const app = createApp()
    app.onRequest(createOnRequest((_ctx) => { called.push('app') }))
    app.get('/a', (ctx) => ctx.json({}))
    app.get('/b', (ctx) => ctx.json({}))
    await app.fetch(new Request('http://localhost/a'))
    await app.fetch(new Request('http://localhost/b'))
    expect(called).toEqual(['app', 'app'])
  })

  test('module-level runs only for that module', async () => {
    const called: string[] = []
    const mod = defineModule('/api')
      .onRequest(createOnRequest((_ctx) => { called.push('module') }))
      .get('/x', (ctx) => ctx.json({}))
      .build()
    const app = createApp()
    app.get('/global', (ctx) => ctx.json({}))
    app.register(mod)

    await app.fetch(new Request('http://localhost/global'))
    expect(called).toHaveLength(0)

    await app.fetch(new Request('http://localhost/api/x'))
    expect(called).toHaveLength(1)
  })

})

describe('onBeforeHandle', () => {

  test('runs when guards pass', async () => {
    let called = false
    const app = createApp()
    app.onBeforeHandle(createOnBeforeHandle((_ctx) => { called = true }))
    app.get('/x', (ctx) => ctx.json({ ok: true }))
    await app.fetch(new Request('http://localhost/x'))
    expect(called).toBe(true)
  })

  test('does NOT run when guard blocks', async () => {
    let called = false
    const app = createApp()
    app.onBeforeHandle(createOnBeforeHandle((_ctx) => { called = true }))
    const mod = defineModule('')
      .guard((_ctx) => new Response('Unauthorized', { status: 401 }))
      .get('/guarded', (ctx) => ctx.json({ ok: true }))
      .build()
    app.register(mod)
    const res = await app.fetch(new Request('http://localhost/guarded'))
    expect(res.status).toBe(401)
    expect(called).toBe(false)
  })

  test('short-circuits — returns Response, handler not called', async () => {
    let handlerCalled = false
    const app = createApp()
    app.onBeforeHandle(createOnBeforeHandle((_ctx) => new Response('pre-blocked', { status: 400 })))
    app.get('/x', (_ctx) => { handlerCalled = true; return new Response('ok') })
    const res = await app.fetch(new Request('http://localhost/x'))
    expect(res.status).toBe(400)
    expect(handlerCalled).toBe(false)
  })

  test('module-level runs only for that module', async () => {
    const called: string[] = []
    const mod = defineModule('/api')
      .onBeforeHandle(createOnBeforeHandle((_ctx) => { called.push('module') }))
      .get('/x', (ctx) => ctx.json({}))
      .build()
    const app = createApp()
    app.get('/global', (ctx) => ctx.json({}))
    app.register(mod)

    await app.fetch(new Request('http://localhost/global'))
    expect(called).toHaveLength(0)

    await app.fetch(new Request('http://localhost/api/x'))
    expect(called).toHaveLength(1)
  })

  test('has access to full ctx (plugin extensions)', async () => {
    const plugin = createPlugin<{ extra: string }>('test', {
      request: () => ({ extra: 'from-plugin' }),
    })
    let captured = ''
    const app = createApp().plugin(plugin())
    app.onBeforeHandle(createOnBeforeHandle<{ extra: string }>((ctx) => {
      captured = ctx.extra
    }))
    app.get('/x', (ctx) => ctx.json({}))
    await app.fetch(new Request('http://localhost/x'))
    expect(captured).toBe('from-plugin')
  })

})

describe('onResponse', () => {

  test('always runs — happy path', async () => {
    let called = false
    const app = createApp()
    app.onResponse(createOnResponse((_ctx, _res) => { called = true }))
    app.get('/x', (ctx) => ctx.json({ ok: true }))
    await app.fetch(new Request('http://localhost/x'))
    expect(called).toBe(true)
  })

  test('runs even when handler throws', async () => {
    let onResponseCalled = false
    const app = createApp()
    app.onError((_err, ctx) => ctx.json({ error: true }, 500))
    app.onResponse(createOnResponse((_ctx, _res) => { onResponseCalled = true }))
    app.get('/x', (_ctx) => { throw new Error('boom') })
    const res = await app.fetch(new Request('http://localhost/x'))
    expect(res.status).toBe(500)
    expect(onResponseCalled).toBe(true)
  })

  test('runs even when guard blocks', async () => {
    let onResponseCalled = false
    const app = createApp()
    app.onResponse(createOnResponse((_ctx, _res) => { onResponseCalled = true }))
    const mod = defineModule('')
      .guard((_ctx) => new Response('Unauthorized', { status: 401 }))
      .get('/guarded', (ctx) => ctx.json({ ok: true }))
      .build()
    app.register(mod)
    const res = await app.fetch(new Request('http://localhost/guarded'))
    expect(res.status).toBe(401)
    expect(onResponseCalled).toBe(true)
  })

  test('can replace response — add header', async () => {
    const app = createApp()
    app.onResponse(createOnResponse((_ctx, res) => {
      const headers = new Headers(res.headers)
      headers.set('x-custom', 'hello')
      return new Response(res.body, { status: res.status, headers })
    }))
    app.get('/x', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(new Request('http://localhost/x'))
    expect(res.headers.get('x-custom')).toBe('hello')
  })

  test('void return keeps original response', async () => {
    const app = createApp()
    app.onResponse(createOnResponse((_ctx, _res) => { /* void */ }))
    app.get('/x', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(new Request('http://localhost/x'))
    expect(res.status).toBe(200)
  })

  test('module-level runs only for that module', async () => {
    const called: string[] = []
    const mod = defineModule('/api')
      .onResponse(createOnResponse((_ctx, _res) => { called.push('module') }))
      .get('/x', (ctx) => ctx.json({}))
      .build()
    const app = createApp()
    app.get('/global', (ctx) => ctx.json({}))
    app.register(mod)

    await app.fetch(new Request('http://localhost/global'))
    expect(called).toHaveLength(0)

    await app.fetch(new Request('http://localhost/api/x'))
    expect(called).toHaveLength(1)
  })

})

describe('lifecycle phase order', () => {

  test('strict order: onRequest → plugins → guards → onBeforeHandle → handler → onResponse', async () => {
    const order: string[] = []
    const plugin = createPlugin<{ pluginRan: true }>('order-test', {
      request: () => { order.push('plugin'); return { pluginRan: true as const } },
    })
    const app = createApp().plugin(plugin())
    app.onRequest(createOnRequest((_ctx) => { order.push('onRequest') }))
    app.onBeforeHandle(createOnBeforeHandle((_ctx) => { order.push('onBeforeHandle') }))
    app.onResponse(createOnResponse((_ctx, _res) => { order.push('onResponse') }))
    const mod = defineModule('')
      .guard((_ctx) => { order.push('guard'); return null })
      .get('/x', (_ctx) => { order.push('handler'); return new Response('ok') })
      .build()
    app.register(mod)

    await app.fetch(new Request('http://localhost/x'))

    expect(order).toEqual(['onRequest', 'plugin', 'guard', 'onBeforeHandle', 'handler', 'onResponse'])
  })

})
