import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { bodySizeLimitPlugin } from '../../packages/core/src/app/body-size-limit'

function makeApp(maxSize?: number) {
  const app = createApp()
  app.onRequest(bodySizeLimitPlugin(maxSize !== undefined ? { maxSize } : {}))
  app.post('/upload', (ctx) => ctx.json({ ok: true }))
  app.get('/ok',      (ctx) => ctx.json({ ok: true }))
  return app
}

function postWithSize(bytes: number, path = '/upload'): Request {
  return new Request(`http://localhost${path}`, {
    method:  'POST',
    headers: { 'Content-Length': String(bytes), 'Content-Type': 'application/json' },
    body:    '{}',
  })
}

// ── 1. Under limit ─────────────────────────────────────────────────────────────

describe('bodySizeLimitPlugin — under limit', () => {
  test('request within default 1MB → 200', async () => {
    const app = makeApp()
    const res = await app.fetch(postWithSize(512_000))
    expect(res.status).toBe(200)
  })

  test('request exactly at limit → 200', async () => {
    const app = makeApp(1000)
    const res = await app.fetch(postWithSize(1000))
    expect(res.status).toBe(200)
  })

  test('GET without body → never blocked', async () => {
    const app = makeApp(1)
    const res = await app.fetch(new Request('http://localhost/ok'))
    expect(res.status).toBe(200)
  })
})

// ── 2. Over limit → 413 ───────────────────────────────────────────────────────

describe('bodySizeLimitPlugin — over limit', () => {
  test('request over default 1MB → 413', async () => {
    const app = makeApp()
    const res = await app.fetch(postWithSize(2_000_000))
    expect(res.status).toBe(413)
  })

  test('custom maxSize respected', async () => {
    const app = makeApp(500)
    const res = await app.fetch(postWithSize(501))
    expect(res.status).toBe(413)
  })

  test('413 body has PAYLOAD_TOO_LARGE code', async () => {
    const app = makeApp(100)
    const res  = await app.fetch(postWithSize(200))
    const body = await res.json() as { code: string }
    expect(body.code).toBe('PAYLOAD_TOO_LARGE')
  })

  test('custom message in 413 body', async () => {
    const app = createApp()
    app.onRequest(bodySizeLimitPlugin({ maxSize: 100, message: 'File too big' }))
    app.post('/up', (ctx) => ctx.json({ ok: true }))
    const res  = await app.fetch(postWithSize(200, '/up'))
    const body = await res.json() as { message: string }
    expect(body.message).toBe('File too big')
  })

  test('413 Content-Type is application/json', async () => {
    const app = makeApp(100)
    const res = await app.fetch(postWithSize(200))
    expect(res.headers.get('Content-Type')).toContain('application/json')
  })
})

// ── 3. Edge cases ──────────────────────────────────────────────────────────────

describe('bodySizeLimitPlugin — edge cases', () => {
  test('no Content-Length header → passes through', async () => {
    const app = makeApp(1)
    const res = await app.fetch(new Request('http://localhost/upload', {
      method: 'POST',
      body:   '{}',
      // no Content-Length header
    }))
    expect(res.status).toBe(200)
  })

  test('invalid Content-Length → passes through', async () => {
    const app = makeApp(100)
    const res = await app.fetch(new Request('http://localhost/upload', {
      method:  'POST',
      headers: { 'Content-Length': 'not-a-number' },
      body:    '{}',
    }))
    expect(res.status).toBe(200)
  })
})

// ── 4. Module-scoped ──────────────────────────────────────────────────────────

describe('bodySizeLimitPlugin — module-scoped', () => {
  test('limit applies only to module routes', async () => {
    const app = createApp()
    app.post('/public', (ctx) => ctx.json({ ok: true }))

    const mod = defineModule('/api')
      .onRequest(bodySizeLimitPlugin({ maxSize: 100 }))
      .post('/upload', (ctx) => ctx.json({ ok: true }))
      .build()
    app.register(mod)

    // Module route: blocked
    const blocked = await app.fetch(postWithSize(200, '/api/upload'))
    expect(blocked.status).toBe(413)

    // Public route: not affected
    const ok = await app.fetch(postWithSize(200, '/public'))
    expect(ok.status).toBe(200)
  })
})
