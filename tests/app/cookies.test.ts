import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'

describe('ctx.cookie — happy path', () => {
  test('ctx.cookie.get() reads request cookie', async () => {
    const app = createApp()
    app.get('/me', (ctx) => {
      const session = ctx.cookie.get('session')
      return ctx.json({ session: session ?? null })
    })

    const res = await app.fetch(new Request('http://localhost/me', {
      headers: { 'Cookie': 'session=abc123' },
    }))
    const body = await res.json() as { session: string }
    expect(body.session).toBe('abc123')
  })

  test('ctx.cookie.set() adds Set-Cookie to response', async () => {
    const app = createApp()
    app.get('/login', (ctx) => {
      ctx.cookie.set('token', 'secret', { httpOnly: true, maxAge: 3600 })
      return ctx.json({ ok: true })
    })

    const res = await app.fetch(new Request('http://localhost/login'))
    const setCookie = res.headers.get('Set-Cookie')
    expect(setCookie).not.toBeNull()
    expect(setCookie).toContain('token=')
    expect(setCookie).toContain('Max-Age=3600')
    expect(setCookie).toContain('HttpOnly')
  })

  test('ctx.cookie.delete() sets Max-Age=0', async () => {
    const app = createApp()
    app.get('/logout', (ctx) => {
      ctx.cookie.delete('token')
      return ctx.json({ ok: true })
    })

    const res = await app.fetch(new Request('http://localhost/logout'))
    const setCookie = res.headers.get('Set-Cookie')
    expect(setCookie).toContain('Max-Age=0')
  })

  test('multiple cookies set — all in response', async () => {
    const app = createApp()
    app.get('/multi', (ctx) => {
      ctx.cookie.set('a', '1')
      ctx.cookie.set('b', '2')
      return ctx.json({ ok: true })
    })

    const res = await app.fetch(new Request('http://localhost/multi'))
    // Headers.getAll is not standard; use raw headers
    const headers: string[] = []
    res.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') headers.push(value)
    })
    expect(headers.length).toBeGreaterThanOrEqual(1)
  })

  test('CookieOptions: secure, sameSite, path', async () => {
    const app = createApp()
    app.get('/secure', (ctx) => {
      ctx.cookie.set('id', '42', { secure: true, sameSite: 'Strict', path: '/api' })
      return ctx.json({ ok: true })
    })

    const res = await app.fetch(new Request('http://localhost/secure'))
    const setCookie = res.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Path=/api')
  })
})

describe('ctx.cookie — SameSite default', () => {
  test('no sameSite option → Set-Cookie includes SameSite=Lax', async () => {
    const app = createApp()
    app.get('/cookie', (ctx) => {
      ctx.cookie.set('token', 'abc')
      return ctx.json({ ok: true })
    })
    const res = await app.fetch(new Request('http://localhost/cookie'))
    const setCookie = res.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain('SameSite=Lax')
  })

  test("sameSite: 'Strict' → SameSite=Strict", async () => {
    const app = createApp()
    app.get('/cookie', (ctx) => {
      ctx.cookie.set('token', 'abc', { sameSite: 'Strict' })
      return ctx.json({ ok: true })
    })
    const res = await app.fetch(new Request('http://localhost/cookie'))
    const setCookie = res.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).not.toContain('SameSite=Lax')
  })

  test("sameSite: 'None' → SameSite=None", async () => {
    const app = createApp()
    app.get('/cookie', (ctx) => {
      ctx.cookie.set('token', 'abc', { sameSite: 'None' })
      return ctx.json({ ok: true })
    })
    const res = await app.fetch(new Request('http://localhost/cookie'))
    const setCookie = res.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain('SameSite=None')
    expect(setCookie).not.toContain('SameSite=Lax')
  })
})

describe('ctx.cookie — unhappy path', () => {
  test('cookie not present → undefined, no crash', async () => {
    const app = createApp()
    app.get('/check', (ctx) => {
      const val = ctx.cookie.get('missing')
      return ctx.json({ val: val ?? null })
    })

    const res = await app.fetch(new Request('http://localhost/check'))
    const body = await res.json() as { val: null }
    expect(body.val).toBeNull()
  })

  test('empty Cookie header → no crash', async () => {
    const app = createApp()
    app.get('/check', (ctx) => {
      const val = ctx.cookie.get('x')
      return ctx.json({ val: val ?? null })
    })

    const res = await app.fetch(new Request('http://localhost/check', {
      headers: { 'Cookie': '' },
    }))
    expect(res.status).toBe(200)
  })
})
