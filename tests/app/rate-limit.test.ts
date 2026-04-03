import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { rateLimitPlugin, InMemoryStore } from '../../packages/core/src/app/rate-limit'
import type { RateLimitStore } from '../../packages/core/src/app/rate-limit'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRequest(ip = '1.2.3.4', path = '/ok'): Request {
  return new Request(`http://localhost${path}`, {
    headers: { 'x-forwarded-for': ip },
  })
}

function makeApp(max: number, windowMs = 60_000, store?: RateLimitStore) {
  const app = createApp()
  // trustProxy: true — existing tests use x-forwarded-for for IP-based rate limiting
  app.onRequest(rateLimitPlugin({ max, windowMs, store, trustProxy: true }))
  app.get('/ok', (ctx) => ctx.json({ ok: true }))
  return app
}

// ── 1. Under limit ─────────────────────────────────────────────────────────────

describe('rateLimitPlugin — under limit', () => {
  test('request within limit passes through', async () => {
    const app = makeApp(5)
    const res = await app.fetch(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  test('exactly at limit (count === max) passes through', async () => {
    const app = makeApp(3)
    for (let i = 0; i < 3; i++) {
      const res = await app.fetch(makeRequest())
      expect(res.status).toBe(200)
    }
  })
})

// ── 2. Over limit → 429 ───────────────────────────────────────────────────────

describe('rateLimitPlugin — over limit', () => {
  test('request over limit → 429', async () => {
    const app = makeApp(2)
    await app.fetch(makeRequest())
    await app.fetch(makeRequest())
    const res = await app.fetch(makeRequest())  // 3rd — over limit
    expect(res.status).toBe(429)
  })

  test('429 response has Retry-After header', async () => {
    const app = makeApp(1)
    await app.fetch(makeRequest())
    const res = await app.fetch(makeRequest())
    expect(res.status).toBe(429)
    const retryAfter = res.headers.get('Retry-After')
    expect(retryAfter).not.toBeNull()
    expect(Number(retryAfter)).toBeGreaterThan(0)
  })

  test('429 response has X-RateLimit-Limit header', async () => {
    const app = makeApp(3)
    for (let i = 0; i <= 3; i++) await app.fetch(makeRequest())
    const res = await app.fetch(makeRequest())
    expect(res.headers.get('X-RateLimit-Limit')).toBe('3')
  })

  test('429 response has X-RateLimit-Remaining: 0', async () => {
    const app = makeApp(1)
    await app.fetch(makeRequest())
    const res = await app.fetch(makeRequest())
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')
  })

  test('429 response has X-RateLimit-Reset header', async () => {
    const app = makeApp(1)
    await app.fetch(makeRequest())
    const res = await app.fetch(makeRequest())
    const reset = Number(res.headers.get('X-RateLimit-Reset'))
    expect(reset).toBeGreaterThan(Date.now() / 1000)
  })

  test('429 response body is JSON with error code', async () => {
    const app = makeApp(1)
    await app.fetch(makeRequest())
    const res = await app.fetch(makeRequest())
    const body = await res.json() as { code: string; message: string }
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED')
    expect(typeof body.message).toBe('string')
  })

  test('custom message appears in 429 body', async () => {
    const app = createApp()
    app.onRequest(rateLimitPlugin({ max: 1, windowMs: 60_000, message: 'Slow down!' }))
    app.get('/ok', (ctx) => ctx.json({ ok: true }))
    await app.fetch(makeRequest())
    const res = await app.fetch(makeRequest())
    const body = await res.json() as { message: string }
    expect(body.message).toBe('Slow down!')
  })
})

// ── 3. Key isolation — different IPs have independent counters ────────────────

describe('rateLimitPlugin — key isolation', () => {
  test('different IPs are tracked independently', async () => {
    const app = makeApp(1)
    // IP A hits limit
    await app.fetch(makeRequest('10.0.0.1'))
    const resA = await app.fetch(makeRequest('10.0.0.1'))
    expect(resA.status).toBe(429)
    // IP B still has capacity
    const resB = await app.fetch(makeRequest('10.0.0.2'))
    expect(resB.status).toBe(200)
  })
})

// ── 4. Window reset ────────────────────────────────────────────────────────────

describe('rateLimitPlugin — window reset', () => {
  test('counter resets after window expires', async () => {
    const store = new InMemoryStore()
    const app = createApp()
    app.onRequest(rateLimitPlugin({ max: 1, windowMs: 50, store }))
    app.get('/ok', (ctx) => ctx.json({ ok: true }))

    await app.fetch(makeRequest())
    const blocked = await app.fetch(makeRequest())
    expect(blocked.status).toBe(429)

    // Wait for window to expire
    await Bun.sleep(60)

    const res = await app.fetch(makeRequest())
    expect(res.status).toBe(200)
  })

  test('store.reset() clears the counter immediately', async () => {
    const store = new InMemoryStore()
    const app = createApp()
    app.onRequest(rateLimitPlugin({ max: 1, windowMs: 60_000, store, trustProxy: true }))
    app.get('/ok', (ctx) => ctx.json({ ok: true }))

    await app.fetch(makeRequest('5.5.5.5'))
    const blocked = await app.fetch(makeRequest('5.5.5.5'))
    expect(blocked.status).toBe(429)

    await store.reset('5.5.5.5')

    const res = await app.fetch(makeRequest('5.5.5.5'))
    expect(res.status).toBe(200)
  })
})

// ── 5. Custom keyResolver ─────────────────────────────────────────────────────

describe('rateLimitPlugin — custom keyResolver', () => {
  test('per-user rate limiting via keyResolver', async () => {
    const app = createApp()
    app.onRequest(rateLimitPlugin({
      max: 1,
      windowMs: 60_000,
      keyResolver: (ctx) => ctx.req.headers.get('x-user-id') ?? 'anon',
    }))
    app.get('/ok', (ctx) => ctx.json({ ok: true }))

    const reqUser1 = new Request('http://localhost/ok', { headers: { 'x-user-id': 'user-1' } })
    const reqUser2 = new Request('http://localhost/ok', { headers: { 'x-user-id': 'user-2' } })

    // user-1 hits limit
    await app.fetch(reqUser1.clone())
    const blocked = await app.fetch(reqUser1.clone())
    expect(blocked.status).toBe(429)

    // user-2 is unaffected
    const ok = await app.fetch(reqUser2.clone())
    expect(ok.status).toBe(200)
  })

  test('keyResolver returning same key shares the counter', async () => {
    const app = createApp()
    app.onRequest(rateLimitPlugin({
      max: 2,
      windowMs: 60_000,
      // All requests share one bucket
      keyResolver: () => 'global',
    }))
    app.get('/ok', (ctx) => ctx.json({ ok: true }))

    await app.fetch(makeRequest('1.1.1.1'))
    await app.fetch(makeRequest('2.2.2.2'))
    const res = await app.fetch(makeRequest('3.3.3.3'))
    expect(res.status).toBe(429)
  })
})

// ── 6. Custom store ────────────────────────────────────────────────────────────

describe('rateLimitPlugin — custom store', () => {
  test('custom mock store is called on each request', async () => {
    const calls: string[] = []
    const mockStore: RateLimitStore = {
      async increment(key) {
        calls.push(key)
        return { count: 1, resetAt: Date.now() + 60_000 }
      },
      async reset(_key) {},
    }
    const app = makeApp(10, 60_000, mockStore)
    await app.fetch(makeRequest('9.9.9.9'))
    await app.fetch(makeRequest('9.9.9.9'))
    expect(calls).toHaveLength(2)
    expect(calls[0]).toBe('9.9.9.9')
  })

  test('custom store returning count > max triggers 429', async () => {
    const mockStore: RateLimitStore = {
      async increment(_key, _windowMs) {
        return { count: 999, resetAt: Date.now() + 60_000 }
      },
      async reset(_key) {},
    }
    const app = makeApp(5, 60_000, mockStore)
    const res = await app.fetch(makeRequest())
    expect(res.status).toBe(429)
  })

  test('custom store returning count === 1 always passes', async () => {
    const mockStore: RateLimitStore = {
      async increment(_key, _windowMs) {
        return { count: 1, resetAt: Date.now() + 60_000 }
      },
      async reset(_key) {},
    }
    const app = makeApp(100, 60_000, mockStore)
    for (let i = 0; i < 10; i++) {
      const res = await app.fetch(makeRequest())
      expect(res.status).toBe(200)
    }
  })
})

// ── 7. Module-scoped usage ────────────────────────────────────────────────────

describe('rateLimitPlugin — module-scoped', () => {
  test('limit applies only to module routes, not app-level routes', async () => {
    const app = createApp()
    app.get('/public', (ctx) => ctx.json({ public: true }))

    const mod = defineModule('/api')
      .onRequest(rateLimitPlugin({ max: 1, windowMs: 60_000 }))
      .get('/data', (ctx) => ctx.json({ data: true }))
      .build()
    app.register(mod)

    // Module route: 2nd request is blocked
    await app.fetch(makeRequest('1.1.1.1', '/api/data'))
    const blocked = await app.fetch(makeRequest('1.1.1.1', '/api/data'))
    expect(blocked.status).toBe(429)

    // Public route: same IP is not blocked (different module / no rate limit)
    const pub = await app.fetch(makeRequest('1.1.1.1', '/public'))
    expect(pub.status).toBe(200)
  })
})

// ── 8. InMemoryStore — cleanup ────────────────────────────────────────────────

describe('InMemoryStore', () => {
  test('cleanup() removes expired entries', async () => {
    const store = new InMemoryStore()
    await store.increment('key-a', 50)
    await store.increment('key-b', 60_000)

    await Bun.sleep(60)
    store.cleanup()

    // key-a expired → fresh window after cleanup
    const { count } = await store.increment('key-a', 60_000)
    expect(count).toBe(1)
  })

  test('increment within same window accumulates', async () => {
    const store = new InMemoryStore()
    await store.increment('x', 60_000)
    await store.increment('x', 60_000)
    const { count } = await store.increment('x', 60_000)
    expect(count).toBe(3)
  })

  test('reset() allows fresh start', async () => {
    const store = new InMemoryStore()
    await store.increment('y', 60_000)
    await store.increment('y', 60_000)
    await store.reset('y')
    const { count } = await store.increment('y', 60_000)
    expect(count).toBe(1)
  })
})

// ── 9. InMemoryStore — max entries cap (DoS prevention) ───────────────────────

describe('InMemoryStore — maxEntries cap', () => {
  test('store never exceeds maxEntries after many unique keys', async () => {
    const store = new InMemoryStore(1_000_000, 5)  // cap at 5, never sweep

    for (let i = 0; i < 10; i++) {
      await store.increment(`ip-${i}`, 60_000)
    }

    // After inserting 10 unique keys with cap=5, store size must be ≤ 5
    // (the exact count after eviction batches depends on timing, but cap is enforced)
    const storeMap = (store as unknown as { _map: Map<string, unknown> })._map
    expect(storeMap.size).toBeLessThanOrEqual(5)
  })

  test('eviction removes oldest entries (smallest resetAt)', async () => {
    const store = new InMemoryStore(1_000_000, 3)  // cap at 3

    // Insert 3 entries with ascending resetAt
    await store.increment('oldest', 100)
    await Bun.sleep(5)
    await store.increment('middle', 100)
    await Bun.sleep(5)
    await store.increment('newest', 100)

    // Inserting 4th entry triggers eviction of oldest 20% (at least 1)
    await store.increment('trigger', 100)

    const storeMap = (store as unknown as { _map: Map<string, unknown> })._map
    expect(storeMap.size).toBeLessThanOrEqual(3)
    // 'oldest' should have been evicted (smallest resetAt)
    expect(storeMap.has('oldest')).toBe(false)
  })

  test('increment on existing key within window does NOT count as new key', async () => {
    const store = new InMemoryStore(1_000_000, 2)  // cap at 2

    await store.increment('a', 60_000)
    await store.increment('b', 60_000)

    // Incrementing existing keys must not trigger eviction
    const { count } = await store.increment('a', 60_000)
    expect(count).toBe(2)

    const storeMap = (store as unknown as { _map: Map<string, unknown> })._map
    expect(storeMap.size).toBe(2)  // still 2, no eviction
  })

  test('default maxEntries is 100_000', () => {
    const store = new InMemoryStore()
    const storeAny = store as unknown as { _maxEntries: number }
    expect(storeAny._maxEntries).toBe(100_000)
  })
})

// ── 10. trustProxy option ─────────────────────────────────────────────────────

describe('rateLimitPlugin — trustProxy', () => {
  function makeXForwardedReq(ip: string, path = '/ok'): Request {
    return new Request(`http://localhost${path}`, {
      headers: { 'x-forwarded-for': ip },
    })
  }

  function makeXRealIpReq(ip: string, path = '/ok'): Request {
    return new Request(`http://localhost${path}`, {
      headers: { 'x-real-ip': ip },
    })
  }

  test('trustProxy: false (default) — X-Forwarded-For header ignored; uses unknown', async () => {
    const calls: string[] = []
    const mockStore: RateLimitStore = {
      async increment(key) {
        calls.push(key)
        return { count: 1, resetAt: Date.now() + 60_000 }
      },
      async reset(_key) {},
    }
    const app = createApp()
    app.onRequest(rateLimitPlugin({ max: 10, windowMs: 60_000, store: mockStore }))
    app.get('/ok', (ctx) => ctx.json({ ok: true }))

    await app.fetch(makeXForwardedReq('1.2.3.4'))
    // Without trustProxy, x-forwarded-for is ignored; key falls back to 'unknown'
    expect(calls[0]).toBe('unknown')
  })

  test('trustProxy: false (default) — x-real-ip is used instead', async () => {
    const calls: string[] = []
    const mockStore: RateLimitStore = {
      async increment(key) {
        calls.push(key)
        return { count: 1, resetAt: Date.now() + 60_000 }
      },
      async reset(_key) {},
    }
    const app = createApp()
    app.onRequest(rateLimitPlugin({ max: 10, windowMs: 60_000, store: mockStore }))
    app.get('/ok', (ctx) => ctx.json({ ok: true }))

    await app.fetch(makeXRealIpReq('5.6.7.8'))
    expect(calls[0]).toBe('5.6.7.8')
  })

  test('trustProxy: true — single IP from X-Forwarded-For used', async () => {
    const calls: string[] = []
    const mockStore: RateLimitStore = {
      async increment(key) {
        calls.push(key)
        return { count: 1, resetAt: Date.now() + 60_000 }
      },
      async reset(_key) {},
    }
    const app = createApp()
    app.onRequest(rateLimitPlugin({ max: 10, windowMs: 60_000, store: mockStore, trustProxy: true }))
    app.get('/ok', (ctx) => ctx.json({ ok: true }))

    await app.fetch(makeXForwardedReq('1.2.3.4'))
    expect(calls[0]).toBe('1.2.3.4')
  })

  // BREAKING CHANGE (Spec 13): was 'first IP', now 'last IP'.
  // The last entry is set by the outermost trusted proxy — clients can prepend
  // fake IPs but cannot forge the final proxy-appended entry.
  test('trustProxy: true, multiple IPs in header — last IP used (not first)', async () => {
    const calls: string[] = []
    const mockStore: RateLimitStore = {
      async increment(key) {
        calls.push(key)
        return { count: 1, resetAt: Date.now() + 60_000 }
      },
      async reset(_key) {},
    }
    const app = createApp()
    app.onRequest(rateLimitPlugin({ max: 10, windowMs: 60_000, store: mockStore, trustProxy: true }))
    app.get('/ok', (ctx) => ctx.json({ ok: true }))

    const req = new Request('http://localhost/ok', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12' },
    })
    await app.fetch(req)
    // 9.10.11.12 is the last entry — added by the outermost proxy
    expect(calls[0]).toBe('9.10.11.12')
  })

  test('no headers → falls back to unknown', async () => {
    const calls: string[] = []
    const mockStore: RateLimitStore = {
      async increment(key) {
        calls.push(key)
        return { count: 1, resetAt: Date.now() + 60_000 }
      },
      async reset(_key) {},
    }
    const app = createApp()
    app.onRequest(rateLimitPlugin({ max: 10, windowMs: 60_000, store: mockStore }))
    app.get('/ok', (ctx) => ctx.json({ ok: true }))

    await app.fetch(new Request('http://localhost/ok'))
    expect(calls[0]).toBe('unknown')
  })
})
