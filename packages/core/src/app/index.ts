import type { BaseCtx, Guard, ErrorHandler, RouteHandler, Route, RouteSchema, RouteHandlerWithSchema, InferCtx, RouteMap, OnRequestHook, OnBeforeHandleHook, OnResponseHook, RouteDocs, StreamController, StreamOptions, SseController, VelnWsAdapter, WsRouteShape, AuthAdapter } from './types'
import type { NavItem } from './plugin'
import { createMinimalLogger } from './logger'
import { generateOpenApiSpec } from '../openapi/generator'
import type { OpenApiSpec } from '../openapi/generator'
import type { ZodTypeAny } from 'zod'
import { ValidationError } from './types'
import { VelnError, UnauthorizedError, ForbiddenError } from '../errors/index'
import type { Plugin } from './plugin'
import type { VelnEvents, EventHandler } from '../events/index'
import type { EventHandlerDef } from '../events/handler'
import type { CronDef, CronLockAdapter } from '../cron/index'
import { NoOpCronLockAdapter } from '../cron/index'
import { createSystemCtx } from './system-ctx'
import { VelnDB } from '../db/index'
import type { VelnModule, ServiceDeclaration } from './module'
import type { InferTableEvents, TableEventMap, TableDef, SchemaMap } from '../schema/table'
import { InMemoryEventBus, RequestEventQueue } from '../events/index'
import type { EventBusAdapter } from '../events/index'
import { HookExecutor } from '../hooks/executor'
import { matchPath, parseQuery } from './router'
import { buildAuditHooks } from './audit-wiring'
import { createCookieJar } from './cookies'
import type { ServiceDef } from '../service/index'
import { detectCircular, instantiateServices } from '../service/index'
import type { MiddlewareDef } from './middleware'
import { createOnRequest, createOnResponse } from './types'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

// ── ctx.stream() implementation ──────────────────────────────────────────────
// Creates a ReadableStream from a writer callback.
// The writer receives a StreamController and can push chunks then close.
function makeStreamResponse(
  writer: (controller: StreamController) => void | Promise<void>,
  options: StreamOptions = {},
): Response {
  const enc = new TextEncoder()
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const w = writable.getWriter()

  const controller: StreamController = {
    send(chunk: string | Uint8Array) {
      const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk
      void w.write(bytes)
    },
    close() {
      void w.close()
    },
  }

  // Run the writer async — errors close the stream; success path relies on
  // the caller invoking controller.close() explicitly.
  Promise.resolve(writer(controller)).catch(() => { void w.close() })

  const headers = new Headers(options.headers)
  headers.set('Content-Type', options.contentType ?? 'text/plain')

  return new Response(readable, {
    status:  options.status ?? 200,
    headers,
  })
}

// ── ctx.sse() implementation ──────────────────────────────────────────────────
// Thin wrapper over makeStreamResponse — enforces SSE headers and wire format.
//
// SSE wire format per https://html.spec.whatwg.org/multipage/server-sent-events.html:
//   event: <name>\n
//   data: <json>\n\n
//
//   data: <json>\n\n        (unnamed)
//   : <comment>\n\n         (keepalive)
//   id: <value>\n
//   retry: <ms>\n
function makeSSEResponse(
  writer: (controller: SseController) => void | Promise<void>,
): Response {
  const enc = new TextEncoder()
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const w = writable.getWriter()

  function push(frame: string): Promise<void> {
    return w.write(enc.encode(frame))
  }

  const controller: SseController = {
    async event(name: string, data: unknown): Promise<void> {
      await push(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    },
    async data(data: unknown): Promise<void> {
      await push(`data: ${JSON.stringify(data)}\n\n`)
    },
    async comment(text = ''): Promise<void> {
      await push(`: ${text}\n\n`)
    },
    async id(eventId: string): Promise<void> {
      await push(`id: ${eventId}\n`)
    },
    async retry(ms: number): Promise<void> {
      await push(`retry: ${ms}\n`)
    },
  }

  // Run the writer — always close the stream when done (success or error).
  // The try/catch on close() guards against Bun throwing when the writer
  // is already in a closing state (e.g. backpressure abort during error path).
  Promise.resolve(writer(controller)).finally(() => { w.close().catch(() => {}) })

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}

// Bun's BunRequest type — extends Request with .params (populated by native SIMD router)
type BunRequest = import('bun').BunRequest<string>

// Type union — function shorthand OR schema object
type HandlerArg<TCtx> =
  | ((ctx: TCtx) => Response | Promise<Response>)
  | RouteHandler<TCtx>
  | RouteHandlerWithSchema<TCtx, any>

function normalizeHandler<TCtx>(
  handler: HandlerArg<TCtx>,
): { handler: RouteHandler<TCtx>; schema: RouteSchema | undefined; docs: RouteDocs | undefined } {
  if (typeof handler === 'function') {
    return { handler: { handler: handler as any }, schema: undefined, docs: undefined }
  }
  // RouteHandlerWithSchema has params/query/body/response fields alongside handler
  if ('params' in handler || 'query' in handler || 'body' in handler || 'response' in handler || 'docs' in handler) {
    const h = handler as RouteHandlerWithSchema<TCtx, any>
    return {
      handler: { handler: h.handler as any },
      schema: {
        params:   h.params,
        query:    h.query,
        body:     h.body,
        response: h.response,
      },
      docs: h.docs,
    }
  }
  // Plain RouteHandler { handler: fn }
  return { handler: handler as RouteHandler<TCtx>, schema: undefined, docs: undefined }
}

export class Veln<TCtx extends BaseCtx, TRoutes extends RouteMap = Record<never, never>, TPrefixes extends string = never> {
  // Used for type-extraction only — never set or read at runtime
  declare readonly _routes:   TRoutes
  declare readonly _prefixes: TPrefixes
  readonly routes: Route<any>[] = []
  private readonly plugins: Plugin<any, any>[] = []
  private readonly globalGuards: Guard<any>[] = []
  // ─── Lifecycle hook registries (strict phase order enforced in fetch()) ───
  private readonly _onRequestHooks: OnRequestHook<any>[] = []
  private readonly _onBeforeHandleHooks: OnBeforeHandleHook<any>[] = []
  private readonly _onResponseHooks: OnResponseHook<any>[] = []
  private globalOnError?: ErrorHandler<any>
  private readonly eventBus: EventBusAdapter
  // Exposed so users can pass it to dbPlugin — app.register() populates this executor
  readonly hooks: HookExecutor
  private installedPlugins = false
  // Tracks which module plugin names have already been installed
  private readonly installedModulePlugins = new Set<string>()
  // Audit declarations collected from register() — wired after plugins install
  private readonly _pendingAuditDeclarations: import('./module').AuditDeclaration<any, any, any>[] = []

  private _opts: {
    validateResponse: boolean
    exposeIssues: boolean
    db?: { log?: { enabled?: boolean; n1Threshold?: number; logQueries?: boolean } }
  } = { validateResponse: false, exposeIssues: false }
  // Global service declarations — registered via app.use()
  private readonly _globalServiceDeclarations: ServiceDeclaration<string, unknown>[] = []
  // Circular dep check happens once on first fetch
  private _serviceCircularChecked = false
  // Route-matching cache — keyed by "METHOD:pathname", stores match result or null (no match).
  // Only the fetch() fallback path populates this (Bun native routes bypass fetch() entirely).
  // FIFO eviction at _ROUTE_CACHE_MAX entries.
  private _routeCache = new Map<string, { route: Route<unknown>; params: Record<string, string | undefined> } | null>()
  private readonly _ROUTE_CACHE_MAX = 500
  // Cron job definitions — scheduled at listen()
  private readonly _cronDefs: CronDef<Record<string, unknown>>[] = []
  // Registry of running croner instances — populated by _scheduleCrons(), drained by close()
  private readonly _cronJobs: Map<string, import('croner').Cron> = new Map()
  // Lock adapter — prevents duplicate execution across multiple instances
  private readonly _cronLock: CronLockAdapter
  private readonly _onInternalError: (msg: string, err: unknown) => void
  // Optional WS adapter — registered via app.registerWsAdapter(). Null when @oakbun/ws is not used.
  private _wsAdapter: VelnWsAdapter | null = null
  // Optional auth adapter — set via createApp({ auth }). Null when auth is not configured.
  private _authAdapter: AuthAdapter | null = null

  constructor(opts: {
    auth?: AuthAdapter
    nav?: { path?: string }
    validation?: { exposeIssues?: boolean }
    eventBus?: EventBusAdapter
    cronLock?: CronLockAdapter
    db?: { log?: { enabled?: boolean; n1Threshold?: number; logQueries?: boolean } }
    onInternalError?: (msg: string, err: unknown) => void
  } = {}) {
    this._onInternalError = opts.onInternalError ?? ((msg, err) => console.error(msg, err))
    this.eventBus = opts.eventBus ?? new InMemoryEventBus()
    this._cronLock = opts.cronLock ?? new NoOpCronLockAdapter()
    this.hooks = new HookExecutor()
    this._authAdapter = opts.auth ?? null
    if (opts.validation?.exposeIssues !== undefined) {
      this._opts = { ...this._opts, exposeIssues: opts.validation.exposeIssues }
    }
    if (opts.db !== undefined) {
      this._opts = { ...this._opts, db: opts.db }
    }
    this._registerNavEndpoint(opts.nav?.path ?? '/nav')
  }

  // Register the built-in GET /nav endpoint.
  // Returns all plugin nav items filtered by the current user's permissions.
  // Always public — no user → empty array, no error.
  private _registerNavEndpoint(path: string): void {
    const pluginsRef = this.plugins
    const authAdapterRef = () => this._authAdapter
    this.routes.push({
      method:     'GET',
      path,
      visibility: 'hidden',
      guards:     [],
      handler: {
        handler: (ctx: BaseCtx) => {
          const user = ((ctx as unknown as Record<string, unknown>)['user'] ?? null) as import('./types').AuthUser | null
          const nav: NavItem[] = []
          for (const plugin of pluginsRef) {
            if (!plugin.nav || plugin.nav.length === 0) continue
            // If the plugin has permissions, check whether the user has at least one.
            // Uses _authAdapter.hasPermission() — never reads user.permissions directly.
            if (plugin.permissions && plugin.permissions.length > 0) {
              if (user == null) continue  // no user → skip permissioned plugin
              const adapter = authAdapterRef()
              const hasAny = adapter
                ? plugin.permissions.some((perm) => adapter.hasPermission(user, perm))
                : false
              if (!hasAny) continue
            }
            nav.push(...plugin.nav)
          }
          // Sort by order (ascending, default 0), then alphabetically by label
          nav.sort((a, b) => {
            const orderDiff = (a.order ?? 0) - (b.order ?? 0)
            return orderDiff !== 0 ? orderDiff : a.label.localeCompare(b.label)
          })
          return ctx.json({ nav })
        },
      },
    })
  }

  private _addRoute(
    method: HttpMethod,
    path: string,
    handler: HandlerArg<TCtx>,
    module?: VelnModule,
  ): this {
    const { handler: normalized, schema, docs } = normalizeHandler(handler)
    this.routes.push({
      method,
      path,
      handler: normalized,
      guards: [],
      schema,
      docs,
      _module: module,
    })
    return this
  }

  // HTTP method registration.
  // 3-arg overload with schema: accumulates into TRoutes for RPC client type extraction.
  // 2-arg overload: function shorthand, no schema inference needed, TRoutes unchanged.

  private _registerMethod(
    method: HttpMethod,
    path: string,
    schemaOrHandler: { body?: ZodTypeAny; params?: ZodTypeAny; query?: ZodTypeAny; response?: ZodTypeAny } | HandlerArg<TCtx>,
    handler?: (ctx: never) => Response | Promise<Response>,
  ): Veln<TCtx, RouteMap, TPrefixes> {
    return handler
      ? this._addRoute(method, path, { ...schemaOrHandler as RouteSchema, handler } as RouteHandlerWithSchema<TCtx, RouteSchema>)
      : this._addRoute(method, path, schemaOrHandler as HandlerArg<TCtx>)
  }

  get<
    TBody extends ZodTypeAny,
    TParams extends ZodTypeAny,
    TQuery extends ZodTypeAny,
    TResponse extends ZodTypeAny,
    TPath extends string
  >(
    path: TPath,
    schema: { body?: TBody; params?: TParams; query?: TQuery; response?: TResponse },
    handler: (ctx: TCtx & { body: import('zod').infer<TBody>; params: import('zod').infer<TParams>; query: import('zod').infer<TQuery> }) => Response | Promise<Response>,
  ): Veln<TCtx, TRoutes & Record<`GET ${TPath}`, { body: TBody; params: TParams; query: TQuery; response: TResponse }>>
  get(path: string, handler: HandlerArg<TCtx>): this
  get(path: string, schemaOrHandler: { body?: ZodTypeAny; params?: ZodTypeAny; query?: ZodTypeAny; response?: ZodTypeAny } | HandlerArg<TCtx>, handler?: (ctx: never) => Response | Promise<Response>): Veln<TCtx, RouteMap, TPrefixes> {
    return this._registerMethod('GET', path, schemaOrHandler, handler)
  }

  post<
    TBody extends ZodTypeAny,
    TParams extends ZodTypeAny,
    TQuery extends ZodTypeAny,
    TResponse extends ZodTypeAny,
    TPath extends string
  >(
    path: TPath,
    schema: { body?: TBody; params?: TParams; query?: TQuery; response?: TResponse },
    handler: (ctx: TCtx & { body: import('zod').infer<TBody>; params: import('zod').infer<TParams>; query: import('zod').infer<TQuery> }) => Response | Promise<Response>,
  ): Veln<TCtx, TRoutes & Record<`POST ${TPath}`, { body: TBody; params: TParams; query: TQuery; response: TResponse }>>
  post(path: string, handler: HandlerArg<TCtx>): this
  post(path: string, schemaOrHandler: { body?: ZodTypeAny; params?: ZodTypeAny; query?: ZodTypeAny; response?: ZodTypeAny } | HandlerArg<TCtx>, handler?: (ctx: never) => Response | Promise<Response>): Veln<TCtx, RouteMap, TPrefixes> {
    return this._registerMethod('POST', path, schemaOrHandler, handler)
  }

  put<
    TBody extends ZodTypeAny,
    TParams extends ZodTypeAny,
    TQuery extends ZodTypeAny,
    TResponse extends ZodTypeAny,
    TPath extends string
  >(
    path: TPath,
    schema: { body?: TBody; params?: TParams; query?: TQuery; response?: TResponse },
    handler: (ctx: TCtx & { body: import('zod').infer<TBody>; params: import('zod').infer<TParams>; query: import('zod').infer<TQuery> }) => Response | Promise<Response>,
  ): Veln<TCtx, TRoutes & Record<`PUT ${TPath}`, { body: TBody; params: TParams; query: TQuery; response: TResponse }>>
  put(path: string, handler: HandlerArg<TCtx>): this
  put(path: string, schemaOrHandler: { body?: ZodTypeAny; params?: ZodTypeAny; query?: ZodTypeAny; response?: ZodTypeAny } | HandlerArg<TCtx>, handler?: (ctx: never) => Response | Promise<Response>): Veln<TCtx, RouteMap, TPrefixes> {
    return this._registerMethod('PUT', path, schemaOrHandler, handler)
  }

  patch<
    TBody extends ZodTypeAny,
    TParams extends ZodTypeAny,
    TQuery extends ZodTypeAny,
    TResponse extends ZodTypeAny,
    TPath extends string
  >(
    path: TPath,
    schema: { body?: TBody; params?: TParams; query?: TQuery; response?: TResponse },
    handler: (ctx: TCtx & { body: import('zod').infer<TBody>; params: import('zod').infer<TParams>; query: import('zod').infer<TQuery> }) => Response | Promise<Response>,
  ): Veln<TCtx, TRoutes & Record<`PATCH ${TPath}`, { body: TBody; params: TParams; query: TQuery; response: TResponse }>>
  patch(path: string, handler: HandlerArg<TCtx>): this
  patch(path: string, schemaOrHandler: { body?: ZodTypeAny; params?: ZodTypeAny; query?: ZodTypeAny; response?: ZodTypeAny } | HandlerArg<TCtx>, handler?: (ctx: never) => Response | Promise<Response>): Veln<TCtx, RouteMap, TPrefixes> {
    return this._registerMethod('PATCH', path, schemaOrHandler, handler)
  }

  delete<
    TBody extends ZodTypeAny,
    TParams extends ZodTypeAny,
    TQuery extends ZodTypeAny,
    TResponse extends ZodTypeAny,
    TPath extends string
  >(
    path: TPath,
    schema: { body?: TBody; params?: TParams; query?: TQuery; response?: TResponse },
    handler: (ctx: TCtx & { body: import('zod').infer<TBody>; params: import('zod').infer<TParams>; query: import('zod').infer<TQuery> }) => Response | Promise<Response>,
  ): Veln<TCtx, TRoutes & Record<`DELETE ${TPath}`, { body: TBody; params: TParams; query: TQuery; response: TResponse }>>
  delete(path: string, handler: HandlerArg<TCtx>): this
  delete(path: string, schemaOrHandler: { body?: ZodTypeAny; params?: ZodTypeAny; query?: ZodTypeAny; response?: ZodTypeAny } | HandlerArg<TCtx>, handler?: (ctx: never) => Response | Promise<Response>): Veln<TCtx, RouteMap, TPrefixes> {
    return this._registerMethod('DELETE', path, schemaOrHandler, handler)
  }

  /**
   * registerWsAdapter() — connect @oakbun/ws to this app.
   *
   * Call this before registering WS routes:
   *   import { createWsAdapter } from '@oakbun/ws'
   *   app.registerWsAdapter(createWsAdapter())
   */
  registerWsAdapter(adapter: VelnWsAdapter): this {
    this._wsAdapter = adapter
    return this
  }

  /**
   * ws() — register a WebSocket route.
   * Requires app.registerWsAdapter(createWsAdapter()) first.
   *
   * Full typing (WsCtx, Zod schema support) is provided when @oakbun/ws is imported.
   * Full type safety (WsCtx, Zod schema support, typed ctx.data) is provided by @oakbun/ws.
   * This base accepts a loose WsRouteShape so Core stays free of @oakbun/ws types.
   */
  ws(path: string, route: WsRouteShape): this {
    if (!this._wsAdapter) {
      throw new VelnError(
        `app.ws('${path}') called but no WS adapter is registered. Call app.registerWsAdapter(createWsAdapter()) first.`,
        500, 'NO_WS_ADAPTER',
      )
    }
    this._wsAdapter.registerRoute(path, { ...route, path, _module: null })
    return this
  }


  plugin<TAdd extends object>(p: Plugin<TCtx, TAdd>): Veln<TCtx & TAdd, TRoutes, TPrefixes> {
    // Validate declared dependencies — fail fast with a clear error rather than a
    // mysterious runtime crash when a required plugin's ctx additions are missing.
    if (p.requires && p.requires.length > 0) {
      const registered = new Set(this.plugins.map((r) => r.name))
      for (const dep of p.requires) {
        if (!registered.has(dep)) {
          throw new VelnError(
            `Plugin "${p.name}" requires plugin "${dep}" to be registered first. ` +
            `Call app.plugin(${dep}Plugin(...)) before app.plugin(${p.name}Plugin(...)).`,
            500,
            'PLUGIN_MISSING_DEP',
          )
        }
      }
    }
    this.plugins.push(p)
    if (p.modules) {
      for (const mod of p.modules) {
        this.register(mod)
        // Tag every route that belongs to this plugin so _runRoute can look up
        // its permissions without a separate Map.
        if (p.permissions && p.permissions.length > 0) {
          for (const route of this.routes) {
            if (route._module === mod && route._pluginName === undefined) {
              route._pluginName = p.name
            }
          }
        }
      }
    }
    return this as unknown as Veln<TCtx & TAdd, TRoutes, TPrefixes>
  }

  // ── .use() — global service or middleware registration ────────────────────
  // Service overload: ctx[service._serviceKey] available in every route handler.
  // Middleware overload: registers onRequest/onResponse hooks globally.
  use<TKey extends string, TDef>(
    service: ServiceDef<TKey, TDef>,
  ): Veln<TCtx & Record<TKey, TDef>, TRoutes, TPrefixes>
  use(middleware: MiddlewareDef): this
  use<TKey extends string, TDef>(
    serviceOrMiddleware: ServiceDef<TKey, TDef> | MiddlewareDef,
  ): Veln<TCtx & Record<TKey, TDef>, TRoutes, TPrefixes> | this {
    if ('_serviceKey' in serviceOrMiddleware) {
      this._globalServiceDeclarations.push({ service: serviceOrMiddleware as ServiceDef<string, unknown> })
      return this as unknown as Veln<TCtx & Record<TKey, TDef>, TRoutes, TPrefixes>
    }
    // MiddlewareDef
    const m = serviceOrMiddleware as MiddlewareDef
    if (m._onRequest)  this._onRequestHooks.push(createOnRequest(m._onRequest))
    if (m._onResponse) this._onResponseHooks.push(createOnResponse(m._onResponse))
    return this
  }

  register<TModuleRoutes extends RouteMap, TModulePrefix extends string>(
    mod: VelnModule & { readonly _routes: TModuleRoutes; readonly _prefix: TModulePrefix },
  ): Veln<TCtx, TRoutes & TModuleRoutes, TPrefixes | TModulePrefix>
  register(module: VelnModule): this
  register(module: VelnModule): Veln<TCtx, TRoutes & RouteMap, TPrefixes | string> {
    // 1. Transfer hook declarations to internal HookExecutor
    for (const decl of module.hookDeclarations) {
      this.hooks.registerModuleHook(decl.table.name, decl.handlers)
    }

    // 2. Collect audit declarations — wired after plugins install (first fetch())
    for (const decl of module.auditDeclarations) {
      this._pendingAuditDeclarations.push(decl)
    }

    // 3. Mount routes with prefix
    for (const route of module.routes) {
      this.routes.push({
        ...route,
        path: module.prefix + route.path,
        _module: module,
      })
    }

    // 3b. Mount WS routes with prefix — delegate to wsAdapter if registered
    if (this._wsAdapter && module.wsRoutes.length > 0) {
      for (const wsRoute of module.wsRoutes) {
        const fullPath = module.prefix + wsRoute.path
        this._wsAdapter.registerRoute(fullPath, { ...wsRoute, path: fullPath, _module: module })
      }
    }

    // 4. Register event handler defs on the event bus
    for (const def of module.eventHandlerDefs) {
      this.events(def)
    }

    // 5. Collect cron defs — merge module service declarations into each cron's _services
    //    so module-level .use(Service) is automatically available in the cron handler
    for (const cronDef of module.cronDefs) {
      // Merge module services that aren't already declared on the CronDef itself
      const existingKeys = new Set(cronDef._services.map((s) => s._serviceKey))
      const merged = [
        ...cronDef._services,
        ...module.serviceDeclarations
          .map((d) => d.service)
          .filter((s) => !existingKeys.has(s._serviceKey)),
      ]
      const mergedDef: CronDef<Record<string, unknown>> = {
        ...cronDef,
        _services: merged,
        use: cronDef.use.bind(cronDef),
      }
      this._cronDefs.push(mergedDef)
    }

    // Invalidate route cache — new routes may match previously-cached paths differently
    this._routeCache.clear()

    return this as unknown as Veln<TCtx, TRoutes & RouteMap, TPrefixes | string>
  }

  // Internal helper: collect all service declarations (global + from a given module)
  private _allServiceDecls(mod: VelnModule | null): ReadonlyArray<ServiceDeclaration<string, unknown>> {
    if (mod === null) return this._globalServiceDeclarations
    // Merge global + module, deduplicate by key (module overrides global)
    const seen = new Set<string>()
    const merged: ServiceDeclaration<string, unknown>[] = []
    for (const d of [...mod.serviceDeclarations, ...this._globalServiceDeclarations]) {
      if (!seen.has(d.service._serviceKey)) {
        seen.add(d.service._serviceKey)
        merged.push(d)
      }
    }
    return merged
  }

  // Typed overload for events declared via VelnEvents Declaration Merging
  on<K extends keyof VelnEvents>(
    event: K,
    handler: (payload: VelnEvents[K], ctx: unknown) => Promise<void> | void,
  ): this
  // String fallback
  on(event: string, handler: EventHandler): this
  on(event: string, handler: EventHandler): this {
    this.eventBus.on(event, (payload) => handler(payload, undefined))
    return this
  }

  // Typed Table-reference overload — uses InferTableEvents<T, TEvents> directly at the call site.
  // No Declaration Merging needed for Table-derived events.
  // Phase 4b RPC Client uses this signature to build AppType.
  //
  // TMap is inferred from table._eventMap — a concrete precomputed object type stored on
  // TableDef. K is constrained via Pick<TMap, K>[K] which forces TypeScript to infer K
  // as the literal type of the event string rather than the full keyof TMap union.
  onEvent<
    TMap extends Record<string, unknown>,
    K extends string & keyof TMap
  >(
    table: { _eventMap: TMap },
    event: K,
    handler: (payload: Pick<TMap, K>[K], ctx: unknown) => void | Promise<void>,
  ): this {
    this.eventBus.on(event as string, (payload) => (handler as EventHandler)(payload, undefined))
    return this
  }

  events(def: EventHandlerDef): this {
    const logger   = def._logger
    const hasServices = def._services.length > 0

    if (hasServices) {
      // Service path — instantiate services per event fire using a system context
      for (const [event, rawHandler] of def._rawHandlers) {
        this.eventBus.on(event, async (payload) => {
          try {
            const adapter = this.hooks.getAdapter()
            const ctx: Record<string, unknown> = { logger }
            if (adapter) {
              const sysCtx = createSystemCtx({ role: 'event' })
              const velnDb = new VelnDB(adapter, this.hooks)
              const boundDb = velnDb.withCtx(sysCtx)
              const services = instantiateServices(def._services, boundDb)
              Object.assign(ctx, services)
            }
            await rawHandler(payload, ctx)
          } catch (err) {
            logger.error('handler error', { event, err })
          }
        })
      }
    } else {
      // Fast path — logger only, callbacks already wrapped in build()
      for (const [event, callback] of def._handlers) {
        this.eventBus.on(event, async (payload) => {
          try {
            await callback(payload)
          } catch (err) {
            logger.error('handler error', { event, err })
          }
        })
      }
    }
    return this
  }

  cron<TServices extends Record<string, unknown>>(def: CronDef<TServices>): this {
    this._cronDefs.push(def as CronDef<Record<string, unknown>>)
    return this
  }

  onError(handler: ErrorHandler<TCtx>): this {
    this.globalOnError = handler
    return this
  }

  // ─── Lifecycle hook registration ─────────────────────────────────────────
  // Registration order within a phase is preserved (FIFO).
  // Phase order is always: onRequest → plugins → guards → onBeforeHandle → handler → onResponse.

  onRequest(hook: OnRequestHook<TCtx>): this {
    this._onRequestHooks.push(hook as OnRequestHook<any>)
    return this
  }

  onBeforeHandle(hook: OnBeforeHandleHook<TCtx>): this {
    this._onBeforeHandleHooks.push(hook as OnBeforeHandleHook<any>)
    return this
  }

  onResponse(hook: OnResponseHook<TCtx>): this {
    this._onResponseHooks.push(hook as OnResponseHook<any>)
    return this
  }

  async fetch(req: Request, server?: import('bun').Server<unknown>): Promise<Response> {
    // ─────────────────────────────────────────────────────────────────────────
    // fetch() Lifecycle — strict phase order regardless of registration order:
    //
    //   PHASE 1: onRequest   — always runs, even on 404 / guard block / plugin error
    //                          receives BaseCtx (plugins not yet applied)
    //                          may return Response to short-circuit everything
    //   PHASE 2: plugins     — build full ctx (global + module-level)
    //   PHASE 3: guards      — global → module → route guards
    //                          block returns guard response (wrapped by onResponse)
    //   PHASE 4: onBeforeHandle — runs only when all guards pass
    //                             may return Response to skip handler
    //   PHASE 5: handler     — route handler
    //   PHASE 6: onResponse  — always runs (even on handler/guard/plugin error)
    //                          receives final Response; may return replacement
    // ─────────────────────────────────────────────────────────────────────────

    // PHASE 1: Install plugins once (lazy, on first request)
    if (!this.installedPlugins) {
      this.installedPlugins = true
      for (const plugin of this.plugins) {
        if (plugin.install) {
          await plugin.install(this.hooks)
        }
      }

      // Wire pending audit declarations now that plugins are installed.
      // dbPlugin.install() called hooks.setAdapter() above — adapter is available.
      if (this._pendingAuditDeclarations.length > 0) {
        const adapter = this.hooks.getAdapter()
        if (!adapter) {
          throw new Error(
            '[veln] .audit() declarations found but no dbPlugin is registered. ' +
            'Call app.plugin(dbPlugin(...)) before app.register().'
          )
        }
        for (const decl of this._pendingAuditDeclarations) {
          const handlers = buildAuditHooks(decl, adapter)
          this.hooks.registerModuleHook(decl.table.name, handlers)
        }
        this._pendingAuditDeclarations.length = 0
      }
    }

    // Parse URL — pathname + query
    const url = new URL(req.url)
    const pathname = url.pathname
    const method = req.method.toUpperCase() as HttpMethod

    // Create per-request event queue — collects all DB-generated events during this request.
    // Flushed after onResponse on success paths only.
    // Guard blocks, handler errors, and plugin errors discard the queue (no flush).
    const requestQueue = new RequestEventQueue()

    // Create per-request QueryLog when N+1 detection is enabled.
    // Zero-cost when disabled — no object allocation, no wrapper.
    const dbLogCfg = this._opts.db?.log
    const queryLog: import('../db/index').QueryLog | undefined = dbLogCfg?.enabled
      ? {
          queries:    0,
          totalMs:    0,
          entries:    [],
          threshold:  dbLogCfg.n1Threshold ?? 10,
          logQueries: dbLogCfg.logQueries ?? false,
        }
      : undefined

    // Build minimal base ctx for onRequest (plugins not yet applied)
    // _requestQueue is read by dbPlugin to bind the queue to BoundVelnDB.
    // _queryLog is read by dbPlugin to wire N+1 detection into BoundVelnDB.
    const baseCtx: BaseCtx = {
      req,
      params: {},
      query: parseQuery(url.search),
      json: <T>(data: T, status = 200) => Response.json(data, { status }),
      text: (data: string, status = 200) => new Response(data, { status, headers: { 'Content-Type': 'text/plain' } }),
      html: (data: string, status = 200) => new Response(data, { status, headers: { 'Content-Type': 'text/html' } }),
      stream: makeStreamResponse,
      sse:    makeSSEResponse,
      cookie: createCookieJar(req),
      emit: (event, payload) => { requestQueue.collect(event as string, payload) },
      _requestQueue: requestQueue,
      _queryLog: queryLog,
    }

    // ── Auth: resolve user before onRequest ──────────────────────────────────
    // getUser() runs once per request — result is available in onRequest hooks,
    // plugins, guards, and handlers as ctx.user (AuthUser | null).
    // Written via Object.assign so BaseCtx doesn't need to declare user — avoids
    // type collision with jwtPlugin/betterAuthPlugin which set their own user shape.
    if (this._authAdapter) {
      let resolvedUser: import('./types').AuthUser | null = null
      try {
        resolvedUser = await this._authAdapter.getUser(baseCtx)
      } catch {
        resolvedUser = null
      }
      Object.assign(baseCtx, { user: resolvedUser })
    } else {
      Object.assign(baseCtx, { user: null })
    }

    // ── PHASE 1: onRequest — always runs ─────────────────────────────────────
    // Runs before route matching so ctx.params is empty here.
    // If a hook returns a Response, it is wrapped by onResponse (no module yet).
    for (const hook of this._onRequestHooks) {
      let earlyRes: Response | void
      try {
        earlyRes = await hook._fn(baseCtx)
      } catch {
        earlyRes = undefined
      }
      if (earlyRes instanceof Response) {
        return this._runOnResponse(baseCtx, earlyRes, null)
      }
    }

    // ── WS UPGRADE: delegate to @oakbun/ws adapter ─────────────────────────────
    // Only attempted when the upgrade header is present, a server is available,
    // and an adapter has been registered via app.registerWsAdapter().
    if (server && this._wsAdapter && req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const installedRef = { value: this.installedPlugins }
      const upgradeResponse = await this._wsAdapter.handleUpgrade(
        req,
        server,
        baseCtx,
        this.plugins,
        installedRef,
        this.installedModulePlugins,
      )
      this.installedPlugins = installedRef.value
      if (upgradeResponse !== null) return upgradeResponse
      return undefined as unknown as Response  // Bun: undefined after successful upgrade
    }

    // Match route — 405 if path matches but method doesn't, 404 if no path match
    // P3: Cache matchPath() results by "METHOD:pathname" — FIFO eviction at _ROUTE_CACHE_MAX.
    let matchedRoute: Route<any> | null = null
    let matchedParams: Record<string, string | undefined> = {}
    const allowedMethods = new Set<string>()

    const cacheKey = `${method}:${pathname}`
    const cached = this._routeCache.get(cacheKey)
    if (cached !== undefined) {
      // Cache hit — cached is either { route, params } or null (known 404/405)
      if (cached !== null) {
        matchedRoute = cached.route
        matchedParams = cached.params
        allowedMethods.add(cached.route.method)
      }
    } else {
      // Cache miss — scan all routes
      for (const route of this.routes) {
        const result = matchPath(route.path, pathname)
        if (result === null) continue
        allowedMethods.add(route.method)
        if (route.method === method) {
          matchedRoute = route
          matchedParams = result.params
          break
        }
      }
      // Populate cache — evict oldest entry if at capacity
      if (this._routeCache.size >= this._ROUTE_CACHE_MAX) {
        this._routeCache.delete(this._routeCache.keys().next().value!)
      }
      this._routeCache.set(cacheKey, matchedRoute ? { route: matchedRoute, params: matchedParams } : null)
    }

    if (matchedRoute === null) {
      if (allowedMethods.size > 0) {
        // Path exists but method not allowed
        const allow = [...allowedMethods].join(', ')
        return this._runOnResponse(
          baseCtx,
          new Response('Method Not Allowed', { status: 405, headers: { Allow: allow } }),
          null,
        )
      }
      return this._runOnResponse(baseCtx, new Response('Not Found', { status: 404 }), null)
    }

    // Filter out undefined optional params — ctx.params is Record<string, string>
    const definedParams: Record<string, string> = {}
    for (const [k, v] of Object.entries(matchedParams)) {
      if (v !== undefined) definedParams[k] = v
    }

    return this._runRoute(baseCtx, matchedRoute, definedParams, requestQueue)
  }

  /**
   * _runRoute — executes the full Veln pipeline for an already-matched route.
   *
   * Called from two places:
   *   1. fetch()         — after matchPath() finds the route (used by createTestClient + fallback)
   *   2. Bun native routes — Bun's SIMD router pre-matched the route; params come from req.params
   *
   * baseCtx must already have req, query, cookie, emit set.
   * params is passed in as Record<string, string> (undefined optionals already filtered out).
   */
  private async _runRoute(
    baseCtx: BaseCtx,
    matchedRoute: Route<unknown>,
    params: Record<string, string>,
    requestQueue: RequestEventQueue,
  ): Promise<Response> {
    baseCtx.params = params

    const mod = matchedRoute._module ?? null

    // Phase 0 — Plugin permission gate
    const permResult = await this._runPermissionGate(baseCtx, matchedRoute, mod)
    if (permResult) return permResult

    // Phase 1 — Module onRequest hooks
    const onRequestResult = await this._runModuleOnRequest(baseCtx, matchedRoute, mod)
    if (onRequestResult) return onRequestResult

    // Phase 2a — Plugin context building
    const ctx = await this._runPlugins(baseCtx, matchedRoute, mod)
    if (ctx instanceof Response) return ctx

    // Phase 2b — Schema validation
    const validationResult = await this._runValidation(ctx, matchedRoute, mod)
    if (validationResult) return validationResult

    // Phase 2c — Service instantiation
    await this._runServices(ctx, mod)

    // Phase 3 — Guards (global + module + route)
    const guardResult = await this._runGuards(ctx, matchedRoute, mod)
    if (guardResult) return guardResult

    // Phase 4 — onBeforeHandle hooks
    const beforeHandleResult = await this._runBeforeHandle(ctx, matchedRoute, mod)
    if (beforeHandleResult) return beforeHandleResult

    // Phase 5 + 5.5 + 6 — Handler, response validation, onResponse
    return this._runHandler(baseCtx, ctx, matchedRoute, mod, requestQueue)
  }

  // ── Phase 0: Plugin permission gate ─────────────────────────────────────────
  // Runs immediately after route match — before onRequest hooks, before plugin
  // request() calls, before guards. Ensures no plugin side-effects occur for a
  // request that will be blocked anyway.
  //
  // Only applies to routes tagged with _pluginName (contributed via .modules()).
  // Uses AuthAdapter.hasPermission() — never reads ctx.user.permissions directly.
  private async _runPermissionGate(
    baseCtx: BaseCtx,
    matchedRoute: Route<unknown>,
    mod: VelnModule | null,
  ): Promise<Response | null> {
    if (matchedRoute._pluginName === undefined) return null

    const gateName = matchedRoute._pluginName
    const gatePlugin = this.plugins.find((p) => p.name === gateName)
    if (!gatePlugin?.permissions || gatePlugin.permissions.length === 0) return null

    // user was written via Object.assign — read it back through the record interface
    const user = (baseCtx as unknown as Record<string, unknown>)['user'] as import('./types').AuthUser | null | undefined
    if (user == null) {
      return this._runOnResponse(
        baseCtx,
        await this._handleError(new UnauthorizedError('Authentication required'), baseCtx, matchedRoute),
        mod,
      )
    }
    const adapter = this._authAdapter
    const hasAny = adapter
      ? gatePlugin.permissions.some((perm) => adapter.hasPermission(user, perm))
      : false
    if (!hasAny) {
      return this._runOnResponse(
        baseCtx,
        await this._handleError(new ForbiddenError('Insufficient permissions'), baseCtx, matchedRoute),
        mod,
      )
    }
    return null
  }

  // ── Phase 1: Module onRequest hooks ─────────────────────────────────────────
  // Runs after route match, still before plugins. Returns a Response if any hook
  // short-circuits, null otherwise.
  private async _runModuleOnRequest(
    baseCtx: BaseCtx,
    matchedRoute: Route<unknown>,
    mod: VelnModule | null,
  ): Promise<Response | null> {
    if (!mod) return null
    for (const hook of mod.onRequestHooks) {
      let earlyRes: Response | void
      try {
        earlyRes = await hook._fn(baseCtx)
      } catch {
        earlyRes = undefined
      }
      if (earlyRes instanceof Response) {
        return this._runOnResponse(baseCtx, earlyRes, mod)
      }
    }
    return null
  }

  // ── Phase 2a: Plugin context building ───────────────────────────────────────
  // Runs global plugins then module plugins (lazy install with Set guard).
  // Returns the enriched ctx, or a Response if a plugin throws.
  private async _runPlugins(
    baseCtx: BaseCtx,
    matchedRoute: Route<unknown>,
    mod: VelnModule | null,
  ): Promise<BaseCtx | Response> {
    let ctx: BaseCtx = baseCtx
    try {
      // P2 analysis: plugins run sequentially — later plugins may read context added by
      // earlier ones (e.g. authPlugin reads ctx.db set by dbPlugin). Promise.all is NOT
      // safe. Object.assign is applied after each plugin so ctx stays current.
      // Each Object.assign call is O(keys) and negligible — no further batching possible.
      for (const plugin of this.plugins) {
        Object.assign(ctx, await plugin.request(ctx))
      }

      if (mod) {
        for (const plugin of mod.plugins) {
          // Install module plugin exactly once — lazy, keyed by plugin name.
          //
          // Race-condition analysis (Spec 07):
          //   Bun runs on a single-threaded Event Loop — no true parallelism within
          //   one process. Concurrent requests interleave only at `await` points.
          //   The check (.has) and the mark (.add) are both synchronous and happen
          //   before the first `await plugin.install(this.hooks)`, so no other
          //   request can observe the un-marked state after .has() returns false:
          //
          //     Request A: .has() → false → .add()  ← sync, no yield possible here
          //                               → await install()  ← yield point
          //     Request B: .has() → true  → skip    ← sees the mark, install skipped ✓
          //
          //   This is the correct "optimistic add before await" pattern.
          if (plugin.install && !this.installedModulePlugins.has(plugin.name)) {
            this.installedModulePlugins.add(plugin.name)
            await plugin.install(this.hooks)
          }
          Object.assign(ctx, await plugin.request(ctx))
        }

        // Inject module logger if .options({ log }) was set and ctx.logger not already present
        if (mod.options?.log && !ctx.logger) {
          const seg = mod.prefix.split('/').filter(Boolean).pop() ?? 'root'
          ctx.logger = createMinimalLogger(`module:${seg}`, mod.options.log)
        }
      }
    } catch (err) {
      const errRes = await this._handleError(err, ctx, matchedRoute)
      return this._runOnResponse(ctx, errRes, mod)
    }
    return ctx
  }

  // ── Phase 2b: Schema validation ──────────────────────────────────────────────
  // Validates params, query, body against Zod schemas if defined.
  // Returns a Response on validation failure, null on success.
  private async _runValidation(
    ctx: BaseCtx,
    matchedRoute: Route<unknown>,
    mod: VelnModule | null,
  ): Promise<Response | null> {
    if (!matchedRoute.schema) return null
    const schema = matchedRoute.schema

    if (schema.params) {
      const result = schema.params.safeParse(ctx.params)
      if (!result.success) {
        const errRes = await this._handleError(new ValidationError(result.error), ctx, matchedRoute)
        return this._runOnResponse(ctx, errRes, mod)
      }
      ctx.params = result.data as Record<string, string>
    }

    if (schema.query) {
      const result = schema.query.safeParse(ctx.query)
      if (!result.success) {
        const errRes = await this._handleError(new ValidationError(result.error), ctx, matchedRoute)
        return this._runOnResponse(ctx, errRes, mod)
      }
      ctx.query = result.data as Record<string, string | string[]>
    }

    if (schema.body) {
      let raw: unknown = null
      try {
        raw = await ctx.req.json()
      } catch {
        // invalid JSON or no body
      }
      const result = schema.body.safeParse(raw)
      if (!result.success) {
        const errRes = await this._handleError(new ValidationError(result.error), ctx, matchedRoute)
        return this._runOnResponse(ctx, errRes, mod)
      }
      ctx.body = result.data
    }

    return null
  }

  // ── Phase 2c: Service instantiation ─────────────────────────────────────────
  // Instantiates declared services per-request and merges into ctx.
  // Runs after plugins (ctx.db is available) and before guards.
  private async _runServices(
    ctx: BaseCtx,
    mod: VelnModule | null,
  ): Promise<void> {
    const serviceDecls = this._allServiceDecls(mod)
    if (serviceDecls.length === 0) return

    // Circular dep check — once per app lifetime, not per-request
    if (!this._serviceCircularChecked) {
      this._serviceCircularChecked = true
      detectCircular(serviceDecls.map((d) => d.service))
    }

    if (!ctx.db) {
      throw new Error(
        '[veln] .use() service declarations found but ctx.db is not available. ' +
        'Register dbPlugin() before declaring services.',
      )
    }
    const serviceInstances = instantiateServices(
      serviceDecls.map((d) => d.service),
      ctx.db,
    )
    for (const [key, inst] of Object.entries(serviceInstances)) {
      (ctx as unknown as Record<string, unknown>)[key] = inst
    }
  }

  // ── Phase 3: Guards (global + module + route) ────────────────────────────────
  // Runs all three guard tiers in order. Returns a Response if any guard blocks,
  // null if all pass.
  private async _runGuards(
    ctx: BaseCtx,
    matchedRoute: Route<unknown>,
    mod: VelnModule | null,
  ): Promise<Response | null> {
    // Global guards
    for (const guard of this.globalGuards) {
      let guardResult: Response | null
      try {
        guardResult = await guard(ctx)
      } catch (err) {
        const errRes = await this._handleError(err, ctx, matchedRoute)
        return this._runOnResponse(ctx, errRes, mod)
      }
      if (guardResult !== null) {
        return this._runOnResponse(ctx, guardResult, mod)
      }
    }

    // Module guards — skipped when route has guard: false (moduleGuardOptOut)
    if (mod && !matchedRoute.moduleGuardOptOut) {
      for (const guard of mod.guards) {
        let guardResult: Response | null
        try {
          guardResult = await guard(ctx)
        } catch (err) {
          const errRes = await this._handleError(err, ctx, matchedRoute)
          return this._runOnResponse(ctx, errRes, mod)
        }
        if (guardResult !== null) {
          return this._runOnResponse(ctx, guardResult, mod)
        }
      }
    }

    // Route guards
    for (const guard of matchedRoute.guards) {
      let guardResult: Response | null
      try {
        guardResult = await guard(ctx)
      } catch (err) {
        const errRes = await this._handleError(err, ctx, matchedRoute)
        return this._runOnResponse(ctx, errRes, mod)
      }
      if (guardResult !== null) {
        return this._runOnResponse(ctx, guardResult, mod)
      }
    }

    return null
  }

  // ── Phase 4: onBeforeHandle hooks ───────────────────────────────────────────
  // Runs app-level then module-level onBeforeHandle hooks. Only called after all
  // guards pass. Returns a Response if any hook short-circuits, null otherwise.
  private async _runBeforeHandle(
    ctx: BaseCtx,
    matchedRoute: Route<unknown>,
    mod: VelnModule | null,
  ): Promise<Response | null> {
    // App-level hooks
    for (const hook of this._onBeforeHandleHooks) {
      let earlyRes: Response | void
      try {
        earlyRes = await hook._fn(ctx)
      } catch (err) {
        const errRes = await this._handleError(err, ctx, matchedRoute)
        return this._runOnResponse(ctx, errRes, mod)
      }
      if (earlyRes instanceof Response) {
        return this._runOnResponse(ctx, earlyRes, mod)
      }
    }

    // Module-level onBeforeHandle hooks
    if (mod) {
      for (const hook of mod.onBeforeHandleHooks) {
        let earlyRes: Response | void
        try {
          earlyRes = await hook._fn(ctx)
        } catch (err) {
          const errRes = await this._handleError(err, ctx, matchedRoute)
          return this._runOnResponse(ctx, errRes, mod)
        }
        if (earlyRes instanceof Response) {
          return this._runOnResponse(ctx, earlyRes, mod)
        }
      }
    }

    return null
  }

  // ── Phase 5 + 5.5 + 6: Handler, response validation, onResponse ─────────────
  // Executes the route handler, optionally validates the response, then runs
  // onResponse hooks. On error, discards the request queue (no event flush).
  private async _runHandler(
    baseCtx: BaseCtx,
    ctx: BaseCtx,
    matchedRoute: Route<unknown>,
    mod: VelnModule | null,
    requestQueue: RequestEventQueue,
  ): Promise<Response> {
    // Phase 5 — handler
    let response: Response
    try {
      response = await matchedRoute.handler.handler(ctx)
    } catch (err) {
      const errRes = await this._handleError(err, ctx, matchedRoute)
      // Handler threw — discard the request queue (no event flush on error)
      return this._runOnResponse(baseCtx, errRes, mod, undefined)
    }

    // Phase 5.5 — response validation (when enabled)
    // P4: Only clone when the response is actually JSON with a body — avoids cloning
    // SSE streams, HTML responses, and 204 No Content responses unnecessarily.
    const shouldValidate = this._opts.validateResponse
      && matchedRoute.schema?.response != null
      && response.headers.get('content-type')?.includes('application/json') === true
      && response.status !== 204
      && response.body !== null
    if (shouldValidate) {
      try {
        const body: unknown = await response.clone().json()
        const result = matchedRoute.schema!.response!.safeParse(body)
        if (!result.success) {
          this._onInternalError('[veln] Response validation failed:', result.error.issues)
          const errRes = new Response('Internal Server Error', { status: 500 })
          return this._runOnResponse(baseCtx, errRes, mod, undefined)
        }
      } catch {
        // Unparseable JSON — skip validation
      }
    }

    // Phase 6 — onResponse (success path — pass requestQueue so events are flushed)
    return this._runOnResponse(baseCtx, response, mod, requestQueue)
  }

  // Internal: run all onResponse hooks (app-level + module-level for matched route)
  // Always called — even on error paths — so onResponse truly "always runs".
  // flushQueue: only set on the success path (handler ran without error).
  //             After all onResponse hooks complete, the queue is flushed to the EventBus.
  private async _runOnResponse(ctx: BaseCtx, response: Response, module?: VelnModule | null, flushQueue?: RequestEventQueue): Promise<Response> {
    let current = response

    // App-level onResponse hooks
    for (const hook of this._onResponseHooks) {
      let result: Response | void = undefined
      try {
        result = await hook._fn(ctx, current)
      } catch {
        // onResponse errors are swallowed — never break the response
      }
      if (result instanceof Response) {
        current = result
      }
    }

    // Module-level onResponse hooks (if module is known)
    if (module) {
      for (const hook of module.onResponseHooks) {
        let result: Response | void = undefined
        try {
          result = await hook._fn(ctx, current)
        } catch {
          // swallow
        }
        if (result instanceof Response) {
          current = result
        }
      }
    }

    // N+1 detection — only when db.log.enabled is true and a QueryLog was created in fetch().
    // Zero-cost when disabled: ctx._queryLog is undefined, so no work is done.
    const queryLog = ctx._queryLog
    if (queryLog && queryLog.queries > queryLog.threshold) {
      const url    = new URL(ctx.req.url)
      const method = ctx.req.method.toUpperCase()
      console.warn(
        `[db:n+1] ${queryLog.queries} queries in ${method} ${url.pathname} — threshold: ${queryLog.threshold}`,
      )
      if (queryLog.logQueries) {
        for (const entry of queryLog.entries) {
          console.warn(`  ${entry.sql} (${entry.durationMs.toFixed(2)}ms)`)
        }
      }
    }

    // Flush request-level event queue — only on success path (flushQueue is undefined on errors).
    // This guarantees: events fire AFTER the response is finalized, never on rollback/error.
    if (flushQueue) {
      await flushQueue.flush(ctx, this.eventBus)
    }

    // Apply pending Set-Cookie headers from ctx.cookie
    const pendingCookies = ctx.cookie._pending()
    if (pendingCookies.length > 0) {
      const headers = new Headers(current.headers)
      for (const c of pendingCookies) {
        headers.append('Set-Cookie', c)
      }
      current = new Response(current.body, {
        status: current.status,
        statusText: current.statusText,
        headers,
      })
    }

    return current
  }

  private _handleError(err: unknown, ctx: any, route: Route<any>): Response | Promise<Response> {
    // Error cascade: route onError → module onError → global onError → built-in fallback
    if (route.onError) {
      try {
        return route.onError(err, ctx)
      } catch {
        // fall through
      }
    }

    if (route._module?.onError) {
      try {
        return route._module.onError(err, ctx)
      } catch {
        // fall through
      }
    }

    if (this.globalOnError) {
      try {
        return this.globalOnError(err, ctx)
      } catch {
        // fall through
      }
    }

    // Built-in fallback — structured error responses with machine-readable codes.
    // ValidationError first (subclass of VelnError) — includes issues array.
    // Issues are masked by default (exposeIssues: false) to prevent schema info leaks.
    // Set createApp({ validation: { exposeIssues: true } }) for full Zod details in development.
    if (err instanceof ValidationError) {
      const issues = this._opts.exposeIssues
        ? err.issues
        : err.issues.map((issue) => ({ path: issue.path, message: 'Invalid value' }))
      return Response.json(
        { error: 'Validation Error', code: err.code, message: err.message, issues },
        { status: 422 },
      )
    }

    if (err instanceof VelnError) {
      return Response.json(
        { error: err.name, code: err.code, message: err.message },
        { status: err.status },
      )
    }

    // Duck-type fallback: handle errors with status+code (e.g. @oakbun/jwt JwtBaseError)
    if (
      err instanceof Error &&
      typeof (err as any).status === 'number' &&
      typeof (err as any).code === 'string'
    ) {
      const e = err as Error & { status: number; code: string }
      return Response.json(
        { error: e.name, code: e.code, message: e.message },
        { status: e.status },
      )
    }

    return Response.json(
      { error: 'Internal Server Error', code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      { status: 500 },
    )
  }

  options(opts: { validateResponse?: boolean }): this {
    if (opts.validateResponse !== undefined) {
      this._opts = { ...this._opts, validateResponse: opts.validateResponse }
    }
    return this
  }

  async close(): Promise<void> {
    // Stop all cron jobs before tearing down plugins
    for (const job of this._cronJobs.values()) {
      job.stop()
    }
    this._cronJobs.clear()

    // Call teardown() in reverse registration order
    const reversed = [...this.plugins].reverse()
    for (const plugin of reversed) {
      if (plugin.teardown) {
        try {
          await plugin.teardown()
        } catch (err) {
          // Log but don't rethrow — other teardowns must still run
          this._onInternalError(`[veln] teardown failed for plugin "${plugin.name}":`, err)
        }
      }
    }
  }

  getOpenApiSpec(options?: { title?: string; version?: string }): OpenApiSpec {
    return generateOpenApiSpec(this.routes, options)
  }

  /**
   * getRoutes — returns all registered HTTP routes as a RouteInfo array.
   * Compatible with @oakbun/logger's printRouteTree().
   */
  getRoutes(): Array<{ method: string; path: string; module?: string; protected: boolean }> {
    return this.routes
      .filter(route => route.visibility !== 'hidden')
      .map(route => {
        const mod = route._module
        const moduleName = mod
          ? (mod.meta?.tag ?? mod.prefix.replace(/^\//, '').split('/')[0])
          : undefined
        return {
          method:    route.method,
          path:      route.path,
          module:    moduleName ?? undefined,
          protected: route.guards.length > 0,
        }
      })
  }

  /**
   * printRoutes — prints a simple route list to stdout.
   * For a pretty tree, use printRouteTree from @oakbun/logger.
   */
  printRoutes(options?: { title?: string; version?: string }): void {
    const title   = options?.title   ?? 'Veln'
    const version = options?.version ? ` ${options.version}` : ''
    console.log(`\n  ${title}${version}\n`)
    for (const route of this.routes) {
      const guard = route.guards.length > 0 ? '  🔒' : ''
      console.log(`  ${route.method.padEnd(6)} ${route.path}${guard}`)
    }
    console.log()
  }

  /**
   * _buildBunRoutes — converts this.routes into Bun's native route object.
   *
   * Called once at listen() time. Bun's SIMD-accelerated router takes over path matching;
   * params are extracted natively and passed via BunRequest.params.
   *
   * Routes with optional params (:name?) are deliberately excluded — Bun does not support
   * the `?` suffix syntax. They are handled by the fetch() fallback via matchPath().
   *
   * The returned object is typed as Record<string, unknown> because the path keys are
   * dynamic strings, not statically known literals. Bun.serve() receives it via `as any`.
   */
  private _buildBunRoutes(): Record<string, unknown> {
    // Group routes by path — multiple HTTP methods can share the same path
    const byPath = new Map<string, Route<unknown>[]>()
    for (const route of this.routes) {
      // Skip routes with optional params — Bun router doesn't support :param? syntax.
      // These fall through to the fetch() fallback which uses matchPath().
      if (route.path.includes('?')) continue
      const existing = byPath.get(route.path)
      if (existing) {
        existing.push(route)
      } else {
        byPath.set(route.path, [route])
      }
    }

    const bunRoutes: Record<string, unknown> = {}
    for (const [path, routes] of byPath) {
      const methods: Record<string, (req: BunRequest, srv: import('bun').Server<unknown>) => Promise<Response>> = {}
      for (const route of routes) {
        const captured = route
        methods[captured.method] = async (req: BunRequest, srv: import('bun').Server<unknown>) => {
          // Lazy plugin install (same guard as fetch())
          if (!this.installedPlugins) {
            this.installedPlugins = true
            for (const plugin of this.plugins) {
              if (plugin.install) await plugin.install(this.hooks)
            }
          }

          const url = new URL(req.url)
          const requestQueue = new RequestEventQueue()

          const baseCtx: BaseCtx = {
            req,
            params: {},
            query: parseQuery(url.search),
            json: <T>(data: T, status = 200) => Response.json(data, { status }),
            text: (data: string, status = 200) => new Response(data, { status, headers: { 'Content-Type': 'text/plain' } }),
            html: (data: string, status = 200) => new Response(data, { status, headers: { 'Content-Type': 'text/html' } }),
            stream: makeStreamResponse,
            sse:    makeSSEResponse,
            cookie: createCookieJar(req),
            emit: (event, payload) => { requestQueue.collect(event as string, payload) },
            _requestQueue: requestQueue,
          }

          // Run global onRequest hooks (before pipeline — same as fetch())
          for (const hook of this._onRequestHooks) {
            let earlyRes: Response | void
            try {
              earlyRes = await hook._fn(baseCtx)
            } catch {
              earlyRes = undefined
            }
            if (earlyRes instanceof Response) {
              return this._runOnResponse(baseCtx, earlyRes, null)
            }
          }

          // WS upgrade requests are handled by the fetch() fallback — skip here.
          // (Bun routes don't receive WS upgrade requests via the method handler.)

          // Params come from Bun's SIMD router — already extracted, always strings
          return this._runRoute(baseCtx, captured, req.params, requestQueue)
        }
      }
      bunRoutes[path] = methods
    }

    return bunRoutes
  }

  listen(
    port: number,
    cb?: (port: number) => void,
    options?: { autoHandleSignals?: boolean },
  ): ReturnType<typeof Bun.serve> {
    // Install plugins eagerly so cron handlers have access to the DB adapter
    if (!this.installedPlugins) {
      this.installedPlugins = true
      for (const plugin of this.plugins) {
        if (plugin.install) {
          const result = plugin.install(this.hooks)
          // If install returns a Promise, ignore it — sync plugins (dbPlugin) work fine here
          if (result && typeof (result as any).then === 'function') {
            (result as Promise<void>).catch((err) =>
              this._onInternalError('[veln] Plugin install error during listen():', err),
            )
          }
        }
      }
    }

    // Schedule all registered cron jobs before starting the server
    this._scheduleCrons()

    // Start Bun server — include websocket config from adapter if registered
    const server = Bun.serve({
      port,
      routes: this._buildBunRoutes(),
      fetch: (req: Request, srv: import('bun').Server<unknown>) => this.fetch(req, srv),
      ...(this._wsAdapter ? { websocket: this._wsAdapter.getWebsocketConfig() } : {}),
    } as any)  // 'as any' needed because Bun types require websocket when upgrade is used
    cb?.(port)

    // Auto-register SIGTERM/SIGINT handlers to call app.close() on shutdown.
    // Default: true. Pass { autoHandleSignals: false } to disable.
    const autoHandle = options?.autoHandleSignals !== false
    if (autoHandle) {
      let shuttingDown = false
      const shutdown = async () => {
        if (shuttingDown) return
        shuttingDown = true
        await this.close()
        process.exit(0)
      }
      process.on('SIGTERM', shutdown)
      process.on('SIGINT', shutdown)
    }

    return server
  }

  // Internal: schedule all cron defs.
  // - mode:'process' (default) — croner runs handler in-process, has access to ctx.db
  // - mode:'os' — Bun.cron delegates to a separate script file (OS-level scheduling)
  // Called once at listen(). Safe to call multiple times (idempotent — _cronDefs not cleared).
  private _scheduleCrons(): void {
    const adapter = this.hooks.getAdapter()

    const processJobs = this._cronDefs.filter(d => d._mode !== 'os')
    if (!adapter && processJobs.length > 0) {
      console.warn('[veln] .cron() jobs registered but no dbPlugin found — ctx.db will be unavailable in handlers')
    }

    for (const def of this._cronDefs) {
      console.log(`[Cron] ${def._name} — registriert (${def._expression})${def._runOnStart ? ', runOnStart' : ''}`)

      if (def._mode === 'os') {
        // OS-level — Bun.cron(script, expression, name)
        ;(Bun as unknown as { cron: (script: string, expr: string, name: string) => void })
          .cron(def._script!, def._expression, def._name)
        continue
      }

      // In-process — croner
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Cron } = require('croner') as typeof import('croner')

      const cronLogger = def._logger

      const runJob = async () => {
        const ttlMs = def._ttlMs ?? 30_000
        const acquired = await this._cronLock.acquire(def._name, ttlMs)
        if (!acquired) return  // another instance has the lock

        const start = Date.now()
        console.log(`[Cron] ${def._name} — running...`)
        try {
          const sysCtx = createSystemCtx({ role: 'cron' })
          const velnDb = adapter ? new VelnDB(adapter, this.hooks) : null
          const boundDb = velnDb ? velnDb.withCtx(sysCtx) : null as unknown as import('../db/index').BoundVelnDB

          const services = def._services.length > 0 && boundDb
            ? instantiateServices(def._services, boundDb)
            : {}

          await def._handler!({ db: boundDb, ...services }, cronLogger)
          console.log(`[Cron] ${def._name} — done (${Date.now() - start}ms)`)
        } catch (err) {
          if (def._onError) {
            def._onError(err)
          } else {
            console.error(`[Cron] ${def._name} — error:`, err)
          }
        } finally {
          await this._cronLock.release(def._name)
        }
      }

      const job = new Cron(
        def._expression,
        { name: def._name, timezone: def._timezone },
        runJob,
      )
      this._cronJobs.set(def._name, job)

      if (def._runOnStart) {
        runJob().catch((err) => {
          if (def._onError) {
            def._onError(err)
          } else {
            console.error(`[Cron] ${def._name} runOnStart error:`, err)
          }
        })
      }
    }
  }
}

/**
 * createApp — creates a new Veln application instance.
 *
 * @param opts.auth        Authentication adapter (e.g. BetterAuth). Enables `ctx.user` and permission gates.
 * @param opts.validation  Validation options. Set `exposeIssues: true` to include raw Zod issues in 422
 *                         responses (development only — masks issue details by default).
 * @param opts.eventBus    Custom event bus adapter. Defaults to `InMemoryEventBus` (single-process).
 *                         For multi-instance deployments, supply a Redis or BroadcastChannel adapter.
 * @param opts.cronLock    Distributed lock adapter for cron jobs. Defaults to `NoOpCronLockAdapter`
 *                         (always acquires). For multi-instance deployments, supply a Redis-backed adapter.
 * @param opts.nav         Navigation endpoint options. `path` sets the `/nav` endpoint URL.
 * @param opts.db          Database options. `db.log.enabled` enables query logging and N+1 detection.
 *                         `db.log.n1Threshold` sets the query count threshold (default: 10).
 *                         `db.log.logQueries` logs all SQL statements when N+1 is detected.
 *
 * @example
 * const app = createApp()
 * app.get('/ping', (ctx) => ctx.json({ ok: true }))
 * app.listen(3000)
 */
export function createApp(opts: {
  auth?: AuthAdapter
  nav?: { path?: string }
  validation?: { exposeIssues?: boolean }
  eventBus?: EventBusAdapter
  cronLock?: CronLockAdapter
  db?: { log?: { enabled?: boolean; n1Threshold?: number; logQueries?: boolean } }
} = {}): Veln<BaseCtx, Record<never, never>, never> {
  return new Veln<BaseCtx, Record<never, never>, never>(opts)
}
