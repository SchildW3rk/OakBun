import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { requestIdPlugin } from '../../packages/core/src/app/request-id'

function makeApp(options?: Parameters<typeof requestIdPlugin>[0]) {
  const app = createApp()
  const rid = requestIdPlugin(options)
  app.onRequest(rid.onRequest)
  app.onResponse(rid.onResponse)
  app.get('/hello', (ctx) => {
    const c = ctx as typeof ctx & { requestId: string }
    return ctx.json({ requestId: c.requestId })
  })
  return app
}

describe('requestIdPlugin — generation', () => {
  test('assigns requestId to ctx', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/hello'))
    const body = await res.json() as { requestId: string }
    expect(typeof body.requestId).toBe('string')
    expect(body.requestId.length).toBeGreaterThan(0)
  })

  test('default ID is 32 hex chars (16 bytes)', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/hello'))
    const body = await res.json() as { requestId: string }
    expect(body.requestId).toMatch(/^[0-9a-f]{32}$/)
  })

  test('each request gets a unique ID', async () => {
    const app = makeApp()
    const [r1, r2] = await Promise.all([
      app.fetch(new Request('http://localhost/hello')),
      app.fetch(new Request('http://localhost/hello')),
    ])
    const b1 = await r1.json() as { requestId: string }
    const b2 = await r2.json() as { requestId: string }
    expect(b1.requestId).not.toBe(b2.requestId)
  })

  test('custom generator is used', async () => {
    const app = makeApp({ generator: () => 'fixed-id' })
    const res = await app.fetch(new Request('http://localhost/hello'))
    const body = await res.json() as { requestId: string }
    expect(body.requestId).toBe('fixed-id')
  })
})

describe('requestIdPlugin — response header', () => {
  test('echoes requestId in x-request-id response header', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/hello'))
    const body = await res.json() as { requestId: string }
    expect(res.headers.get('x-request-id')).toBe(body.requestId)
  })

  test('custom responseHeader option', async () => {
    const app = makeApp({ responseHeader: 'x-trace-id' })
    const res = await app.fetch(new Request('http://localhost/hello'))
    expect(res.headers.get('x-trace-id')).toBeDefined()
    expect(res.headers.get('x-request-id')).toBeNull()
  })
})

describe('requestIdPlugin — incoming header passthrough', () => {
  test('reuses valid incoming x-request-id', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/hello', {
      headers: { 'x-request-id': 'my-trace-abc123' },
    }))
    const body = await res.json() as { requestId: string }
    expect(body.requestId).toBe('my-trace-abc123')
    expect(res.headers.get('x-request-id')).toBe('my-trace-abc123')
  })

  test('ignores incoming header with unsafe characters', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/hello', {
      headers: { 'x-request-id': '<script>alert(1)</script>' },
    }))
    const body = await res.json() as { requestId: string }
    // Should generate a fresh safe ID
    expect(body.requestId).toMatch(/^[0-9a-f]{32}$/)
  })

  test('ignores incoming header that is too long', async () => {
    const app = makeApp()
    const longId = 'a'.repeat(200)
    const res = await app.fetch(new Request('http://localhost/hello', {
      headers: { 'x-request-id': longId },
    }))
    const body = await res.json() as { requestId: string }
    expect(body.requestId).toMatch(/^[0-9a-f]{32}$/)
  })

  test('custom incomingHeader option', async () => {
    const app = makeApp({ incomingHeader: 'x-trace-id' })
    const res = await app.fetch(new Request('http://localhost/hello', {
      headers: { 'x-trace-id': 'my-custom-trace' },
    }))
    const body = await res.json() as { requestId: string }
    expect(body.requestId).toBe('my-custom-trace')
  })
})

describe('requestIdPlugin — cookie Secure default', () => {
  test('cookie.set without explicit secure defaults to Secure flag', async () => {
    const app = createApp()
    app.get('/set-cookie', (ctx) => {
      ctx.cookie.set('session', 'abc')
      return ctx.json({ ok: true })
    })
    const res = await app.fetch(new Request('http://localhost/set-cookie'))
    const setCookie = res.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain('Secure')
  })

  test('cookie.set with secure: false omits Secure flag', async () => {
    const app = createApp()
    app.get('/set-cookie', (ctx) => {
      ctx.cookie.set('session', 'abc', { secure: false })
      return ctx.json({ ok: true })
    })
    const res = await app.fetch(new Request('http://localhost/set-cookie'))
    const setCookie = res.headers.get('Set-Cookie') ?? ''
    expect(setCookie).not.toContain('Secure')
  })
})
