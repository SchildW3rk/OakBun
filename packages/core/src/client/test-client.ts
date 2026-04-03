import { createProxyClient } from './proxy'
import type { InferProxyClient, ProxyClientOptions } from './proxy'

export interface TestClientOptions extends Omit<ProxyClientOptions, 'fetch'> {
  /** Base URL for constructing request URLs. Defaults to 'http://localhost'. */
  baseUrl?: string
}

/**
 * createTestClient — type-safe test client that calls app.fetch() directly.
 *
 * Identical API to createProxyClient but requires no running HTTP server.
 * Returns InferProxyClient<TApp> — the same fully-typed client as the production proxy.
 *
 * Usage:
 *   const client = createTestClient(app)
 *   const result = await client.apiUsers.index()
 *   expect(result.ok).toBe(true)
 *
 * app.fetch() needs a valid URL to parse pathname/query from,
 * so requests are constructed as 'http://localhost/path' by default.
 */
export function createTestClient<
  TApp extends {
    fetch: (req: Request) => Promise<Response>
    routes: Array<{ method: string; path: string; _module?: { prefix: string } | null }>
  }
>(
  app: TApp,
  options?: TestClientOptions,
): InferProxyClient<TApp> {
  const { baseUrl = 'http://localhost', ...rest } = options ?? {}
  return createProxyClient(app, baseUrl, {
    ...rest,
    fetch: (req: Request) => app.fetch(req),
  })
}
