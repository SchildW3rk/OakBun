import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { csrfPlugin, timingSafeEqual } from '../../packages/core/src/app/csrf'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeApp(options?: Parameters<typeof csrfPlugin>[0]) {
  const app  = createApp()
  const csrf = csrfPlugin(options)
  app.onRequest(csrf.onRequest)
  app.onResponse(csrf.onResponse)
  app.get('/page',  (ctx) => ctx.json({ page: true }))
  app.post('/data', (ctx) => ctx.json({ data: true }))
  app.put('/data',  (ctx) => ctx.json({ data: true }))
  app.patch('/data',(ctx) => ctx.json({ data: true }))
  app.delete('/data', (ctx) => ctx.json({ data: true }))
  return app
}

/** Extract Set-Cookie value for a given cookie name from a Response. */
function getCookieValue(res: Response, name: string): string | undefined {
  for (const [header, value] of res.headers) {
    if (header.toLowerCase() !== 'set-cookie') continue
    const [pair] = value.split(';')
    if (!pair) continue
    const [k, v] = pair.split('=')
    if (decodeURIComponent(k?.trim() ?? '') === name) return decodeURIComponent(v?.trim() ?? '')
  }
  return undefined
}

/** Build a request that includes the CSRF cookie + matching header. */
function makeValidPost(token: string, path = '/data', cookieName = 'csrf_token', headerName = 'x-csrf-token'): Request {
  return new Request(`http://localhost${path}`, {
    method:  'POST',
    headers: {
      'Cookie':   `${cookieName}=${token}`,
      [headerName]: token,
    },
  })
}

// ── 1. Token issuance on safe methods ────────────────────────────────────────

describe('csrfPlugin — token issuance', () => {
  test('GET sets csrf_token cookie', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/page'))
    expect(res.status).toBe(200)
    const token = getCookieValue(res, 'csrf_token')
    expect(token).toBeDefined()
    expect(typeof token).toBe('string')
    expect(token!.length).toBe(64)  // 32 bytes → 64 hex chars
  })

  test('cookie is httpOnly: false — readable by JS', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/page'))
    // httpOnly: false means 'HttpOnly' directive is absent
    const raw = res.headers.get('set-cookie') ?? ''
    expect(raw.toLowerCase()).not.toContain('httponly')
  })

  test('cookie has SameSite=Strict', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/page'))
    const raw = res.headers.get('set-cookie') ?? ''
    expect(raw).toContain('SameSite=Strict')
  })

  test('cookie has Path=/', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/page'))
    const raw = res.headers.get('set-cookie') ?? ''
    expect(raw).toContain('Path=/')
  })

  test('token is not regenerated if valid cookie already present', async () => {
    const app = makeApp()
    const existing = 'a'.repeat(64)
    const res = await app.fetch(new Request('http://localhost/page', {
      headers: { Cookie: `csrf_token=${existing}` },
    }))
    // No Set-Cookie — existing token kept
    const token = getCookieValue(res, 'csrf_token')
    expect(token).toBeUndefined()
  })

  test('each GET without cookie produces a unique token', async () => {
    const app = makeApp()
    const r1 = await app.fetch(new Request('http://localhost/page'))
    const r2 = await app.fetch(new Request('http://localhost/page'))
    const t1 = getCookieValue(r1, 'csrf_token')
    const t2 = getCookieValue(r2, 'csrf_token')
    expect(t1).not.toBe(t2)
  })
})

// ── 2. Valid token → request passes through ───────────────────────────────────

describe('csrfPlugin — valid token', () => {
  test('POST with matching cookie + header → 200', async () => {
    const app = makeApp()
    const token = 'b'.repeat(64)
    const res = await app.fetch(makeValidPost(token))
    expect(res.status).toBe(200)
  })

  test('PUT with matching cookie + header → 200', async () => {
    const app = makeApp()
    const token = 'c'.repeat(64)
    const res = await app.fetch(new Request('http://localhost/data', {
      method: 'PUT',
      headers: { Cookie: `csrf_token=${token}`, 'x-csrf-token': token },
    }))
    expect(res.status).toBe(200)
  })

  test('PATCH with matching cookie + header → 200', async () => {
    const app = makeApp()
    const token = 'd'.repeat(64)
    const res = await app.fetch(new Request('http://localhost/data', {
      method: 'PATCH',
      headers: { Cookie: `csrf_token=${token}`, 'x-csrf-token': token },
    }))
    expect(res.status).toBe(200)
  })

  test('DELETE with matching cookie + header → 200', async () => {
    const app = makeApp()
    const token = 'e'.repeat(64)
    const res = await app.fetch(new Request('http://localhost/data', {
      method: 'DELETE',
      headers: { Cookie: `csrf_token=${token}`, 'x-csrf-token': token },
    }))
    expect(res.status).toBe(200)
  })
})

// ── 3. Invalid token → 403 ────────────────────────────────────────────────────

describe('csrfPlugin — invalid token → 403', () => {
  test('POST without cookie → 403', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/data', { method: 'POST' }))
    expect(res.status).toBe(403)
  })

  test('POST without header → 403', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/data', {
      method: 'POST',
      headers: { Cookie: 'csrf_token=abc' },
    }))
    expect(res.status).toBe(403)
  })

  test('POST with mismatched cookie and header → 403', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/data', {
      method: 'POST',
      headers: {
        Cookie:          'csrf_token=token-a',
        'x-csrf-token':  'token-b',
      },
    }))
    expect(res.status).toBe(403)
  })

  test('403 response body contains CSRF_INVALID code', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/data', { method: 'POST' }))
    const body = await res.json() as { code: string }
    expect(body.code).toBe('CSRF_INVALID')
  })

  test('403 response Content-Type is application/json', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/data', { method: 'POST' }))
    expect(res.headers.get('Content-Type')).toContain('application/json')
  })
})

// ── 4. Ignored methods — never blocked ────────────────────────────────────────

describe('csrfPlugin — ignored methods', () => {
  test('GET is never blocked (no token needed)', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/page'))
    expect(res.status).toBe(200)
  })

  test('HEAD is never blocked', async () => {
    const app = createApp()
    const csrf = csrfPlugin()
    app.onRequest(csrf.onRequest)
    app.onResponse(csrf.onResponse)
    // Bun responds 200 to HEAD on existing GET routes
    app.get('/ok', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(new Request('http://localhost/ok', { method: 'HEAD' }))
    expect(res.status).not.toBe(403)
  })

  test('OPTIONS is never blocked', async () => {
    const app = createApp()
    const csrf = csrfPlugin()
    app.onRequest(csrf.onRequest)
    app.onResponse(csrf.onResponse)
    app.get('/ok', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(new Request('http://localhost/ok', { method: 'OPTIONS' }))
    expect(res.status).not.toBe(403)
  })
})

// ── timingSafeEqual ────────────────────────────────────────────────────────────

describe('timingSafeEqual', () => {
  test('same tokens → returns true', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true)
  })

  test('different tokens (same length) → returns false', () => {
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false)
  })

  test('different lengths → returns false', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })

  test('empty string + empty string → returns true', () => {
    expect(timingSafeEqual('', '')).toBe(true)
  })

  test('empty + non-empty → returns false', () => {
    expect(timingSafeEqual('', 'a')).toBe(false)
  })

  test('all characters differ → returns false', () => {
    expect(timingSafeEqual('aaaaaa', 'bbbbbb')).toBe(false)
  })

  test('long matching tokens → returns true', () => {
    const token = 'a'.repeat(64)
    expect(timingSafeEqual(token, token)).toBe(true)
  })
})

// ── 5. Custom options ──────────────────────────────────────────────────────────

describe('csrfPlugin — custom options', () => {
  test('custom cookieName is used', async () => {
    const app = makeApp({ cookieName: 'my_csrf' })
    const res = await app.fetch(new Request('http://localhost/page'))
    const token = getCookieValue(res, 'my_csrf')
    expect(token).toBeDefined()
  })

  test('custom headerName is checked for validation', async () => {
    const app = makeApp({ headerName: 'x-my-token' })
    const token = 'f'.repeat(64)
    // Valid: custom header present
    const ok = await app.fetch(new Request('http://localhost/data', {
      method: 'POST',
      headers: { Cookie: `csrf_token=${token}`, 'x-my-token': token },
    }))
    expect(ok.status).toBe(200)

    // Invalid: default header used instead of custom
    const blocked = await app.fetch(new Request('http://localhost/data', {
      method: 'POST',
      headers: { Cookie: `csrf_token=${token}`, 'x-csrf-token': token },
    }))
    expect(blocked.status).toBe(403)
  })

  test('custom cookieName + headerName work together', async () => {
    const app = makeApp({ cookieName: 'x-token', headerName: 'x-token-header' })
    const token = '0'.repeat(64)
    const res = await app.fetch(new Request('http://localhost/data', {
      method: 'POST',
      headers: { Cookie: `x-token=${token}`, 'x-token-header': token },
    }))
    expect(res.status).toBe(200)
  })

  test('maxAge is reflected in Set-Cookie', async () => {
    const app = makeApp({ maxAge: 3600 })
    const res = await app.fetch(new Request('http://localhost/page'))
    const raw = res.headers.get('set-cookie') ?? ''
    expect(raw).toContain('Max-Age=3600')
  })
})

// ── 6. Module-scoped usage ────────────────────────────────────────────────────

describe('csrfPlugin — module-scoped', () => {
  test('CSRF only enforced on module routes, not app-level routes', async () => {
    const app = createApp()
    app.post('/public', (ctx) => ctx.json({ public: true }))

    const csrf = csrfPlugin()
    const mod  = defineModule('/api')
      .onRequest(csrf.onRequest)
      .onResponse(csrf.onResponse)
      .post('/secure', (ctx) => ctx.json({ secure: true }))
      .build()
    app.register(mod)

    // Public route: no token needed
    const pub = await app.fetch(new Request('http://localhost/public', { method: 'POST' }))
    expect(pub.status).toBe(200)

    // Module route: blocked without token
    const blocked = await app.fetch(new Request('http://localhost/api/secure', { method: 'POST' }))
    expect(blocked.status).toBe(403)

    // Module route: passes with valid token
    const token = 'g'.repeat(64)
    const ok = await app.fetch(new Request('http://localhost/api/secure', {
      method: 'POST',
      headers: { Cookie: `csrf_token=${token}`, 'x-csrf-token': token },
    }))
    expect(ok.status).toBe(200)
  })
})

// ── CSRF cookie Secure flag ────────────────────────────────────────────────────

/** Get the raw Set-Cookie string for the named cookie. */
function getRawSetCookie(res: Response, name: string): string | undefined {
  for (const [header, value] of res.headers) {
    if (header.toLowerCase() !== 'set-cookie') continue
    const nameEncoded = encodeURIComponent(name)
    if (value.startsWith(`${nameEncoded}=`) || value.startsWith(`${name}=`)) return value
  }
  return undefined
}

describe('csrfPlugin — Secure flag', () => {
  test('default options → CSRF cookie has Secure flag', async () => {
    const app = createApp()
    const csrf = csrfPlugin()  // default secure: true
    app.onRequest(csrf.onRequest)
    app.onResponse(csrf.onResponse)
    app.get('/page', (ctx) => ctx.json({ ok: true }))

    const res = await app.fetch(new Request('http://localhost/page'))
    const raw = getRawSetCookie(res, 'csrf_token')
    expect(raw).toBeDefined()
    expect(raw).toContain('Secure')
  })

  test('secure: false → no Secure flag (for localhost dev)', async () => {
    const app = createApp()
    const csrf = csrfPlugin({ secure: false })
    app.onRequest(csrf.onRequest)
    app.onResponse(csrf.onResponse)
    app.get('/page', (ctx) => ctx.json({ ok: true }))

    const res = await app.fetch(new Request('http://localhost/page'))
    const raw = getRawSetCookie(res, 'csrf_token')
    expect(raw).toBeDefined()
    expect(raw).not.toContain('Secure')
  })
})
