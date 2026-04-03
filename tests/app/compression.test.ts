import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { compressionPlugin } from '../../packages/core/src/app/compression'

const LARGE_JSON = JSON.stringify({ data: 'x'.repeat(2000) })

function makeReq(path: string, accept = 'gzip, deflate'): Request {
  return new Request(`http://localhost${path}`, {
    headers: accept ? { 'Accept-Encoding': accept } : {},
  })
}

describe('compressionPlugin — gzip', () => {
  test('compresses large JSON response', async () => {
    const app = createApp()
    app.onResponse(compressionPlugin())
    app.get('/data', (ctx) => ctx.text(LARGE_JSON))

    const res = await app.fetch(makeReq('/data'))
    expect(res.headers.get('Content-Encoding')).toBe('gzip')
    expect(res.headers.get('Vary')).toContain('Accept-Encoding')
  })

  test('compressed body is smaller than original', async () => {
    const app = createApp()
    app.onResponse(compressionPlugin())
    app.get('/data', (ctx) => ctx.text(LARGE_JSON))

    const res = await app.fetch(makeReq('/data'))
    const buf = await res.arrayBuffer()
    // Compressed body must be smaller than the original text
    expect(buf.byteLength).toBeLessThan(LARGE_JSON.length)
  })

  test('sets Content-Length to compressed size', async () => {
    const app = createApp()
    app.onResponse(compressionPlugin())
    app.get('/data', (ctx) => ctx.text(LARGE_JSON))

    const res = await app.fetch(makeReq('/data'))
    const contentLength = res.headers.get('Content-Length')
    expect(contentLength).not.toBeNull()
    expect(Number(contentLength)).toBeLessThan(LARGE_JSON.length)
  })
})

describe('compressionPlugin — skip conditions', () => {
  test('skips when response is below threshold', async () => {
    const app = createApp()
    app.onResponse(compressionPlugin({ threshold: 10000 }))
    app.get('/small', (ctx) => ctx.text('hello'))

    const res = await app.fetch(makeReq('/small'))
    expect(res.headers.get('Content-Encoding')).toBeNull()
  })

  test('skips when client does not send Accept-Encoding', async () => {
    const app = createApp()
    app.onResponse(compressionPlugin())
    app.get('/data', (ctx) => ctx.text(LARGE_JSON))

    const res = await app.fetch(makeReq('/data', ''))
    expect(res.headers.get('Content-Encoding')).toBeNull()
  })

  test('skips for 204 No Content', async () => {
    const app = createApp()
    app.onResponse(compressionPlugin())
    app.delete('/item', () => new Response(null, { status: 204 }))

    const res = await app.fetch(new Request('http://localhost/item', { method: 'DELETE', headers: { 'Accept-Encoding': 'gzip' } }))
    expect(res.status).toBe(204)
    expect(res.headers.get('Content-Encoding')).toBeNull()
  })

  test('skips when Content-Encoding already set', async () => {
    const app = createApp()
    app.onResponse(compressionPlugin())
    app.get('/pre', () => new Response(LARGE_JSON, { headers: { 'Content-Encoding': 'br', 'Content-Type': 'application/json' } }))

    const res = await app.fetch(makeReq('/pre'))
    expect(res.headers.get('Content-Encoding')).toBe('br')
  })

  test('skips for SSE (text/event-stream)', async () => {
    const app = createApp()
    app.onResponse(compressionPlugin())
    app.get('/events', () => new Response('data: hello\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))

    const res = await app.fetch(makeReq('/events'))
    expect(res.headers.get('Content-Encoding')).toBeNull()
  })

  test('skips for binary content (image/png)', async () => {
    const app = createApp()
    app.onResponse(compressionPlugin())
    app.get('/img', () => new Response(new Uint8Array(2000), { headers: { 'Content-Type': 'image/png' } }))

    const res = await app.fetch(makeReq('/img'))
    expect(res.headers.get('Content-Encoding')).toBeNull()
  })
})

describe('compressionPlugin — deflate', () => {
  test('uses deflate when client only sends deflate', async () => {
    const app = createApp()
    app.onResponse(compressionPlugin({ encodings: ['deflate'] }))
    app.get('/data', (ctx) => ctx.text(LARGE_JSON))

    const res = await app.fetch(new Request('http://localhost/data', {
      headers: { 'Accept-Encoding': 'deflate' },
    }))
    expect(res.headers.get('Content-Encoding')).toBe('deflate')
  })
})

describe('compressionPlugin — custom options', () => {
  test('custom threshold respected', async () => {
    const app = createApp()
    // threshold of 5 bytes — even "hello" should be compressed
    app.onResponse(compressionPlugin({ threshold: 5 }))
    app.get('/small', (ctx) => ctx.text('hello world this is a long text'))

    const res = await app.fetch(makeReq('/small'))
    expect(res.headers.get('Content-Encoding')).toBe('gzip')
  })
})

describe('compressionPlugin — maxSize threshold', () => {
  test('response at exactly maxSize boundary → compressed', async () => {
    const app = createApp()
    // maxSize = 100 bytes, body = exactly 100 bytes → should compress (not above maxSize)
    const body = 'x'.repeat(100)
    app.onResponse(compressionPlugin({ threshold: 1, maxSize: 100 }))
    app.get('/data', (ctx) => ctx.text(body))

    const res = await app.fetch(makeReq('/data'))
    // body.byteLength === maxSize (not strictly greater), so compressed
    expect(res.headers.get('Content-Encoding')).toBe('gzip')
  })

  test('response above maxSize → NOT compressed (passthrough)', async () => {
    const app = createApp()
    // maxSize = 50 bytes, body = 100 bytes → should NOT compress
    const body = 'x'.repeat(100)
    app.onResponse(compressionPlugin({ threshold: 1, maxSize: 50 }))
    app.get('/data', (ctx) => ctx.text(body))

    const res = await app.fetch(makeReq('/data'))
    expect(res.headers.get('Content-Encoding')).toBeNull()
  })

  test('default maxSize (10MB) — normal responses are compressed', async () => {
    const app = createApp()
    const body = 'x'.repeat(2000)
    app.onResponse(compressionPlugin())
    app.get('/data', (ctx) => ctx.text(body))

    const res = await app.fetch(makeReq('/data'))
    // Normal response well under 10MB — should compress as usual
    expect(res.headers.get('Content-Encoding')).toBe('gzip')
  })
})
