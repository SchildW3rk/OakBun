import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { secureHeadersPlugin } from '../../packages/core/src/app/secure-headers'

// ── Helpers ────────────────────────────────────────────────────────────────────

async function cspHeader(csp: Parameters<typeof secureHeadersPlugin>[0]['contentSecurityPolicy']): Promise<string | null> {
  const app = createApp()
  app.onResponse(secureHeadersPlugin({ contentSecurityPolicy: csp }))
  app.get('/ok', (ctx) => ctx.json({ ok: true }))
  const res = await app.fetch(new Request('http://localhost/ok'))
  return res.headers.get('Content-Security-Policy')
}

// ── CSP presets ────────────────────────────────────────────────────────────────

describe('secureHeadersPlugin — CSP presets', () => {
  test('csp: "strict" — no unsafe-inline in header', async () => {
    const value = await cspHeader('strict')
    expect(value).not.toBeNull()
    expect(value).not.toContain('unsafe-inline')
    expect(value).toContain("script-src 'self'")
    expect(value).toContain("frame-ancestors 'none'")
  })

  test('csp: "relaxed" — unsafe-inline present (default behaviour)', async () => {
    const value = await cspHeader('relaxed')
    expect(value).not.toBeNull()
    expect(value).toContain('unsafe-inline')
  })

  test('csp: false — no Content-Security-Policy header', async () => {
    const value = await cspHeader(false)
    expect(value).toBeNull()
  })

  test('csp: custom string — raw value passed through', async () => {
    const custom = "default-src 'none'; script-src cdn.example.com"
    const value = await cspHeader(custom)
    expect(value).toBe(custom)
  })

  test('default (no option) — relaxed CSP applied', async () => {
    // Omitting contentSecurityPolicy entirely must default to relaxed
    const value = await cspHeader(undefined)
    expect(value).not.toBeNull()
    expect(value).toContain('unsafe-inline')
  })
})

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeApp() {
  const app = createApp()
  app.onResponse(secureHeadersPlugin())
  app.get('/ok', (ctx) => ctx.json({ ok: true }))
  return app
}

// ── 1. Default headers ─────────────────────────────────────────────────────────

describe('secureHeadersPlugin — defaults', () => {
  test('sets Strict-Transport-Security', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/ok'))
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=15552000; includeSubDomains')
  })

  test('sets X-Content-Type-Options: nosniff', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/ok'))
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  test('sets X-Frame-Options: SAMEORIGIN', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/ok'))
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
  })

  test('sets X-XSS-Protection: 0', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/ok'))
    expect(res.headers.get('X-XSS-Protection')).toBe('0')
  })

  test('sets Referrer-Policy', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/ok'))
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
  })

  test('sets Permissions-Policy', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/ok'))
    expect(res.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()')
  })

  test('sets Content-Security-Policy with permissive default', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/ok'))
    const csp = res.headers.get('Content-Security-Policy')
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("img-src 'self' data: https:")
  })

  test('preserves original status code', async () => {
    const app = createApp()
    app.onResponse(secureHeadersPlugin())
    app.post('/things', (ctx) => ctx.json({ id: 1 }, 201))
    const res = await app.fetch(new Request('http://localhost/things', { method: 'POST' }))
    expect(res.status).toBe(201)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})

// ── 2. Custom overrides ────────────────────────────────────────────────────────

describe('secureHeadersPlugin — custom overrides', () => {
  test('custom string overrides default value', async () => {
    const app = createApp()
    app.onResponse(secureHeadersPlugin({ xFrameOptions: 'DENY' }))
    app.get('/ok', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(new Request('http://localhost/ok'))
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
  })

  test('false omits the header entirely', async () => {
    const app = createApp()
    app.onResponse(secureHeadersPlugin({ contentSecurityPolicy: false }))
    app.get('/ok', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(new Request('http://localhost/ok'))
    expect(res.headers.get('Content-Security-Policy')).toBeNull()
  })

  test('false on one header leaves others intact', async () => {
    const app = createApp()
    app.onResponse(secureHeadersPlugin({ xFrameOptions: false }))
    app.get('/ok', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(new Request('http://localhost/ok'))
    expect(res.headers.get('X-Frame-Options')).toBeNull()
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  test('multiple overrides apply independently', async () => {
    const app = createApp()
    app.onResponse(secureHeadersPlugin({
      xFrameOptions: 'DENY',
      contentSecurityPolicy: "default-src 'none'",
      xXssProtection: false,
    }))
    app.get('/ok', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(new Request('http://localhost/ok'))
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'")
    expect(res.headers.get('X-XSS-Protection')).toBeNull()
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})

// ── 3. Runs on all response paths ─────────────────────────────────────────────

describe('secureHeadersPlugin — all response paths', () => {
  test('applies to 404 responses', async () => {
    const app = createApp()
    app.onResponse(secureHeadersPlugin())
    const res = await app.fetch(new Request('http://localhost/not-found'))
    expect(res.status).toBe(404)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  test('applies when guard blocks with 401', async () => {
    const app = createApp()
    app.onResponse(secureHeadersPlugin())
    const mod = defineModule('/protected')
      .guard(() => new Response('Unauthorized', { status: 401 }))
      .get('/', (ctx) => ctx.json({ ok: true }))
      .build()
    app.register(mod)
    const res = await app.fetch(new Request('http://localhost/protected/'))
    expect(res.status).toBe(401)
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
  })

  test('applies even when handler throws', async () => {
    const app = createApp()
    app.onResponse(secureHeadersPlugin())
    app.get('/boom', () => { throw new Error('oops') })
    const res = await app.fetch(new Request('http://localhost/boom'))
    expect(res.status).toBe(500)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  test('does not overwrite existing headers set by handler', async () => {
    // secureHeadersPlugin respects headers already set by the handler —
    // allows per-route overrides (e.g. a looser CSP for a docs route)
    const app = createApp()
    app.onResponse(secureHeadersPlugin())
    app.get('/ok', (_ctx) => new Response('ok', {
      headers: { 'X-Frame-Options': 'ALLOW-FROM https://example.com' },
    }))
    const res = await app.fetch(new Request('http://localhost/ok'))
    // Handler wins — plugin does not overwrite pre-existing values
    expect(res.headers.get('X-Frame-Options')).toBe('ALLOW-FROM https://example.com')
  })
})

// ── 4. Module-scoped usage ─────────────────────────────────────────────────────

describe('secureHeadersPlugin — module-scoped', () => {
  test('works as module-level onResponse hook', async () => {
    const { createOnResponse } = await import('../../packages/core/src/app/types')
    const app = createApp()
    app.get('/public', (ctx) => ctx.json({ public: true }))

    // Apply secureHeadersPlugin only to /api routes via module onResponse
    const mod = defineModule('/api')
      .onResponse(secureHeadersPlugin())
      .get('/data', (ctx) => ctx.json({ data: true }))
      .build()
    app.register(mod)

    const apiRes = await app.fetch(new Request('http://localhost/api/data'))
    expect(apiRes.headers.get('X-Content-Type-Options')).toBe('nosniff')

    const publicRes = await app.fetch(new Request('http://localhost/public'))
    expect(publicRes.headers.get('X-Content-Type-Options')).toBeNull()
  })
})

// ── 5. No options (empty call) ─────────────────────────────────────────────────

describe('secureHeadersPlugin — empty options', () => {
  test('secureHeadersPlugin() with no args uses all defaults', async () => {
    const app = createApp()
    app.onResponse(secureHeadersPlugin())
    app.get('/ok', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(new Request('http://localhost/ok'))
    expect(res.headers.get('Strict-Transport-Security')).toBeTruthy()
    expect(res.headers.get('X-Frame-Options')).toBeTruthy()
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy()
  })
})
