import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createApp } from '../../core/src/app/index'
import { defineModule } from '../../core/src/app/module'
import { jwtPlugin, signJwt } from '../../jwt/src/index'
import { createWsAdapter } from '../src/index'
import '../src/module-augment'  // side-effect: enables defineModule().ws()
import { z } from 'zod'

const SECRET = 'ws-test-secret-for-oakbun-ok!!!!!!'

// ── Helpers ─────────────────────────────────────────────────────────────────

async function makeToken(payload: Record<string, unknown> = {}): Promise<string> {
  return signJwt({ sub: 'ws-user', exp: Math.floor(Date.now() / 1000) + 3600, ...payload }, SECRET)
}

/** Open a WebSocket to a live server, collect messages, then close. */
function wsConnect(
  port: number,
  path: string,
  options: {
    headers?: Record<string, string>
    onOpen?:  (ws: WebSocket) => void
    timeoutMs?: number
  } = {},
): Promise<{ messages: (string | ArrayBuffer)[]; closeCode: number }> {
  return new Promise((resolve, reject) => {
    const messages: (string | ArrayBuffer)[] = []
    const url = `ws://localhost:${port}${path}`
    const ws = new WebSocket(url, undefined)

    const timer = setTimeout(() => {
      ws.close()
      reject(new Error(`WS test timeout after ${options.timeoutMs ?? 2000}ms`))
    }, options.timeoutMs ?? 2000)

    ws.onopen = () => {
      clearTimeout(timer)
      options.onOpen?.(ws)
    }

    ws.onmessage = (e) => {
      messages.push(e.data)
    }

    ws.onclose = (e) => {
      resolve({ messages, closeCode: e.code })
    }

    ws.onerror = (e) => {
      reject(new Error(`WebSocket error: ${String(e)}`))
    }
  })
}

// ── 1. Route registration ─────────────────────────────────────────────────────

describe('ws() — route registration', () => {
  test('wsAdapter.route() registers a route', () => {
    const app = createApp()
    const ws = createWsAdapter()
    app.registerWsAdapter(ws)
    ws.route('/chat', {
      open(ctx) { ctx.ws.send('hello') },
    })
    expect(ws.getRoute('/chat')).toBeDefined()
  })

  test('module .ws() registers route with prefix via register()', () => {
    const app = createApp()
    const ws = createWsAdapter()
    app.registerWsAdapter(ws)
    const mod = defineModule('/api')
      .ws('/chat', { open(ctx) { ctx.ws.send('hi') } })
      .build()
    app.register(mod)
    expect(ws.getRoute('/api/chat')).toBeDefined()
  })

  test('module .ws() is registered when adapter is attached after module registration', () => {
    const app = createApp()
    const mod = defineModule('/api')
      .ws('/chat', { open(ctx) { ctx.ws.send('hi') } })
      .build()
    app.register(mod)

    const ws = createWsAdapter()
    app.registerWsAdapter(ws)

    expect(ws.getRoute('/api/chat')).toBeDefined()
  })

  test('WS routes do not appear in HTTP routes array', () => {
    const app = createApp()
    const ws = createWsAdapter()
    app.registerWsAdapter(ws)
    ws.route('/chat', { open(ctx) { ctx.ws.send('hi') } })
    expect(app.routes.some((r) => r.path === '/chat')).toBe(false)
  })

  test('schema handler is normalised — messageSchema stored on route', () => {
    const app = createApp()
    const ws = createWsAdapter()
    app.registerWsAdapter(ws)
    const schema = z.object({ text: z.string() })
    ws.route('/chat', {
      message:  schema,
      handlers: { message(ctx) { ctx.ws.send((ctx.data as { text: string }).text) } },
    })
    const route = ws.getRoute('/chat')
    expect(route?.messageSchema).toBe(schema)
  })

  test('plain handler — no messageSchema', () => {
    const app = createApp()
    const ws = createWsAdapter()
    app.registerWsAdapter(ws)
    ws.route('/chat', { message(ctx, raw) { ctx.ws.send(raw) } })
    const route = ws.getRoute('/chat')
    expect(route?.messageSchema).toBeUndefined()
  })
})

// ── 2. HTTP upgrade request — fetch() without server → 404 on WS paths ───────

describe('ws() — fetch() without server (test client path)', () => {
  test('non-upgrade HTTP request to WS path → 404', async () => {
    const app = createApp()
    const ws = createWsAdapter()
    app.registerWsAdapter(ws)
    ws.route('/chat', { open(ctx) { ctx.ws.send('hi') } })
    const res = await app.fetch(new Request('http://localhost/chat'))
    // No Upgrade header → falls through to HTTP 404 (no matching HTTP route)
    expect(res.status).toBe(404)
  })

  test('upgrade request without server → upgrade block skipped, returns 404', async () => {
    const app = createApp()
    const ws = createWsAdapter()
    app.registerWsAdapter(ws)
    ws.route('/chat', { open(ctx) { ctx.ws.send('hi') } })
    const res = await app.fetch(new Request('http://localhost/chat', {
      headers: { Upgrade: 'websocket' },
    }))
    // server is undefined → WS block is skipped, falls through to HTTP 404
    expect(res.status).toBe(404)
  })
})

// ── 3. Live server integration ────────────────────────────────────────────────

describe('ws() — live server integration', () => {
  let port: number
  let server: ReturnType<typeof Bun.serve>

  beforeAll(() => {
    port = 40_200 + Math.floor(Math.random() * 1000)
    const app = createApp()
    const ws = createWsAdapter()
    app.registerWsAdapter(ws)

    ws.route('/echo', {
      message(ctx, raw) {
        ctx.ws.send(raw as string)
      },
    })

    ws.route('/greet', {
      open(ctx) {
        ctx.ws.send('welcome')
      },
    })

    ws.route('/rooms/:id', {
      open(ctx) {
        ctx.ws.send(`room:${ctx.params.id}`)
      },
    })

    ws.route('/validated', {
      message:  z.object({ msg: z.string() }),
      handlers: {
        message(ctx) {
          ctx.ws.send(`got:${(ctx.data as { msg: string }).msg}`)
        },
      },
    })

    ws.route('/close-test', {
      open(ctx) {
        ctx.ws.close(1000, 'bye')
      },
    })

    server = app.listen(port)
  })

  afterAll(() => {
    server.stop(true)
  })

  test('echo — sends message back', async () => {
    const { messages } = await wsConnect(port, '/echo', {
      onOpen(ws) {
        ws.send('hello world')
        setTimeout(() => ws.close(), 50)
      },
    })
    expect(messages[0]).toBe('hello world')
  })

  test('open handler fires and sends greeting', async () => {
    const { messages } = await wsConnect(port, '/greet', {
      onOpen(ws) {
        setTimeout(() => ws.close(), 100)
      },
    })
    expect(messages[0]).toBe('welcome')
  })

  test('path params available in open handler', async () => {
    const { messages } = await wsConnect(port, '/rooms/42', {
      onOpen(ws) {
        setTimeout(() => ws.close(), 100)
      },
    })
    expect(messages[0]).toBe('room:42')
  })

  test('validated message schema — valid payload → handler receives typed data', async () => {
    const { messages } = await wsConnect(port, '/validated', {
      onOpen(ws) {
        ws.send(JSON.stringify({ msg: 'hey' }))
        setTimeout(() => ws.close(), 100)
      },
    })
    expect(messages[0]).toBe('got:hey')
  })

  test('validated message schema — invalid JSON → WS_PARSE_ERROR', async () => {
    const { messages } = await wsConnect(port, '/validated', {
      onOpen(ws) {
        ws.send('not-json-at-all{{{')
        setTimeout(() => ws.close(), 100)
      },
    })
    const body = JSON.parse(messages[0] as string)
    expect(body.code).toBe('WS_PARSE_ERROR')
    expect(body.error).toBe('WS_PARSE_ERROR')
  })

  test('validated message schema — valid JSON but wrong structure → VALIDATION_ERROR', async () => {
    const { messages } = await wsConnect(port, '/validated', {
      onOpen(ws) {
        ws.send(JSON.stringify({ notMsg: true }))
        setTimeout(() => ws.close(), 100)
      },
    })
    const body = JSON.parse(messages[0] as string)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.error).toBe('VALIDATION_ERROR')
    expect(body.issues).toBeDefined()
  })

  test('WS_PARSE_ERROR and VALIDATION_ERROR are distinct codes', async () => {
    const [parseResult, validationResult] = await Promise.all([
      wsConnect(port, '/validated', {
        onOpen(ws) { ws.send('{{bad json'); setTimeout(() => ws.close(), 100) },
      }),
      wsConnect(port, '/validated', {
        onOpen(ws) { ws.send('{"wrong":true}'); setTimeout(() => ws.close(), 100) },
      }),
    ])
    const parseBody      = JSON.parse(parseResult.messages[0] as string)
    const validationBody = JSON.parse(validationResult.messages[0] as string)
    expect(parseBody.code).toBe('WS_PARSE_ERROR')
    expect(validationBody.code).toBe('VALIDATION_ERROR')
    expect(parseBody.code).not.toBe(validationBody.code)
  })

  test('close handler — server initiates close → client receives close code 1000', async () => {
    const { closeCode } = await wsConnect(port, '/close-test', {
      onOpen(_ws) { /* server closes immediately */ },
    })
    expect(closeCode).toBe(1000)
  })

  test('unknown WS path → 404', async () => {
    const res = await fetch(`http://localhost:${port}/not-a-ws-route`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    })
    expect(res.status).toBe(404)
  })
})

// ── 4. JWT plugin on WS — upgrade blocked when token missing ─────────────────

describe('ws() — jwtPlugin integration', () => {
  let port: number
  let server: ReturnType<typeof Bun.serve>

  beforeAll(() => {
    port = 41_200 + Math.floor(Math.random() * 1000)
    const app = createApp()
    const wsA = createWsAdapter()
    app.registerWsAdapter(wsA)
    app.plugin(jwtPlugin(SECRET))

    wsA.route('/secure', {
      open(ctx) {
        ctx.ws.send(JSON.stringify({ sub: ctx.user?.sub ?? 'none' }))
      },
    })

    server = app.listen(port)
  })

  afterAll(() => {
    server.stop(true)
  })

  test('missing token → HTTP 401 during upgrade (plugin blocks before WS handshake)', async () => {
    const res = await fetch(`http://localhost:${port}/secure`, {
      headers: {
        Upgrade:    'websocket',
        Connection: 'Upgrade',
      },
    })
    expect(res.status).toBe(401)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('TOKEN_INVALID')
  })

  test('ctx.user is typed as AuthPayload | undefined on WsCtx', () => {
    const app = createApp()
    const ws = createWsAdapter()
    app.registerWsAdapter(ws)
    app.plugin(jwtPlugin(SECRET))
    ws.route('/typed', {
      open(ctx) {
        const _sub: string | undefined = ctx.user?.sub
        ctx.ws.send(_sub ?? '')
      },
    })
    expect(true).toBe(true)
  })
})

// ── 5. Module-scoped WS ───────────────────────────────────────────────────────

describe('ws() — module-scoped', () => {
  let port: number
  let server: ReturnType<typeof Bun.serve>

  beforeAll(() => {
    port = 42_200 + Math.floor(Math.random() * 1000)
    const app = createApp()
    const ws = createWsAdapter()
    app.registerWsAdapter(ws)

    // HTTP route — unaffected by WS module
    app.get('/http-only', (ctx) => ctx.json({ ok: true }))

    const mod = defineModule('/api')
      .ws('/chat', {
        open(ctx) { ctx.ws.send('module-chat') },
      })
      .build()
    app.register(mod)

    server = app.listen(port)
  })

  afterAll(() => {
    server.stop(true)
  })

  test('module WS route accessible at prefixed path', async () => {
    const { messages } = await wsConnect(port, '/api/chat', {
      onOpen(ws) {
        setTimeout(() => ws.close(), 100)
      },
    })
    expect(messages[0]).toBe('module-chat')
  })

  test('HTTP route unaffected by WS module', async () => {
    const res = await fetch(`http://localhost:${port}/http-only`)
    expect(res.status).toBe(200)
  })

  test('WS route without prefix → 404', async () => {
    const res = await fetch(`http://localhost:${port}/chat`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    })
    expect(res.status).toBe(404)
  })
})
