import type { RouteMap, RouteEntry } from '../app/types'
import type { ZodTypeAny } from 'zod'
import { VelnClientError } from './error'

// ── Type utilities ─────────────────────────────────────────────────────────────

// Response type — only if `response:` schema is defined, otherwise unknown
type RouteResponseType<TEntry extends RouteEntry> =
  TEntry['response'] extends ZodTypeAny ? import('zod').infer<TEntry['response']> : unknown

// ClientResult — discriminated union so callers must check ok before accessing data
export type ClientResult<T> =
  | { ok: true;  data: T;   status: number }
  | { ok: false; error: VelnClientError; status: number; code: string; message: string }

// ── Path → client key conversion ──────────────────────────────────────────────

export function pathToClientKey(prefix: string): string {
  // '/api/users' → 'apiUsers', '/blog-posts' → 'blogPosts', '/v1/orders' → 'v1Orders'
  return prefix
    .replace(/^\//, '')              // strip leading slash
    .split(/[\/\-]/)                 // split on / and -
    .filter(Boolean)
    .map((part, i) => i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

// ── Path → method name conversion ─────────────────────────────────────────────

// Converts a (HTTP method, path-suffix) pair into a camelCase method name.
// 'GET', '/'         → 'index'
// 'GET', '/:id'      → 'show'
// 'POST', '/'        → 'store'
// 'PATCH', '/:id'    → 'update'
// 'DELETE', '/:id'   → 'destroy'
// 'GET', '/export'   → 'getExport'
// 'POST', '/:id/publish' → 'postByIdPublish'
function pathToMethodName(method: string, suffix: string): string {
  const m = method.toLowerCase()
  // Normalise suffix — strip leading slash
  const s = suffix.replace(/^\//, '')

  // CRUD shorthands
  if (s === '' || s === '/') {
    if (m === 'get')    return 'index'
    if (m === 'post')   return 'store'
  }
  if (/^:([^/]+)$/.test(s)) {
    if (m === 'get')    return 'show'
    if (m === 'patch')  return 'update'
    if (m === 'delete') return 'destroy'
  }

  // Custom routes — method + path-segments as camelCase
  const segments = s.split('/').filter(Boolean).map((seg) =>
    seg.startsWith(':') ? 'By' + seg.slice(1).charAt(0).toUpperCase() + seg.slice(2) : seg,
  )
  const body = segments
    .map((seg, i) => i === 0 ? seg : seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('')
  return m + body.charAt(0).toUpperCase() + body.slice(1)
}

// ── Type-level per-module client ───────────────────────────────────────────────
//
// Approach: per-module types keep each resolution step small.
// Each `ModuleRoutes` is a sub-map of routes that share a prefix —
// TS only traverses the slice it needs, not all routes at once.

// Extract routes whose keys start with a given prefix
type ExtractModuleRoutes<TRoutes extends RouteMap, TPrefix extends string> = {
  [K in Extract<keyof TRoutes, `${string} ${TPrefix}${string}`>]: TRoutes[K]
}

// Suffix after the prefix — e.g. 'GET /users/:id' with prefix '/users' → '/:id'
type SuffixAfterPrefix<K extends string, TPrefix extends string> =
  K extends `${infer _Method} ${TPrefix}${infer Suffix}` ? Suffix : never

// Infer the method name for a given route key
type MethodOf<K extends string> =
  K extends `GET ${string}`    ? 'get'    :
  K extends `POST ${string}`   ? 'post'   :
  K extends `PATCH ${string}`  ? 'patch'  :
  K extends `DELETE ${string}` ? 'delete' :
  K extends `PUT ${string}`    ? 'put'    :
  never

// Build one method entry for a route key
// Returns args as tuple — params before body, then optional request options
// Note: use [never] extends [TRoutes[K]['body']] to avoid distributing over union,
// and exclude `never` (the no-body default) from triggering the body branch.
type HasBody<TEntry extends RouteEntry> =
  [TEntry['body']] extends [never] ? false :
  [TEntry['body']] extends [ZodTypeAny] ? true : false

type MethodEntry<TRoutes extends RouteMap, K extends keyof TRoutes & string, TPrefix extends string> =
  HasBody<TRoutes[K] & RouteEntry> extends true
    ? (
        ...args: [
          body: import('zod').infer<TRoutes[K]['body'] & ZodTypeAny>,
          options?: { headers?: Record<string, string>; query?: Record<string, string> },
        ]
      ) => Promise<ClientResult<RouteResponseType<TRoutes[K] & RouteEntry>>>
    : SuffixAfterPrefix<K, TPrefix> extends `/${':'}${string}` | `${string}/${':'}${string}`
      ? (
          ...args: [
            id: number | string,
            options?: { headers?: Record<string, string>; query?: Record<string, string> },
          ]
        ) => Promise<ClientResult<RouteResponseType<TRoutes[K] & RouteEntry>>>
      : (
          options?: { headers?: Record<string, string>; query?: Record<string, string> },
        ) => Promise<ClientResult<RouteResponseType<TRoutes[K] & RouteEntry>>>

// Type-level pathToMethodName — mirrors the runtime function exactly.
// CRUD shorthands (suffix after stripping leading slash):
//   ''|'/'       GET→index  POST→store
//   ':x'         GET→show   PATCH→update  DELETE→destroy
// Custom routes: method + CamelCase(segments)
//   e.g. GET /search → 'getSearch', POST /:id/ban → 'postByIdBan'

// Capitalize first letter of a string
type Capitalize1<S extends string> = S extends `${infer F}${infer R}` ? `${Uppercase<F>}${R}` : S

// Convert a single path segment to its camelCase contribution:
//   ':id'    → 'ById',  ':userId' → 'ByUserId',  'search' → 'Search', 'export' → 'Export'
type SegmentToKey<S extends string> =
  S extends `:${infer Param}` ? `By${Capitalize1<Param>}` : Capitalize1<S>

// Convert a slash-separated suffix string to camelCase body (no leading method prefix):
//   'search'        → 'Search'
//   ':id/ban'       → 'ByIdBan'
//   'by-user/:id'   → 'By-userById'  (runtime splits on / only, not -)
type SuffixToCamel<S extends string> =
  S extends `${infer Head}/${infer Tail}`
    ? `${SegmentToKey<Head>}${SuffixToCamel<Tail>}`
    : SegmentToKey<S>

// Full method name: method + Capitalize1(SuffixToCamel(suffix))
type CustomMethodName<TMethod extends string, S extends string> =
  `${Lowercase<TMethod>}${Capitalize1<SuffixToCamel<S>>}`

type RouteMethodName<TMethod extends string, TSuffix extends string> =
  // Strip leading slash before matching
  TSuffix extends `/${infer S}`
    ? RouteMethodNameInner<TMethod, S>
    : RouteMethodNameInner<TMethod, TSuffix>

type RouteMethodNameInner<TMethod extends string, S extends string> =
  // CRUD: root (empty or just slash)
  S extends '' | '/'
    ? TMethod extends 'get'    ? 'index'
    : TMethod extends 'post'   ? 'store'
    : CustomMethodName<TMethod, S>
  // CRUD: single bare param segment ':x' — must not contain a slash (no sub-paths)
  : S extends `:${infer _P}` ? _P extends `${string}/${string}`
    ? CustomMethodName<TMethod, S>
    : TMethod extends 'get'    ? 'show'
    : TMethod extends 'patch'  ? 'update'
    : TMethod extends 'delete' ? 'destroy'
    : CustomMethodName<TMethod, S>
  // Custom route — compute literal name
  : CustomMethodName<TMethod, S>

// Per-module client type — only routes belonging to this prefix, no cross-module bleed.
type ModuleClient<TRoutes extends RouteMap, TPrefix extends string> = {
  [K in ModuleRouteKeys<TRoutes, TPrefix> as
    RouteMethodName<MethodOf<K>, SuffixAfterPrefix<K, TPrefix>>
  ]: MethodEntry<TRoutes, K & keyof TRoutes & string, TPrefix>
}

// ── InferClient — splits app routes into per-module namespaces ─────────────────

// Exact route key filter for a module — uses the _prefix phantom field set by ModuleBuilder.
// Each route entry has _prefix: TPrefix — filter on exact equality to prevent cross-module bleed.
type ModuleRouteKeys<TRoutes extends RouteMap, TPrefix extends string> = {
  [K in keyof TRoutes & string]: TRoutes[K] extends { _prefix: TPrefix } ? K : never
}[keyof TRoutes & string]

// Type-level pathToClientKey: '/api/users' → 'apiUsers', '/blog-posts' → 'blogPosts'
// Splits on '/' and '-', capitalizes segments after the first, joins them.
// TS can do this with recursive template literal inference.
type PathToClientKey<S extends string> =
  // Strip leading slash first
  S extends `/${infer Rest}`
    ? PathToClientKey<Rest>
    : PathSegmentsToKey<S>

// Split remaining string on '/' and '-' separators, join as camelCase
type PathSegmentsToKey<S extends string> =
  S extends `${infer Head}/${infer Tail}`
    ? `${Head}${Capitalize<PathSegmentsToKey<Tail>>}`
    : S extends `${infer Head}-${infer Tail}`
      ? `${Head}${Capitalize<PathSegmentsToKey<Tail>>}`
      : S

// Public type for consumers
export type InferProxyClient<TApp> =
  TApp extends { readonly _routes: infer R; readonly _prefixes: infer P }
    ? R extends RouteMap
      ? [P] extends [string]
        ? ProxyClientFromRoutes<R, P>
        : Record<string, never>
      : Record<string, never>
    : Record<string, never>

// Build the proxy client — one namespace per module prefix, fully typed.
// P is the union of all registered module prefixes (from app._prefixes).
// Key is the camelCase version of each prefix, matching pathToClientKey() at runtime.
type ProxyClientFromRoutes<TRoutes extends RouteMap, TPrefixes extends string> = {
  [P in TPrefixes as PathToClientKey<P>]: ModuleClient<TRoutes, P>
}

// ── Runtime implementation ─────────────────────────────────────────────────────

export interface ProxyClientOptions {
  fetch?:   (input: Request) => Promise<Response>
  headers?: Record<string, string>
  throws?:  boolean
}

// Runtime route descriptor — built from app.routes
interface RouteDescriptor {
  method:  string
  path:    string   // full path e.g. '/users/:id'
  prefix:  string   // module prefix e.g. '/users'
  suffix:  string   // path after prefix e.g. '/:id'
}

function buildDescriptors(routes: Array<{ method: string; path: string; _module?: { prefix: string } | null }>): RouteDescriptor[] {
  return routes.map((r) => {
    const prefix = r._module?.prefix ?? ''
    const suffix = r.path.startsWith(prefix) ? r.path.slice(prefix.length) || '/' : r.path
    return { method: r.method, path: r.path, prefix, suffix }
  })
}

function substitutePathParams(path: string, args: unknown[]): { url: string; remaining: unknown[] } {
  const paramCount = (path.match(/:[^/]+/g) ?? []).length
  const params = args.slice(0, paramCount) as (string | number)[]
  const remaining = args.slice(paramCount)
  let i = 0
  const url = path.replace(/:[^/]+/g, () => String(params[i++] ?? ''))
  return { url, remaining }
}

async function executeProxyRequest(
  baseUrl: string,
  descriptor: RouteDescriptor,
  args: unknown[],
  globalHeaders: Record<string, string>,
  fetchFn: (input: Request) => Promise<Response>,
  throwOnError: boolean,
): Promise<ClientResult<unknown>> {
  // Separate path params (positional) from options (last arg if object without body for GET)
  const hasSuffix = /:[^/]+/.test(descriptor.suffix)
  let pathArgs: unknown[]
  let opts: { body?: unknown; headers?: Record<string, string>; query?: Record<string, string> } | undefined

  const isBodyMethod = descriptor.method === 'POST' || descriptor.method === 'PUT' || descriptor.method === 'PATCH'

  if (isBodyMethod) {
    // First positional args are path params, then body, then opts
    const paramCount = (descriptor.path.match(/:[^/]+/g) ?? []).length
    pathArgs = args.slice(0, paramCount)
    const bodyArg = args[paramCount]
    const optsArg = args[paramCount + 1] as typeof opts
    opts = { body: bodyArg, headers: optsArg?.headers, query: optsArg?.query }
  } else {
    // GET/DELETE: path params then optional opts object
    const paramCount = (descriptor.path.match(/:[^/]+/g) ?? []).length
    pathArgs = args.slice(0, paramCount)
    opts = args[paramCount] as typeof opts
  }

  const { url: substituted } = substitutePathParams(descriptor.path, pathArgs)
  let url = baseUrl.replace(/\/$/, '') + substituted

  if (opts?.query) {
    const qs = new URLSearchParams(opts.query as Record<string, string>).toString()
    if (qs) url += '?' + qs
  }

  const headers: Record<string, string> = { ...globalHeaders, ...opts?.headers }
  let bodyStr: string | undefined

  if (opts?.body !== undefined && isBodyMethod) {
    bodyStr = JSON.stringify(opts.body)
    headers['Content-Type'] = 'application/json'
  }

  let res: Response
  try {
    res = await fetchFn(new Request(url, { method: descriptor.method, headers, body: bodyStr }))
  } catch (networkErr) {
    const msg = networkErr instanceof Error ? networkErr.message : 'Network error'
    const err = new VelnClientError(0, 'NETWORK_ERROR', msg)
    if (throwOnError) throw err
    return { ok: false, error: err, status: 0, code: 'NETWORK_ERROR', message: msg }
  }

  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json() as { code?: string; message?: string; error?: string }
      if (body.code)    code    = body.code
      if (body.message) message = body.message
      else if (body.error) message = body.error
    } catch { /* ignore parse error */ }

    const err = new VelnClientError(res.status, code, message)
    if (throwOnError) throw err
    return { ok: false, error: err, status: res.status, code, message }
  }

  let data: unknown
  try {
    data = await res.json()
  } catch {
    data = undefined
  }

  return { ok: true, data, status: res.status }
}

// ── Public factory ─────────────────────────────────────────────────────────────

export function createProxyClient<TApp extends { routes: Array<{ method: string; path: string; _module?: { prefix: string } | null }> }>(
  app: TApp,
  baseUrl: string,
  options?: ProxyClientOptions,
): InferProxyClient<TApp> {
  const fetchFn = options?.fetch ?? ((req: Request) => globalThis.fetch(req))
  const globalHeaders = options?.headers ?? {}
  const throwOnError = options?.throws ?? false

  const descriptors = buildDescriptors(app.routes)

  // Group descriptors by prefix → clientKey
  const byKey = new Map<string, RouteDescriptor[]>()
  for (const d of descriptors) {
    const key = pathToClientKey(d.prefix) || 'root'
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(d)
  }

  // Build namespace → method-map
  const proxy: Record<string, Record<string, (...args: unknown[]) => Promise<ClientResult<unknown>>>> = {}

  for (const [key, descs] of byKey) {
    const methods: Record<string, (...args: unknown[]) => Promise<ClientResult<unknown>>> = {}
    for (const desc of descs) {
      const methodName = pathToMethodName(desc.method, desc.suffix)
      methods[methodName] = (...args: unknown[]) =>
        executeProxyRequest(baseUrl, desc, args, globalHeaders, fetchFn, throwOnError)
    }
    proxy[key] = methods
  }

  return proxy as InferProxyClient<TApp>
}

// ── createModuleClient — single-module entry point ────────────────────────────

export function createModuleClient<TModule extends { routes: Array<{ method: string; path: string; _module?: { prefix: string } | null }>; prefix: string }>(
  module: TModule,
  baseUrl: string,
  options?: ProxyClientOptions,
): Record<string, (...args: unknown[]) => Promise<ClientResult<unknown>>> {
  const fetchFn = options?.fetch ?? ((req: Request) => globalThis.fetch(req))
  const globalHeaders = options?.headers ?? {}
  const throwOnError = options?.throws ?? false

  // Module routes have unprefixed paths — add the module prefix to each
  const prefixedRoutes = module.routes.map((r) => ({
    ...r,
    path: module.prefix + r.path,
    _module: { prefix: module.prefix },
  }))

  const descriptors = buildDescriptors(prefixedRoutes)
  const methods: Record<string, (...args: unknown[]) => Promise<ClientResult<unknown>>> = {}

  for (const desc of descriptors) {
    const methodName = pathToMethodName(desc.method, desc.suffix)
    methods[methodName] = (...args: unknown[]) =>
      executeProxyRequest(baseUrl, desc, args, globalHeaders, fetchFn, throwOnError)
  }

  return methods
}
