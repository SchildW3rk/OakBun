import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { healthPlugin } from '../../packages/core/src/app/health'

function makeApp(options?: Parameters<typeof healthPlugin>[0]) {
  const app    = createApp()
  const health = healthPlugin(options)
  app.onRequest(health.onRequest)
  app.get('/hello', (ctx) => ctx.json({ hello: true }))
  return app
}

// ── GET /health ───────────────────────────────────────────────────────────────

describe('healthPlugin — GET /health', () => {
  test('GET /health → 200', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/health'))
    expect(res.status).toBe(200)
  })

  test('GET /health → { status: "ok", uptime: number }', async () => {
    const app  = makeApp()
    const res  = await app.fetch(new Request('http://localhost/health'))
    const body = await res.json() as { status: string; uptime: number }
    expect(body.status).toBe('ok')
    expect(typeof body.uptime).toBe('number')
    expect(body.uptime).toBeGreaterThanOrEqual(0)
  })

  test('uptime is a non-negative number', async () => {
    const app  = makeApp()
    const res  = await app.fetch(new Request('http://localhost/health'))
    const body = await res.json() as { uptime: number }
    expect(body.uptime).toBeGreaterThan(0)
  })

  test('/health does not interfere with regular routes', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/hello'))
    expect(res.status).toBe(200)
    const body = await res.json() as { hello: boolean }
    expect(body.hello).toBe(true)
  })
})

// ── GET /ready ────────────────────────────────────────────────────────────────

describe('healthPlugin — GET /ready', () => {
  test('GET /ready with no checks → 200 { status: "ready", checks: {} }', async () => {
    const app  = makeApp()
    const res  = await app.fetch(new Request('http://localhost/ready'))
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; checks: Record<string, unknown> }
    expect(body.status).toBe('ready')
    expect(body.checks).toEqual({})
  })

  test('GET /ready with passing check → 200', async () => {
    const app = makeApp({
      checks: {
        db: async () => ({ ok: true }),
      },
    })
    const res  = await app.fetch(new Request('http://localhost/ready'))
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; checks: Record<string, { ok: boolean }> }
    expect(body.status).toBe('ready')
    expect(body.checks.db?.ok).toBe(true)
  })

  test('GET /ready with failing check → 503', async () => {
    const app = makeApp({
      checks: {
        db: async () => ({ ok: false }),
      },
    })
    const res  = await app.fetch(new Request('http://localhost/ready'))
    expect(res.status).toBe(503)
    const body = await res.json() as { status: string; checks: Record<string, { ok: boolean }> }
    expect(body.status).toBe('not_ready')
    expect(body.checks.db?.ok).toBe(false)
  })

  test('GET /ready with mixed checks (one fail) → 503', async () => {
    const app = makeApp({
      checks: {
        db:    async () => ({ ok: true }),
        cache: async () => ({ ok: false }),
      },
    })
    const res  = await app.fetch(new Request('http://localhost/ready'))
    expect(res.status).toBe(503)
    const body = await res.json() as { status: string; checks: Record<string, { ok: boolean }> }
    expect(body.status).toBe('not_ready')
    expect(body.checks.db?.ok).toBe(true)
    expect(body.checks.cache?.ok).toBe(false)
  })

  test('GET /ready with throwing check → 503 with error message', async () => {
    const app = makeApp({
      checks: {
        db: async () => { throw new Error('DB connection failed') },
      },
    })
    const res  = await app.fetch(new Request('http://localhost/ready'))
    expect(res.status).toBe(503)
    const body = await res.json() as { status: string; checks: Record<string, { ok: boolean; error?: string }> }
    expect(body.status).toBe('not_ready')
    expect(body.checks.db?.ok).toBe(false)
    expect(body.checks.db?.error).toContain('DB connection failed')
  })
})

// ── Custom paths ──────────────────────────────────────────────────────────────

describe('healthPlugin — custom paths', () => {
  test('custom path → works at custom path', async () => {
    const app = makeApp({ path: '/ping', readyPath: '/ping/ready' })
    const res = await app.fetch(new Request('http://localhost/ping'))
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string }
    expect(body.status).toBe('ok')
  })

  test('default /health not available when custom path set', async () => {
    const app = makeApp({ path: '/ping' })
    const res = await app.fetch(new Request('http://localhost/health'))
    // /health route not registered by plugin or app → 404
    expect(res.status).toBe(404)
  })

  test('custom readyPath works', async () => {
    const app = makeApp({ readyPath: '/healthz/ready' })
    const res = await app.fetch(new Request('http://localhost/healthz/ready'))
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string }
    expect(body.status).toBe('ready')
  })
})

// ── Uptime increases ──────────────────────────────────────────────────────────

describe('healthPlugin — uptime', () => {
  test('uptime increases between calls', async () => {
    const app = makeApp()

    const res1  = await app.fetch(new Request('http://localhost/health'))
    const body1 = await res1.json() as { uptime: number }
    const t1    = body1.uptime

    // Wait 10ms and check uptime increased
    await new Promise((r) => setTimeout(r, 10))

    const res2  = await app.fetch(new Request('http://localhost/health'))
    const body2 = await res2.json() as { uptime: number }
    const t2    = body2.uptime

    expect(t2).toBeGreaterThan(t1)
  })
})
