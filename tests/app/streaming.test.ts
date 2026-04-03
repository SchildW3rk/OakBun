import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'

describe('ctx.stream() — basic usage', () => {
  test('returns a streaming Response', async () => {
    const app = createApp()
    app.get('/stream', (ctx) =>
      ctx.stream((s) => {
        s.send('hello')
        s.send(' world')
        s.close()
      }),
    )

    const res = await app.fetch(new Request('http://localhost/stream'))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toBe('hello world')
  })

  test('default Content-Type is text/plain', async () => {
    const app = createApp()
    app.get('/stream', (ctx) =>
      ctx.stream((s) => { s.send('hi'); s.close() }),
    )

    const res = await app.fetch(new Request('http://localhost/stream'))
    expect(res.headers.get('Content-Type')).toContain('text/plain')
  })

  test('custom contentType option is set', async () => {
    const app = createApp()
    app.get('/sse', (ctx) =>
      ctx.stream(
        (s) => { s.send('data: test\n\n'); s.close() },
        { contentType: 'text/event-stream' },
      ),
    )

    const res = await app.fetch(new Request('http://localhost/sse'))
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
  })

  test('custom status code', async () => {
    const app = createApp()
    app.get('/stream', (ctx) =>
      ctx.stream((s) => { s.send('ok'); s.close() }, { status: 202 }),
    )

    const res = await app.fetch(new Request('http://localhost/stream'))
    expect(res.status).toBe(202)
  })

  test('custom headers are forwarded', async () => {
    const app = createApp()
    app.get('/stream', (ctx) =>
      ctx.stream(
        (s) => { s.send('ok'); s.close() },
        { headers: { 'X-Custom': 'value' } },
      ),
    )

    const res = await app.fetch(new Request('http://localhost/stream'))
    expect(res.headers.get('X-Custom')).toBe('value')
  })

  test('Uint8Array chunks are sent correctly', async () => {
    const app = createApp()
    const enc = new TextEncoder()
    app.get('/stream', (ctx) =>
      ctx.stream((s) => {
        s.send(enc.encode('bytes'))
        s.close()
      }),
    )

    const res = await app.fetch(new Request('http://localhost/stream'))
    const text = await res.text()
    expect(text).toBe('bytes')
  })

  test('async writer — await between sends', async () => {
    const app = createApp()
    app.get('/stream', (ctx) =>
      ctx.stream(async (s) => {
        s.send('a')
        await Promise.resolve()
        s.send('b')
        s.close()
      }),
    )

    const res = await app.fetch(new Request('http://localhost/stream'))
    const text = await res.text()
    expect(text).toBe('ab')
  })

  test('SSE format — multiple events', async () => {
    const app = createApp()
    app.get('/events', (ctx) =>
      ctx.stream(
        (s) => {
          s.send('data: one\n\n')
          s.send('data: two\n\n')
          s.close()
        },
        { contentType: 'text/event-stream' },
      ),
    )

    const res = await app.fetch(new Request('http://localhost/events'))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('data: one')
    expect(text).toContain('data: two')
  })
})

describe('ctx.stream() — error handling', () => {
  test('error in writer does not crash the server', async () => {
    const app = createApp()
    app.get('/stream', (ctx) =>
      ctx.stream(async (s) => {
        s.send('before')
        throw new Error('writer error')
      }),
    )

    // Should still get a response (stream closed on error)
    const res = await app.fetch(new Request('http://localhost/stream'))
    expect(res.status).toBe(200)
  })
})
