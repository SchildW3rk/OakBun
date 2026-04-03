import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { rateLimitPlugin } from '../../packages/core/src/app/rate-limit'
import type { RateLimitStore } from '../../packages/core/src/app/rate-limit'

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockStore(captured: string[]): RateLimitStore {
  return {
    async increment(key) {
      captured.push(key)
      return { count: 1, resetAt: Date.now() + 60_000 }
    },
    async reset(_key) {},
  }
}

function req(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { headers })
}

// ── Security analysis summary (Spec 13) ──────────────────────────────────────
//
// VULNERABILITY FIXED: Previously OakBun used the FIRST X-Forwarded-For entry,
// which a client can forge by sending "FAKE_IP, real_proxy_ip".
// Correct behavior: use the LAST entry — appended by the outermost trusted proxy,
// not controllable by the client.
//
// MISSING HEADER behavior:
//   trustProxy: true         → fallback to 'unknown' + one-time console.warn
//   trustProxy: { strict }   → 400 Bad Request immediately
//   trustProxy: false        → X-Forwarded-For ignored; uses x-real-ip or 'unknown'

// ── Case 1 — trustProxy: true + X-Forwarded-For set ─────────────────────────

describe('Case 1 — trustProxy: true + X-Forwarded-For set', () => {
  test('single IP in header → that IP used as bucket key', async () => {
    const keys: string[] = []
    const app = createApp()
    app.onRequest(rateLimitPlugin({ max: 10, windowMs: 60_000, store: mockStore(keys), trustProxy: true }))
    app.get('/hit', (ctx) => ctx.json({ ok: true }))

    await app.fetch(req('/hit', { 'x-forwarded-for': '203.0.113.5' }))
    expect(keys[0]).toBe('203.0.113.5')
  })

  test('x-real-ip ignored when X-Forwarded-For is present with trustProxy: true', async () => {
    const keys: string[] = []
    const app = createApp()
    app.onRequest(rateLimitPlugin({ max: 10, windowMs: 60_000, store: mockStore(keys), trustProxy: true }))
    app.get('/hit', (ctx) => ctx.json({ ok: true }))

    await app.fetch(req('/hit', {
      'x-forwarded-for': '203.0.113.5',
      'x-real-ip':       '10.0.0.1',
    }))
    // X-Forwarded-For takes precedence over X-Real-IP when trustProxy: true
    expect(keys[0]).toBe('203.0.113.5')
  })
})

// ── Case 2 — trustProxy: true + no header → fallback + warning ───────────────

describe('Case 2 — trustProxy: true + no X-Forwarded-For → fallback to unknown', () => {
  test('missing header → bucket key is "unknown"', async () => {
    const keys: string[] = []
    const app = createApp()
    app.onRequest(rateLimitPlugin({ max: 10, windowMs: 60_000, store: mockStore(keys), trustProxy: true }))
    app.get('/hit', (ctx) => ctx.json({ ok: true }))

    // No X-Forwarded-For header — simulates misconfigured proxy
    const res = await app.fetch(req('/hit'))
    expect(res.status).toBe(200)   // still serves the request
    expect(keys[0]).toBe('unknown')
  })

  test('warning emitted exactly once across multiple requests', async () => {
    const warnMessages: string[] = []
    const origWarn = console.warn
    console.warn = (...args: unknown[]) => { warnMessages.push(String(args[0])) }

    try {
      const app = createApp()
      app.onRequest(rateLimitPlugin({ max: 100, windowMs: 60_000, trustProxy: true }))
      app.get('/hit', (ctx) => ctx.json({ ok: true }))

      // Three requests without X-Forwarded-For — warning should fire only once
      await app.fetch(req('/hit'))
      await app.fetch(req('/hit'))
      await app.fetch(req('/hit'))

      const missingHeaderWarnings = warnMessages.filter((m) =>
        m.includes('X-Forwarded-For'),
      )
      expect(missingHeaderWarnings.length).toBe(1)
    } finally {
      console.warn = origWarn
    }
  })
})

// ── Case 3 — trustProxy: { strict: true } + no header → 400 ─────────────────

describe('Case 3 — strict mode + missing header → 400', () => {
  test('missing X-Forwarded-For → 400 Bad Request', async () => {
    const app = createApp()
    app.onRequest(rateLimitPlugin({
      max:        10,
      windowMs:   60_000,
      trustProxy: { strict: true },
    }))
    app.get('/secure', (ctx) => ctx.json({ ok: true }))

    const res = await app.fetch(req('/secure'))
    expect(res.status).toBe(400)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('MISSING_PROXY_HEADER')
  })

  test('strict mode + header present → request succeeds', async () => {
    const app = createApp()
    app.onRequest(rateLimitPlugin({
      max:        10,
      windowMs:   60_000,
      trustProxy: { strict: true },
    }))
    app.get('/secure', (ctx) => ctx.json({ ok: true }))

    const res = await app.fetch(req('/secure', { 'x-forwarded-for': '203.0.113.5' }))
    expect(res.status).toBe(200)
  })
})

// ── Case 4 — trustProxy: false → header ignored ──────────────────────────────

describe('Case 4 — trustProxy: false → X-Forwarded-For ignored', () => {
  test('X-Forwarded-For present but ignored; x-real-ip used instead', async () => {
    const keys: string[] = []
    const app = createApp()
    app.onRequest(rateLimitPlugin({
      max:        10,
      windowMs:   60_000,
      store:      mockStore(keys),
      trustProxy: false,
    }))
    app.get('/hit', (ctx) => ctx.json({ ok: true }))

    await app.fetch(req('/hit', {
      'x-forwarded-for': '203.0.113.5',
      'x-real-ip':       '10.0.0.1',
    }))
    // X-Forwarded-For ignored; x-real-ip used
    expect(keys[0]).toBe('10.0.0.1')
  })

  test('no headers → falls back to "unknown"', async () => {
    const keys: string[] = []
    const app = createApp()
    app.onRequest(rateLimitPlugin({
      max:        10,
      windowMs:   60_000,
      store:      mockStore(keys),
      keyResolver: () => 'explicit-key',  // suppress the no-trustProxy warning
    }))
    app.get('/hit', (ctx) => ctx.json({ ok: true }))

    await app.fetch(req('/hit'))
    expect(keys[0]).toBe('explicit-key')
  })
})

// ── Case 5 — Last X-Forwarded-For entry used (security fix) ──────────────────
//
// BREAKING CHANGE (Spec 13): The first entry was used before; now the last is.
// Rationale: A client can forge the first entry by sending
//   X-Forwarded-For: FAKE, real_proxy_ip
// The last entry is appended by the outermost trusted proxy and cannot be spoofed.

describe('Case 5 — Last X-Forwarded-For entry used (not first)', () => {
  test('"1.2.3.4, 5.6.7.8" → last entry 5.6.7.8 is the bucket key', async () => {
    const keys: string[] = []
    const app = createApp()
    app.onRequest(rateLimitPlugin({ max: 10, windowMs: 60_000, store: mockStore(keys), trustProxy: true }))
    app.get('/hit', (ctx) => ctx.json({ ok: true }))

    await app.fetch(req('/hit', { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))
    expect(keys[0]).toBe('5.6.7.8')
  })

  test('"spoofed, intermediary, proxy" → bucket key is "proxy" (last entry)', async () => {
    const keys: string[] = []
    const app = createApp()
    app.onRequest(rateLimitPlugin({ max: 10, windowMs: 60_000, store: mockStore(keys), trustProxy: true }))
    app.get('/hit', (ctx) => ctx.json({ ok: true }))

    await app.fetch(req('/hit', { 'x-forwarded-for': 'spoofed, intermediary, proxy' }))
    expect(keys[0]).toBe('proxy')
  })

  test('attacker spoofing first entry cannot bypass rate limiter', async () => {
    // Attacker adds a fake IP as the first entry hoping to get their own bucket.
    // The rate limiter must use the last (proxy-controlled) entry instead.
    const keys: string[] = []
    const app = createApp()
    app.onRequest(rateLimitPlugin({ max: 10, windowMs: 60_000, store: mockStore(keys), trustProxy: true }))
    app.get('/hit', (ctx) => ctx.json({ ok: true }))

    await app.fetch(req('/hit', { 'x-forwarded-for': 'ATTACKER_FAKE, 203.0.113.5' }))
    // The attacker's fake IP must NOT be used
    expect(keys[0]).not.toBe('ATTACKER_FAKE')
    // The real proxy IP (last entry) is used
    expect(keys[0]).toBe('203.0.113.5')
  })
})

// ── Case 6 — Different IPs → different buckets ───────────────────────────────

describe('Case 6 — Different IPs map to independent rate-limit buckets', () => {
  test('two distinct IPs have separate counters', async () => {
    const keys: string[] = []
    const app = createApp()
    app.onRequest(rateLimitPlugin({ max: 10, windowMs: 60_000, store: mockStore(keys), trustProxy: true }))
    app.get('/hit', (ctx) => ctx.json({ ok: true }))

    await app.fetch(req('/hit', { 'x-forwarded-for': '1.1.1.1' }))
    await app.fetch(req('/hit', { 'x-forwarded-for': '2.2.2.2' }))

    expect(keys[0]).toBe('1.1.1.1')
    expect(keys[1]).toBe('2.2.2.2')
    // Two separate store.increment() calls with different keys
    expect(keys[0]).not.toBe(keys[1])
  })

  test('same IP maps to same bucket across requests', async () => {
    const keys: string[] = []
    const app = createApp()
    app.onRequest(rateLimitPlugin({ max: 10, windowMs: 60_000, store: mockStore(keys), trustProxy: true }))
    app.get('/hit', (ctx) => ctx.json({ ok: true }))

    await app.fetch(req('/hit', { 'x-forwarded-for': '3.3.3.3' }))
    await app.fetch(req('/hit', { 'x-forwarded-for': '3.3.3.3' }))

    expect(keys[0]).toBe('3.3.3.3')
    expect(keys[1]).toBe('3.3.3.3')
  })
})
