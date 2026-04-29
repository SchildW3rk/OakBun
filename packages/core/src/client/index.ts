export { createProxyClient, createModuleClient, pathToClientKey } from './proxy'
export type { ClientResult, InferProxyClient, ProxyClientOptions } from './proxy'
export { createTestClient }          from './test-client'
export type { TestClientOptions }    from './test-client'

import type { RouteMap, RouteEntry } from '../app/types'
import type { ZodTypeAny } from 'zod'
import { OakBunClientError } from './error'
export { OakBunClientError } from './error'

// Helper types — all eager, no conditional on generic parameter
type RouteResponse<TEntry extends RouteEntry> =
  TEntry['response'] extends ZodTypeAny ? import('zod').infer<TEntry['response']> : unknown

type RouteBody<TEntry extends RouteEntry> =
  TEntry['body'] extends ZodTypeAny ? import('zod').infer<TEntry['body']> : never

type RouteParams<TEntry extends RouteEntry> =
  TEntry['params'] extends ZodTypeAny ? import('zod').infer<TEntry['params']> : never

type RouteQuery<TEntry extends RouteEntry> =
  TEntry['query'] extends ZodTypeAny ? import('zod').infer<TEntry['query']> : never

type ClientOptions<TEntry extends RouteEntry> = {
  params?:  RouteParams<TEntry>
  query?:   RouteQuery<TEntry>
  body?:    RouteBody<TEntry>
  headers?: Record<string, string>
}

// Strip 'METHOD ' prefix from a route key to get just the path.
// 'POST /items' → '/items'
type StripMethod<M extends string, K extends string> =
  K extends `${M} ${infer P}` ? P : never

type OakBunClient<TRoutes extends RouteMap> = {
  get<P extends StripMethod<'GET', Extract<keyof TRoutes, `GET /${string}`>>>(
    path: P,
    options?: ClientOptions<TRoutes[`GET ${P}`]>,
  ): Promise<RouteResponse<TRoutes[`GET ${P}`]>>

  post<P extends StripMethod<'POST', Extract<keyof TRoutes, `POST /${string}`>>>(
    path: P,
    options?: ClientOptions<TRoutes[`POST ${P}`]>,
  ): Promise<RouteResponse<TRoutes[`POST ${P}`]>>

  put<P extends StripMethod<'PUT', Extract<keyof TRoutes, `PUT /${string}`>>>(
    path: P,
    options?: ClientOptions<TRoutes[`PUT ${P}`]>,
  ): Promise<RouteResponse<TRoutes[`PUT ${P}`]>>

  patch<P extends StripMethod<'PATCH', Extract<keyof TRoutes, `PATCH /${string}`>>>(
    path: P,
    options?: ClientOptions<TRoutes[`PATCH ${P}`]>,
  ): Promise<RouteResponse<TRoutes[`PATCH ${P}`]>>

  delete<P extends StripMethod<'DELETE', Extract<keyof TRoutes, `DELETE /${string}`>>>(
    path: P,
    options?: ClientOptions<TRoutes[`DELETE ${P}`]>,
  ): Promise<RouteResponse<TRoutes[`DELETE ${P}`]>>
}

type ExtractRoutes<TApp> = TApp extends { readonly _routes: infer R } ? R : never

function substitutePath(path: string, params?: Record<string, unknown>): string {
  if (!params) return path
  return path.replace(/:([^/]+)/g, (_, key) => String(params[key as string] ?? `:${key}`))
}

// FetchFn — accepts either globalThis.fetch or app.fetch (which only takes Request)
type FetchFn = (input: Request) => Promise<Response>

export function createClient<TApp>(
  baseUrl: string,
  options?: { fetch?: FetchFn },
): OakBunClient<ExtractRoutes<TApp> extends RouteMap ? ExtractRoutes<TApp> : Record<never, never>> {
  const fetchFn: FetchFn = options?.fetch ?? ((req) => globalThis.fetch(req))

  async function request(method: string, path: string, opts?: ClientOptions<RouteEntry>): Promise<unknown> {
    // Extract HTTP method from path key (e.g. "GET /users/:id" → path "/users/:id")
    // The path argument here is already just the path portion (e.g. "/users/:id")
    const substituted = substitutePath(path, opts?.params as Record<string, unknown> | undefined)

    let url = baseUrl.replace(/\/$/, '') + substituted

    // Append query params for GET/DELETE
    if (opts?.query && (method === 'GET' || method === 'DELETE')) {
      const qs = new URLSearchParams(opts.query as Record<string, string>).toString()
      if (qs) url += '?' + qs
    }

    const headers: Record<string, string> = { ...opts?.headers }
    let body: string | undefined

    if (opts?.body !== undefined && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      body = JSON.stringify(opts.body)
      headers['Content-Type'] = 'application/json'
    }

    const res = await fetchFn(new Request(url, { method, headers, body }))

    if (!res.ok) {
      if (res.status === 422) {
        let issues: import('zod').ZodIssue[] | undefined
        try {
          const data = await res.json() as { issues?: import('zod').ZodIssue[] }
          issues = data.issues
        } catch {
          // ignore parse error
        }
        throw new OakBunClientError(res.status, 'VALIDATION_ERROR', 'Validation failed', issues)
      }
      throw new OakBunClientError(res.status, `HTTP_${res.status}`, `HTTP ${res.status}`)
    }

    // Parse JSON response
    try {
      return await res.json()
    } catch {
      return undefined
    }
  }

  return {
    get:    (path, opts) => request('GET',    path as string, opts as ClientOptions<RouteEntry>),
    post:   (path, opts) => request('POST',   path as string, opts as ClientOptions<RouteEntry>),
    put:    (path, opts) => request('PUT',    path as string, opts as ClientOptions<RouteEntry>),
    patch:  (path, opts) => request('PATCH',  path as string, opts as ClientOptions<RouteEntry>),
    delete: (path, opts) => request('DELETE', path as string, opts as ClientOptions<RouteEntry>),
  } as OakBunClient<ExtractRoutes<TApp> extends RouteMap ? ExtractRoutes<TApp> : Record<never, never>>
}
