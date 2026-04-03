import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'

// Helper: read a full SSE stream body as text
async function readSSE(res: Response): Promise<string> {
  return res.text()
}

describe('ctx.sse() — headers', () => {
  test('GET /events → Content-Type: text/event-stream', async () => {
    const app = createApp()
    app.get('/events', (ctx) =>
      ctx.sse(async (sse) => {
        await sse.event('ping', {})
      }),
    )

    const res = await app.fetch(new Request('http://localhost/events'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
  })

  test('sets Cache-Control: no-cache', async () => {
    const app = createApp()
    app.get('/events', (ctx) => ctx.sse(async (sse) => { await sse.comment() }))

    const res = await app.fetch(new Request('http://localhost/events'))
    expect(res.headers.get('Cache-Control')).toBe('no-cache')
  })

  test('sets Connection: keep-alive', async () => {
    const app = createApp()
    app.get('/events', (ctx) => ctx.sse(async (sse) => { await sse.comment() }))

    const res = await app.fetch(new Request('http://localhost/events'))
    expect(res.headers.get('Connection')).toBe('keep-alive')
  })
})

describe('ctx.sse() — wire format', () => {
  test('event() → "event: name\\ndata: json\\n\\n"', async () => {
    const app = createApp()
    app.get('/events', (ctx) =>
      ctx.sse(async (sse) => {
        await sse.event('connected', { userId: '42' })
      }),
    )

    const res = await app.fetch(new Request('http://localhost/events'))
    const body = await readSSE(res)
    expect(body).toContain('event: connected\n')
    expect(body).toContain('data: {"userId":"42"}\n\n')
  })

  test('data() → "data: json\\n\\n" (no event: line)', async () => {
    const app = createApp()
    app.get('/events', (ctx) =>
      ctx.sse(async (sse) => {
        await sse.data({ msg: 'hello' })
      }),
    )

    const res = await app.fetch(new Request('http://localhost/events'))
    const body = await readSSE(res)
    expect(body).toContain('data: {"msg":"hello"}\n\n')
    expect(body).not.toContain('event:')
  })

  test('comment() → ": text\\n\\n"', async () => {
    const app = createApp()
    app.get('/events', (ctx) =>
      ctx.sse(async (sse) => {
        await sse.comment('keepalive')
      }),
    )

    const res = await app.fetch(new Request('http://localhost/events'))
    const body = await readSSE(res)
    expect(body).toContain(': keepalive\n\n')
  })

  test('comment() without arg → ": \\n\\n"', async () => {
    const app = createApp()
    app.get('/events', (ctx) =>
      ctx.sse(async (sse) => {
        await sse.comment()
      }),
    )

    const res = await app.fetch(new Request('http://localhost/events'))
    const body = await readSSE(res)
    expect(body).toContain(': \n\n')
  })

  test('id() → "id: value\\n"', async () => {
    const app = createApp()
    app.get('/events', (ctx) =>
      ctx.sse(async (sse) => {
        await sse.id('evt-123')
      }),
    )

    const res = await app.fetch(new Request('http://localhost/events'))
    const body = await readSSE(res)
    expect(body).toContain('id: evt-123\n')
  })

  test('retry() → "retry: ms\\n"', async () => {
    const app = createApp()
    app.get('/events', (ctx) =>
      ctx.sse(async (sse) => {
        await sse.retry(3000)
      }),
    )

    const res = await app.fetch(new Request('http://localhost/events'))
    const body = await readSSE(res)
    expect(body).toContain('retry: 3000\n')
  })

  test('multiple events in order', async () => {
    const app = createApp()
    app.get('/events', (ctx) =>
      ctx.sse(async (sse) => {
        await sse.event('start', { n: 1 })
        await sse.event('update', { n: 2 })
        await sse.event('end', { n: 3 })
      }),
    )

    const res = await app.fetch(new Request('http://localhost/events'))
    const body = await readSSE(res)

    const startIdx  = body.indexOf('event: start')
    const updateIdx = body.indexOf('event: update')
    const endIdx    = body.indexOf('event: end')

    expect(startIdx).toBeGreaterThanOrEqual(0)
    expect(updateIdx).toBeGreaterThan(startIdx)
    expect(endIdx).toBeGreaterThan(updateIdx)
  })

  test('full SSE frame — event + id + data', async () => {
    const app = createApp()
    app.get('/events', (ctx) =>
      ctx.sse(async (sse) => {
        await sse.id('1')
        await sse.event('msg', { text: 'hi' })
      }),
    )

    const res = await app.fetch(new Request('http://localhost/events'))
    const body = await readSSE(res)
    expect(body).toContain('id: 1\n')
    expect(body).toContain('event: msg\n')
    expect(body).toContain('data: {"text":"hi"}\n\n')
  })
})
