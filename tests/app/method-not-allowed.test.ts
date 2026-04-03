import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'

describe('405 Method Not Allowed', () => {
  test('returns 405 when path matches but method does not', async () => {
    const app = createApp()
    app.get('/users', (ctx) => ctx.json({ users: [] }))

    const res = await app.fetch(new Request('http://localhost/users', { method: 'DELETE' }))
    expect(res.status).toBe(405)
  })

  test('405 response includes Allow header', async () => {
    const app = createApp()
    app.get('/users', (ctx) => ctx.json({}))
    app.post('/users', (ctx) => ctx.json({}))

    const res = await app.fetch(new Request('http://localhost/users', { method: 'DELETE' }))
    const allow = res.headers.get('Allow') ?? ''
    expect(allow).toContain('GET')
    expect(allow).toContain('POST')
  })

  test('Allow header contains all registered methods for the path', async () => {
    const app = createApp()
    app.get('/items', (ctx) => ctx.json({}))
    app.post('/items', (ctx) => ctx.json({}))
    app.put('/items', (ctx) => ctx.json({}))

    const res = await app.fetch(new Request('http://localhost/items', { method: 'DELETE' }))
    expect(res.status).toBe(405)
    const allow = res.headers.get('Allow') ?? ''
    expect(allow).toContain('GET')
    expect(allow).toContain('POST')
    expect(allow).toContain('PUT')
  })

  test('unknown path still returns 404', async () => {
    const app = createApp()
    app.get('/users', (ctx) => ctx.json({}))

    const res = await app.fetch(new Request('http://localhost/nonexistent', { method: 'POST' }))
    expect(res.status).toBe(404)
  })

  test('correct method on matching path returns 200', async () => {
    const app = createApp()
    app.get('/ping', (ctx) => ctx.json({ ok: true }))

    const res = await app.fetch(new Request('http://localhost/ping'))
    expect(res.status).toBe(200)
  })

  test('405 with param routes', async () => {
    const app = createApp()
    app.get('/users/:id', (ctx) => ctx.json({ id: ctx.params.id }))

    const res = await app.fetch(new Request('http://localhost/users/42', { method: 'DELETE' }))
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toContain('GET')
  })

  test('onResponse hooks still run on 405', async () => {
    const app = createApp()
    app.get('/users', (ctx) => ctx.json({}))

    let hookRan = false
    app.onResponse({
      _phase: 'onResponse',
      _fn: async (_ctx, _res) => { hookRan = true },
    })

    const res = await app.fetch(new Request('http://localhost/users', { method: 'PATCH' }))
    expect(res.status).toBe(405)
    expect(hookRan).toBe(true)
  })
})

describe('cookie.delete() — Secure flag', () => {
  test('cookie.delete() includes Secure flag', async () => {
    const app = createApp()
    app.get('/logout', (ctx) => {
      ctx.cookie.delete('session')
      return ctx.json({ ok: true })
    })

    const res = await app.fetch(new Request('http://localhost/logout'))
    const setCookie = res.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain('Max-Age=0')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('HttpOnly')
  })
})
