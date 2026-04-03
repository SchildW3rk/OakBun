import { describe, test, expect, spyOn } from 'bun:test'
import { defineMiddleware } from '../../packages/core/src/app/middleware'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { createOnRequest, createOnResponse } from '../../packages/core/src/app/types'

// ── 1. MiddlewareDef structure ────────────────────────────────────────────────

describe('defineMiddleware — structure', () => {
  test('.onRequest(fn).build() → _onRequest set', () => {
    const fn = () => {}
    const m = defineMiddleware('test').onRequest(fn).build()
    expect(m._name).toBe('test')
    expect(m._onRequest).toBe(fn)
    expect(m._onResponse).toBeUndefined()
  })

  test('.onResponse(fn).build() → _onResponse set', () => {
    const fn = (_ctx: unknown, res: Response) => res
    const m = defineMiddleware('test').onResponse(fn).build()
    expect(m._onResponse).toBe(fn)
    expect(m._onRequest).toBeUndefined()
  })

  test('.onRequest(fn).onResponse(fn).build() → both set', () => {
    const reqFn = () => {}
    const resFn = (_ctx: unknown, res: Response) => res
    const m = defineMiddleware('test')
      .onRequest(reqFn)
      .onResponse(resFn)
      .build()
    expect(m._onRequest).toBe(reqFn)
    expect(m._onResponse).toBe(resFn)
  })

  test('_logger is always present', () => {
    const m = defineMiddleware('test').build()
    expect(m._logger).toBeDefined()
    expect(typeof m._logger.info).toBe('function')
  })

  test('name defaults logger scope to middleware:<name>', () => {
    const calls: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { calls.push(msg) })

    const m = defineMiddleware('scope-check')
      .options({ log: { level: 'debug' } })
      .build()

    m._logger.debug('hello')
    spy.mockRestore()
    expect(calls.some((c) => c.includes('middleware:scope-check'))).toBe(true)
  })
})

// ── 2. app.use(middleware) ────────────────────────────────────────────────────

describe('app.use(middleware) — global hooks', () => {
  test('onRequest hook fires for every route', async () => {
    const hits: string[] = []
    const m = defineMiddleware('track')
      .onRequest((ctx) => { hits.push(ctx.req.url) })
      .build()

    const app = createApp().use(m)
    app.get('/a', (ctx) => ctx.json({ ok: true }))
    app.get('/b', (ctx) => ctx.json({ ok: true }))

    await app.fetch(new Request('http://localhost/a'))
    await app.fetch(new Request('http://localhost/b'))
    expect(hits).toHaveLength(2)
  })

  test('onResponse hook fires and can modify response', async () => {
    const m = defineMiddleware('header')
      .onResponse((_ctx, res) => {
        const h = new Headers(res.headers)
        h.set('x-test', 'yes')
        return new Response(res.body, { status: res.status, headers: h })
      })
      .build()

    const app = createApp().use(m)
    app.get('/', (ctx) => ctx.json({ ok: true }))

    const res = await app.fetch(new Request('http://localhost/'))
    expect(res.headers.get('x-test')).toBe('yes')
  })

  test('onRequest can short-circuit with a Response', async () => {
    const m = defineMiddleware('blocker')
      .onRequest(() => new Response('blocked', { status: 403 }))
      .build()

    const app = createApp().use(m)
    app.get('/', (ctx) => ctx.json({ ok: true }))

    const res = await app.fetch(new Request('http://localhost/'))
    expect(res.status).toBe(403)
  })

  test('app.use(middleware) returns this for chaining', () => {
    const m = defineMiddleware('noop').build()
    const app = createApp()
    expect(app.use(m)).toBe(app)
  })
})

// ── 3. defineModule.use(middleware) — module-scoped ──────────────────────────

describe('defineModule(...).use(middleware) — module-scoped', () => {
  test('onRequest fires only for module routes', async () => {
    const hits: string[] = []
    const m = defineMiddleware('mod-track')
      .onRequest((ctx) => { hits.push(ctx.req.url) })
      .build()

    const mod = defineModule('/api')
      .use(m)
      .get('/x', (ctx) => ctx.json({ ok: true }))
      .build()

    const app = createApp()
    app.get('/outside', (ctx) => ctx.json({ ok: true }))
    app.register(mod)

    await app.fetch(new Request('http://localhost/outside'))
    await app.fetch(new Request('http://localhost/api/x'))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toContain('/api/x')
  })

  test('onResponse fires only for module routes', async () => {
    const m = defineMiddleware('mod-header')
      .onResponse((_ctx, res) => {
        const h = new Headers(res.headers)
        h.set('x-module', 'yes')
        return new Response(res.body, { status: res.status, headers: h })
      })
      .build()

    const mod = defineModule('/scoped').use(m).get('/', (ctx) => ctx.json({ ok: true })).build()
    const app = createApp()
    app.get('/outside', (ctx) => ctx.json({ ok: true }))
    app.register(mod)

    const scopedRes  = await app.fetch(new Request('http://localhost/scoped/'))
    const outsideRes = await app.fetch(new Request('http://localhost/outside'))
    expect(scopedRes.headers.get('x-module')).toBe('yes')
    expect(outsideRes.headers.get('x-module')).toBeNull()
  })
})

// ── 4. Logger options ─────────────────────────────────────────────────────────

describe('defineMiddleware — .options({ log })', () => {
  test('.options({ log: { silent: true } }) — no console output', () => {
    const spy = spyOn(console, 'log').mockImplementation(() => {})
    const m = defineMiddleware('silent')
      .options({ log: { silent: true } })
      .build()
    m._logger.info('should be silent')
    m._logger.debug('also silent')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test('.options({ log: { level: "debug" } }) — debug logs emitted', () => {
    const calls: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { calls.push(msg) })
    const m = defineMiddleware('verbose').options({ log: { level: 'debug' } }).build()
    m._logger.debug('dbg')
    spy.mockRestore()
    expect(calls.some((c) => c.includes('dbg'))).toBe(true)
  })
})

// ── 5. Backward compat ────────────────────────────────────────────────────────

describe('backward compat — createOnRequest / createOnResponse', () => {
  test('createOnRequest still works as app.onRequest()', async () => {
    const hits: number[] = []
    const hook = createOnRequest(() => { hits.push(1) })
    const app = createApp().onRequest(hook)
    app.get('/', (ctx) => ctx.json({ ok: true }))
    await app.fetch(new Request('http://localhost/'))
    expect(hits).toHaveLength(1)
  })

  test('createOnResponse still works as app.onResponse()', async () => {
    const hook = createOnResponse((_ctx, res) => {
      const h = new Headers(res.headers)
      h.set('x-compat', 'yes')
      return new Response(res.body, { status: res.status, headers: h })
    })
    const app = createApp().onResponse(hook)
    app.get('/', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(new Request('http://localhost/'))
    expect(res.headers.get('x-compat')).toBe('yes')
  })
})
