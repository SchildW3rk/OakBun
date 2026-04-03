import { describe, test, expect } from 'bun:test'
import { betterAuthPlugin } from '../src/plugin.js'
import { SQLiteAdapter } from '../../../packages/core/src/adapter/sqlite'

function makePlugin() {
  const adapter = new SQLiteAdapter()
  return betterAuthPlugin(
    { secret: 'test-secret-at-least-32-chars-long!!', baseUrl: 'http://localhost' },
    adapter,
  )
}

function makeBaseCtx(req: Request) {
  return {
    req,
    params: {},
    query: {},
    json: <T>(data: T, status = 200) => Response.json(data, { status }),
    text: (data: string, status = 200) => new Response(data, { status }),
    html: (data: string, status = 200) => new Response(data, { status }),
    stream: () => new Response('stream'),
    sse: () => new Response('sse'),
    cookie: { get: () => null, set: () => {}, delete: () => {} } as never,
    emit: () => {},
  }
}

describe('betterAuthPlugin', () => {
  test('plugin has name "betterAuth"', () => {
    const plugin = makePlugin()
    expect(plugin.name).toBe('betterAuth')
  })

  test('request() sets ctx.betterUser = null when no session cookie', async () => {
    const plugin = makePlugin()
    const ctx = makeBaseCtx(new Request('http://localhost/api/data'))
    const result = await plugin.request(ctx as never)
    expect(result.betterUser).toBeNull()
  })

  test('request() sets ctx.session = null when no session cookie', async () => {
    const plugin = makePlugin()
    const ctx = makeBaseCtx(new Request('http://localhost/api/data'))
    const result = await plugin.request(ctx as never)
    expect(result.session).toBeNull()
  })

  test('request() adds ctx.auth instance', async () => {
    const plugin = makePlugin()
    const ctx = makeBaseCtx(new Request('http://localhost/api/data'))
    const result = await plugin.request(ctx as never)
    expect(result.auth).toBeDefined()
    expect(typeof result.auth.handler).toBe('function')
  })

  test('plugin has no install hook', () => {
    const plugin = makePlugin()
    // install is optional — betterAuthPlugin does not need a HookExecutor
    expect(plugin.install).toBeUndefined()
  })
})
