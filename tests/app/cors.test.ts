import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { corsPlugin } from '../../packages/core/src/app/cors'

function makeApp(options?: Parameters<typeof corsPlugin>[0]) {
  const app = createApp()
  const cors = corsPlugin(options)
  app.onRequest(cors.onRequest)
  app.onResponse(cors.onResponse)
  app.get('/hello', (ctx) => ctx.json({ ok: true }))
  app.post('/data', (ctx) => ctx.json({ ok: true }))
  return app
}

describe('corsPlugin — preflight (OPTIONS)', () => {
  test('OPTIONS returns 204', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/hello', {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com' },
    }))
    expect(res.status).toBe(204)
  })

  test('OPTIONS includes Allow-Methods header', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/hello', {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com' },
    }))
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })

  test('OPTIONS includes Allow-Headers header', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/hello', {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com' },
    }))
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type')
  })

  test('OPTIONS includes Max-Age header', async () => {
    const app = makeApp({ maxAge: 3600 })
    const res = await app.fetch(new Request('http://localhost/hello', {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com' },
    }))
    expect(res.headers.get('Access-Control-Max-Age')).toBe('3600')
  })

  test('OPTIONS with custom allowHeaders', async () => {
    const app = makeApp({ allowHeaders: ['X-My-Header'] })
    const res = await app.fetch(new Request('http://localhost/hello', {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com' },
    }))
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-My-Header')
  })
})

describe('corsPlugin — origin: *', () => {
  test('wildcard origin — echoes *', async () => {
    const app = makeApp({ origin: '*' })
    const res = await app.fetch(new Request('http://localhost/hello', {
      headers: { Origin: 'https://any.com' },
    }))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  test('no Origin header — no CORS header added', async () => {
    const app = makeApp({ origin: '*' })
    const res = await app.fetch(new Request('http://localhost/hello'))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('corsPlugin — single origin string', () => {
  test('matching origin is reflected', async () => {
    const app = makeApp({ origin: 'https://app.example.com' })
    const res = await app.fetch(new Request('http://localhost/hello', {
      headers: { Origin: 'https://app.example.com' },
    }))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
  })

  test('non-matching origin gets no CORS header', async () => {
    const app = makeApp({ origin: 'https://app.example.com' })
    const res = await app.fetch(new Request('http://localhost/hello', {
      headers: { Origin: 'https://evil.com' },
    }))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  test('non-wildcard origin sets Vary: Origin', async () => {
    const app = makeApp({ origin: 'https://app.example.com' })
    const res = await app.fetch(new Request('http://localhost/hello', {
      headers: { Origin: 'https://app.example.com' },
    }))
    expect(res.headers.get('Vary')).toBe('Origin')
  })
})

describe('corsPlugin — origin array', () => {
  test('origin in list is reflected', async () => {
    const app = makeApp({ origin: ['https://a.com', 'https://b.com'] })
    const res = await app.fetch(new Request('http://localhost/hello', {
      headers: { Origin: 'https://b.com' },
    }))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://b.com')
  })

  test('origin not in list gets no header', async () => {
    const app = makeApp({ origin: ['https://a.com', 'https://b.com'] })
    const res = await app.fetch(new Request('http://localhost/hello', {
      headers: { Origin: 'https://c.com' },
    }))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('corsPlugin — origin function', () => {
  test('predicate returning true reflects origin', async () => {
    const app = makeApp({ origin: (o) => o.endsWith('.example.com') })
    const res = await app.fetch(new Request('http://localhost/hello', {
      headers: { Origin: 'https://sub.example.com' },
    }))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://sub.example.com')
  })

  test('predicate returning false gets no header', async () => {
    const app = makeApp({ origin: (o) => o.endsWith('.example.com') })
    const res = await app.fetch(new Request('http://localhost/hello', {
      headers: { Origin: 'https://evil.com' },
    }))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('corsPlugin — credentials', () => {
  test('credentials: true adds Allow-Credentials header', async () => {
    const app = makeApp({ origin: 'https://app.example.com', credentials: true })
    const res = await app.fetch(new Request('http://localhost/hello', {
      headers: { Origin: 'https://app.example.com' },
    }))
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  test('credentials: false (default) — no Allow-Credentials header', async () => {
    const app = makeApp({ origin: '*' })
    const res = await app.fetch(new Request('http://localhost/hello', {
      headers: { Origin: 'https://any.com' },
    }))
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })
})

describe('corsPlugin — exposeHeaders', () => {
  test('exposeHeaders are reflected in response', async () => {
    const app = makeApp({ exposeHeaders: ['X-Custom-Header', 'X-Total-Count'] })
    const res = await app.fetch(new Request('http://localhost/hello', {
      headers: { Origin: 'https://any.com' },
    }))
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Custom-Header')
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Total-Count')
  })

  test('no exposeHeaders — no Expose-Headers header', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/hello', {
      headers: { Origin: 'https://any.com' },
    }))
    expect(res.headers.get('Access-Control-Expose-Headers')).toBeNull()
  })
})

describe('corsPlugin — response passthrough', () => {
  test('existing response headers are preserved', async () => {
    const app = createApp()
    const cors = corsPlugin()
    app.onRequest(cors.onRequest)
    app.onResponse(cors.onResponse)
    app.get('/typed', (ctx) => {
      const res = ctx.json({ ok: true })
      res.headers.set('X-My-Header', 'preserved')
      return res
    })
    const res = await app.fetch(new Request('http://localhost/typed', {
      headers: { Origin: 'https://any.com' },
    }))
    expect(res.headers.get('X-My-Header')).toBe('preserved')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  test('response status is preserved', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/hello', {
      headers: { Origin: 'https://any.com' },
    }))
    expect(res.status).toBe(200)
  })
})

// ── origin + credentials validation ───────────────────────────────────────────

describe('corsPlugin — origin * + credentials validation', () => {
  test("corsPlugin({ origin: '*', credentials: false }) → no error", () => {
    expect(() => corsPlugin({ origin: '*', credentials: false })).not.toThrow()
  })

  test("corsPlugin({ origin: 'https://app.com', credentials: true }) → no error", () => {
    expect(() => corsPlugin({ origin: 'https://app.com', credentials: true })).not.toThrow()
  })

  test("corsPlugin({ origin: '*', credentials: true }) → throws", () => {
    expect(() => corsPlugin({ origin: '*', credentials: true })).toThrow(
      "CORS: origin: '*' cannot be combined with credentials: true"
    )
  })

  test('corsPlugin({}) default origin (wildcard) + credentials: true → throws', () => {
    expect(() => corsPlugin({ credentials: true })).toThrow(
      "CORS: origin: '*' cannot be combined with credentials: true"
    )
  })

  test('corsPlugin({ origin: [array], credentials: true }) → no error', () => {
    expect(() => corsPlugin({ origin: ['https://a.com', 'https://b.com'], credentials: true })).not.toThrow()
  })

  test('corsPlugin({ origin: fn, credentials: true }) → no error', () => {
    expect(() => corsPlugin({ origin: () => true, credentials: true })).not.toThrow()
  })
})
