import type { Guard, ErrorHandler, RouteHandler, Route, OnRequestHook, OnBeforeHandleHook, OnResponseHook, RouteHandlerWithSchema, RouteSchema, RouteMap, RouteDocs, WsRouteShape, BaseOptions } from './types'
import { createOnRequest, createOnResponse } from './types'
import type { Plugin } from './plugin'
import type { TableDef, SchemaMap } from '../schema/table'
import type { ModuleHookHandlers } from '../hooks/types'
import type { BaseCtx } from './types'
import type { AuditConfig } from '../schema/audit'
import type { ServiceDef } from '../service/index'
import type { ZodTypeAny } from 'zod'
import type { EventHandlerDef } from '../events/handler'
import type { CronDef } from '../cron/index'
import type { MiddlewareDef } from './middleware'
import { z } from 'zod'

export interface HookDeclaration<T, TCtx> {
  table: TableDef<T, any>
  handlers: ModuleHookHandlers<T, TCtx>
}

// AuditDeclaration — carries table + config only.
// No adapter, no handler closures here.
// app.register() injects the adapter and wires the hooks.
export interface AuditDeclaration<T, TCtx, S extends SchemaMap> {
  table:  TableDef<T, any>
  config: AuditConfig<TCtx, T, S>
}

// ServiceDeclaration — carries a ServiceDef only.
// Framework instantiates per-request in fetch() after plugins run.
export interface ServiceDeclaration<TKey extends string, TDef> {
  readonly service: ServiceDef<TKey, TDef>
}

export interface VelnModule {
  prefix: string
  routes: Route<any>[]
  wsRoutes: WsRouteShape[]
  hookDeclarations: HookDeclaration<any, any>[]
  auditDeclarations: AuditDeclaration<any, any, any>[]
  serviceDeclarations: ReadonlyArray<ServiceDeclaration<string, unknown>>
  plugins: Plugin<any, any>[]
  guards: Guard<any>[]
  onRequestHooks: OnRequestHook<any>[]
  onBeforeHandleHooks: OnBeforeHandleHook<any>[]
  onResponseHooks: OnResponseHook<any>[]
  onError?: ErrorHandler<any>
  eventHandlerDefs: EventHandlerDef[]
  cronDefs: CronDef<Record<string, unknown>>[]
  visibility: 'public' | 'hidden'
  meta?: { tag?: string; description?: string }
  options?: BaseOptions
}

// ── ModuleBuilderState ───────────────────────────────────────────────────────
// All builder state in one object — clone() spreads it with one override.
// Adding a new field costs: (1) add here, (2) add to create(), (3) add to build().
// Zero call-site changes needed anywhere else.

interface ModuleBuilderState {
  prefix: string
  plugins: Plugin<any, any>[]
  hookDeclarations: HookDeclaration<any, any>[]
  auditDeclarations: AuditDeclaration<any, any, any>[]
  serviceDeclarations: ReadonlyArray<ServiceDeclaration<string, unknown>>
  routes: Route<any>[]
  wsRoutes: WsRouteShape[]
  guards: Guard<any>[]
  onRequestHooks: OnRequestHook<any>[]
  onBeforeHandleHooks: OnBeforeHandleHook<any>[]
  onResponseHooks: OnResponseHook<any>[]
  onError: ErrorHandler<any> | undefined
  eventHandlerDefs: EventHandlerDef[]
  cronDefs: CronDef<Record<string, unknown>>[]
  visibility: 'public' | 'hidden'
  meta: { tag?: string; description?: string } | undefined
  options: BaseOptions | undefined
}

// RouteDefinition — used by .route(). Generics kept for type inference at call site.
// The interface itself stays non-generic to allow storage; the .route() method
// carries the generics so z.infer<TBody> resolves immediately.
export interface RouteDefinition<TCtx extends BaseCtx> {
  method:       'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path:         string
  summary?:     string
  description?: string
  docs?:        RouteDocs
  visibility?:  'public' | 'hidden'
  schema?:      RouteSchema
  handler:      (ctx: TCtx) => Response | Promise<Response>
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

function normalizeHandler<TCtx, S extends RouteSchema>(
  handler: RouteHandler<TCtx> | ((ctx: TCtx) => Response | Promise<Response>) | RouteHandlerWithSchema<TCtx, S>,
): { handler: RouteHandler<TCtx>; schema: RouteSchema | undefined; docs: RouteDocs | undefined } {
  if (typeof handler === 'function') {
    return { handler: { handler }, schema: undefined, docs: undefined }
  }
  if ('params' in handler || 'query' in handler || 'body' in handler || 'response' in handler || 'docs' in handler) {
    const h = handler as RouteHandlerWithSchema<TCtx, RouteSchema>
    return {
      handler: { handler: h.handler as (ctx: TCtx) => Response | Promise<Response> },
      schema: { params: h.params, query: h.query, body: h.body, response: h.response },
      docs: h.docs,
    }
  }
  return { handler: handler as RouteHandler<TCtx>, schema: undefined, docs: undefined }
}

export class ModuleBuilder<TCtx extends BaseCtx, TPrefix extends string = string, TRoutes extends RouteMap = Record<never, never>> {
  // Phantom fields — never assigned at runtime, used only for type extraction
  declare readonly _routes: TRoutes
  declare readonly _prefix: TPrefix

  private constructor(protected readonly _state: ModuleBuilderState) {}

  // clone() — the only place new ModuleBuilder is constructed after create().
  // Every builder method calls clone() with one override — adding a field
  // to ModuleBuilderState never requires touching existing methods.
  protected clone<NCtx extends BaseCtx = TCtx, NPrefix extends string = TPrefix, NRoutes extends RouteMap = TRoutes>(
    overrides: Partial<ModuleBuilderState>,
  ): ModuleBuilder<NCtx, NPrefix, NRoutes> {
    return new ModuleBuilder<NCtx, NPrefix, NRoutes>({ ...this._state, ...overrides })
  }

  // Framework-internal accessor — used by @veln/ws module augmentation.
  // Not part of the public API — prefixed with _ to signal framework-only.
  get _wsRoutes(): WsRouteShape[] { return this._state.wsRoutes }

  static create<TPrefix extends string>(prefix: TPrefix): ModuleBuilder<BaseCtx, TPrefix, Record<never, never>> {
    return new ModuleBuilder<BaseCtx, TPrefix, Record<never, never>>({
      prefix,
      plugins:             [],
      hookDeclarations:    [],
      auditDeclarations:   [],
      serviceDeclarations: [],
      routes:              [],
      wsRoutes:            [],
      guards:              [],
      onRequestHooks:      [],
      onBeforeHandleHooks: [],
      onResponseHooks:     [],
      onError:             undefined,
      eventHandlerDefs:    [],
      cronDefs:            [],
      visibility:          'public',
      meta:                undefined,
      options:             undefined,
    })
  }

  options(opts: BaseOptions): ModuleBuilder<TCtx, TPrefix, TRoutes> {
    return this.clone({ options: opts })
  }

  visibility(v: 'public' | 'hidden'): ModuleBuilder<TCtx, TPrefix, TRoutes> {
    return this.clone({ visibility: v })
  }

  plugin<TAdd extends object>(p: Plugin<TCtx, TAdd>): ModuleBuilder<TCtx & TAdd, TPrefix, TRoutes> {
    const next = this.clone({ plugins: [...this._state.plugins, p as Plugin<any, any>] })
    return next as unknown as ModuleBuilder<TCtx & TAdd, TPrefix, TRoutes>
  }

  // ── .use() ───────────────────────────────────────────────────────────────
  // Service overload: declares a service dep for this module.
  // Middleware overload: registers onRequest/onResponse hooks module-scoped.
  use<TKey extends string, TDef>(
    service: ServiceDef<TKey, TDef>,
  ): ModuleBuilder<TCtx & Record<TKey, TDef>, TPrefix, TRoutes>
  use(middleware: MiddlewareDef): ModuleBuilder<TCtx, TPrefix, TRoutes>
  use<TKey extends string, TDef>(
    serviceOrMiddleware: ServiceDef<TKey, TDef> | MiddlewareDef,
  ): ModuleBuilder<TCtx & Record<TKey, TDef>, TPrefix, TRoutes> | ModuleBuilder<TCtx, TPrefix, TRoutes> {
    if ('_serviceKey' in serviceOrMiddleware) {
      const decl: ServiceDeclaration<TKey, TDef> = { service: serviceOrMiddleware }
      const next = this.clone({
        serviceDeclarations: [...this._state.serviceDeclarations, decl as ServiceDeclaration<string, unknown>],
      })
      return next as unknown as ModuleBuilder<TCtx & Record<TKey, TDef>, TPrefix, TRoutes>
    }
    // MiddlewareDef — wire hooks
    const m = serviceOrMiddleware as MiddlewareDef
    const overrides: Partial<ModuleBuilderState> = {}
    if (m._onRequest) {
      overrides.onRequestHooks = [...this._state.onRequestHooks, createOnRequest(m._onRequest)]
    }
    if (m._onResponse) {
      overrides.onResponseHooks = [...this._state.onResponseHooks, createOnResponse(m._onResponse)]
    }
    return this.clone(overrides)
  }

  guard(g: Guard<TCtx>): ModuleBuilder<TCtx, TPrefix, TRoutes> {
    return this.clone({ guards: [...this._state.guards, g as Guard<any>] })
  }

  onRequest(hook: OnRequestHook<TCtx>): ModuleBuilder<TCtx, TPrefix, TRoutes> {
    return this.clone({ onRequestHooks: [...this._state.onRequestHooks, hook as OnRequestHook<any>] })
  }

  onBeforeHandle(hook: OnBeforeHandleHook<TCtx>): ModuleBuilder<TCtx, TPrefix, TRoutes> {
    return this.clone({ onBeforeHandleHooks: [...this._state.onBeforeHandleHooks, hook as OnBeforeHandleHook<any>] })
  }

  onResponse(hook: OnResponseHook<TCtx>): ModuleBuilder<TCtx, TPrefix, TRoutes> {
    return this.clone({ onResponseHooks: [...this._state.onResponseHooks, hook as OnResponseHook<any>] })
  }

  hook<T>(table: TableDef<T, any>, handlers: ModuleHookHandlers<T, TCtx>): ModuleBuilder<TCtx, TPrefix, TRoutes> {
    return this.clone({ hookDeclarations: [...this._state.hookDeclarations, { table, handlers }] })
  }

  // ── .audit() ─────────────────────────────────────────────────────────────
  // Declares that this table should be audited with the given config.
  // No hooks are built here — no adapter, no closures.
  // app.register() receives the AuditDeclaration and wires the adapter there.
  audit<T extends Record<string, unknown>, S extends SchemaMap>(
    table: TableDef<T, any>,
    config: AuditConfig<TCtx, T, S>,
  ): ModuleBuilder<TCtx, TPrefix, TRoutes> {
    const decl: AuditDeclaration<T, TCtx, S> = { table, config }
    return this.clone({ auditDeclarations: [...this._state.auditDeclarations, decl] })
  }

  events(handler: EventHandlerDef): ModuleBuilder<TCtx, TPrefix, TRoutes> {
    return this.clone({ eventHandlerDefs: [...this._state.eventHandlerDefs, handler] })
  }

  cron(def: CronDef): ModuleBuilder<TCtx, TPrefix, TRoutes> {
    return this.clone({ cronDefs: [...this._state.cronDefs, def] })
  }

  private _addRoute<S extends RouteSchema>(
    method: HttpMethod,
    path: string,
    handlerArg: RouteHandler<TCtx> | ((ctx: TCtx) => Response | Promise<Response>) | RouteHandlerWithSchema<TCtx, S>,
  ): ModuleBuilder<TCtx, TPrefix, TRoutes> {
    const { handler, schema, docs } = normalizeHandler(handlerArg)
    const guardDef = typeof handlerArg === 'object' && 'handler' in handlerArg && !('_phase' in handlerArg)
      ? (handlerArg as RouteHandlerWithSchema<TCtx, S>).guard
      : undefined
    const route: Route<any> = {
      method, path, handler, schema, docs,
      guards:            guardDef != null && guardDef !== false ? [guardDef as Guard<unknown>] : [],
      moduleGuardOptOut: guardDef === false ? true : undefined,
    }
    return this.clone({ routes: [...this._state.routes, route] })
  }

  // ── .route() ─────────────────────────────────────────────────────────────
  //
  // Analysis (Spec 05):
  //   1. Method shortcuts ARE wrappers around _registerMethod() → _addRoute().
  //   2. Body/params/query schemas are stored in route.schema; validation runs at
  //      request time in the framework fetch() pipeline.
  //   3. Generics TBody/TParams/etc flow into RouteMap via the typed overload return
  //      type: Record<`METHOD ${TPrefix}${TPath}`, { body, params, query, response, _prefix }>.
  //   4. Old .route() built the Route object manually, used a nested `schema:{}` wrapper,
  //      and returned ModuleBuilder without updating TRoutes.
  //
  // Implementation: delegate to _registerMethod() so validation logic is shared
  // (no duplication). The typed overload updates TRoutes just like .get()/.post() etc.
  // Backward compat: top-level `summary` and nested `schema:{}` both still work.

  // Overload 1 — legacy: nested `schema:{}` wrapper (backward compat, tried first so
  // calls with `schema` don't fall through to the flat overload)
  route<
    TBody   extends ZodTypeAny = never,
    TParams extends ZodTypeAny = never,
    TQuery  extends ZodTypeAny = never,
  >(def: {
    method:       HttpMethod
    path:         string
    /** @deprecated Use docs.summary instead */
    summary?:     string
    description?: string
    docs?:        RouteDocs
    visibility?:  'public' | 'hidden'
    schema?: {
      body?:     TBody
      params?:   TParams
      query?:    TQuery
      response?: ZodTypeAny
    }
    handler: (ctx: TCtx & {
      body:   z.infer<TBody>
      params: z.infer<TParams>
      query:  z.infer<TQuery>
    }) => Response | Promise<Response>
  }): ModuleBuilder<TCtx, TPrefix, TRoutes>
  // Overload 2 — fully typed: flat body/params/query/response + updates RouteMap.
  // NoInfer<TBody/TParams/TQuery> in the handler parameter prevents TypeScript from
  // trying to infer the generics from the handler (which would cause a circular
  // dependency with the `body:`, `params:`, `query:` fields in the same object literal).
  // TypeScript infers the generics from the schema fields first, then contextually
  // types the handler using NoInfer — the same pattern used by tRPC and similar frameworks.
  route<
    TMethod   extends HttpMethod  = HttpMethod,
    TBody     extends ZodTypeAny  = never,
    TParams   extends ZodTypeAny  = never,
    TQuery    extends ZodTypeAny  = never,
    TResponse extends ZodTypeAny  = never,
    TPath     extends string      = string,
  >(def: {
    method:    TMethod
    path:      TPath
    body?:     TBody
    params?:   TParams
    query?:    TQuery
    response?: TResponse
    docs?:     RouteDocs
    guard?:    Guard<TCtx> | false
    /** @deprecated Use docs.summary instead */
    summary?:     string
    description?: string
    visibility?:  'public' | 'hidden'
    handler: (ctx: TCtx & {
      body:   z.infer<NoInfer<TBody>>
      params: z.infer<NoInfer<TParams>>
      query:  z.infer<NoInfer<TQuery>>
    }) => Response | Promise<Response>
  }): ModuleBuilder<TCtx, TPrefix, TRoutes & Record<`${TMethod} ${TPrefix}${TPath}`, { body: TBody; params: TParams; query: TQuery; response: TResponse; _prefix: TPrefix }>>
  // Implementation — handles both overloads
  route(def: {
    method:       HttpMethod
    path:         string
    body?:        ZodTypeAny
    params?:      ZodTypeAny
    query?:       ZodTypeAny
    response?:    ZodTypeAny
    docs?:        RouteDocs
    guard?:       Guard<TCtx> | false
    summary?:     string
    description?: string
    visibility?:  'public' | 'hidden'
    schema?: {
      body?:     ZodTypeAny
      params?:   ZodTypeAny
      query?:    ZodTypeAny
      response?: ZodTypeAny
    }
    handler: (ctx: TCtx) => Response | Promise<Response>
  }): ModuleBuilder<TCtx, TPrefix, RouteMap> {
    // Normalize docs — merge deprecated top-level summary into docs.summary
    let docs = def.docs
    if (def.summary !== undefined) {
      docs = { ...docs, summary: docs?.summary ?? def.summary }
    }
    // Support both flat (new) and nested schema (legacy) forms
    const body     = def.body     ?? def.schema?.body
    const params   = def.params   ?? def.schema?.params
    const query    = def.query    ?? def.schema?.query
    const response = def.response ?? def.schema?.response
    // Build the defOrHandler object for _registerMethod — identical shape to method shortcuts
    const defObj: { body?: ZodTypeAny; params?: ZodTypeAny; query?: ZodTypeAny; response?: ZodTypeAny; docs?: RouteDocs; handler: (ctx: TCtx) => Response | Promise<Response> } = {
      body,
      params,
      query,
      response,
      docs,
      handler: def.handler,
    }
    // Register via shared _registerMethod — no duplication of validation logic.
    // We pre-build the route so we can patch legacy fields (summary, description,
    // visibility, guard) before cloning — all within the same class so _state is accessible.
    const { handler: rh, schema, docs: normalizedDocs } = normalizeHandler(defObj)
    const route: Route<TCtx> = {
      method:      def.method,
      path:        def.path,
      summary:     def.summary,
      description: def.description,
      visibility:  def.visibility,
      docs:        normalizedDocs,
      handler:     rh,
      guards:           def.guard != null && def.guard !== false ? [def.guard as Guard<unknown>] : [],
      moduleGuardOptOut: def.guard === false ? true : undefined,
      schema,
    }
    return this.clone({ routes: [...this._state.routes, route] })
  }

  meta(m: { tag?: string; description?: string }): ModuleBuilder<TCtx, TPrefix, TRoutes> {
    return this.clone({ meta: m })
  }

  // ── HTTP methods ─────────────────────────────────────────────────────────
  // Two overloads per method:
  //   1. (path, { body?, params?, query?, response?, handler }) — separate generics,
  //      z.infer<TBody> resolved immediately — no deferred conditional, no unknown body
  //   2. (path, handler)  — plain function, no schema
  //
  // The (path, schema, handler) 3-arg form is intentionally omitted — use overload 1.

  private _registerMethod(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    defOrHandler: { body?: ZodTypeAny; params?: ZodTypeAny; query?: ZodTypeAny; response?: ZodTypeAny; docs?: RouteDocs; guard?: Guard<TCtx> | false; handler: (ctx: any) => Response | Promise<Response> } | RouteHandler<TCtx> | ((ctx: TCtx) => Response | Promise<Response>),
  ): ModuleBuilder<TCtx, TPrefix, RouteMap> {
    if (typeof defOrHandler === 'object' && 'handler' in defOrHandler && typeof defOrHandler.handler === 'function' && !('_phase' in defOrHandler)) {
      const { handler, body, params, query, response, docs, guard } = defOrHandler as { handler: (ctx: TCtx) => Response | Promise<Response>; body?: ZodTypeAny; params?: ZodTypeAny; query?: ZodTypeAny; response?: ZodTypeAny; docs?: RouteDocs; guard?: Guard<TCtx> | false }
      return this._addRoute(method, path, { handler, body, params, query, response, docs, guard } as RouteHandlerWithSchema<TCtx, RouteSchema>)
    }
    return this._addRoute(method, path, defOrHandler as RouteHandler<TCtx> | ((ctx: TCtx) => Response | Promise<Response>))
  }

  get<
    TBody     extends ZodTypeAny = never,
    TParams   extends ZodTypeAny = never,
    TQuery    extends ZodTypeAny = never,
    TResponse extends ZodTypeAny = never,
    TPath     extends string     = string,
  >(path: TPath, def: {
    body?:     TBody
    params?:   TParams
    query?:    TQuery
    response?: TResponse
    docs?:     RouteDocs
    guard?:    Guard<TCtx> | false
    handler: (ctx: TCtx & { body: z.infer<TBody>; params: z.infer<TParams>; query: z.infer<TQuery> }) => Response | Promise<Response>
  }): ModuleBuilder<TCtx, TPrefix, TRoutes & Record<`GET ${TPrefix}${TPath}`, { body: TBody; params: TParams; query: TQuery; response: TResponse; _prefix: TPrefix }>>
  get(path: string, handler: RouteHandler<TCtx> | ((ctx: TCtx) => Response | Promise<Response>)): ModuleBuilder<TCtx, TPrefix, TRoutes>
  get(path: string, defOrHandler: Parameters<typeof this._registerMethod>[2]): ModuleBuilder<TCtx, TPrefix, RouteMap> {
    return this._registerMethod('GET', path, defOrHandler)
  }

  post<
    TBody     extends ZodTypeAny = never,
    TParams   extends ZodTypeAny = never,
    TQuery    extends ZodTypeAny = never,
    TResponse extends ZodTypeAny = never,
    TPath     extends string     = string,
  >(path: TPath, def: {
    body?:     TBody
    params?:   TParams
    query?:    TQuery
    response?: TResponse
    docs?:     RouteDocs
    guard?:    Guard<TCtx> | false
    handler: (ctx: TCtx & { body: z.infer<TBody>; params: z.infer<TParams>; query: z.infer<TQuery> }) => Response | Promise<Response>
  }): ModuleBuilder<TCtx, TPrefix, TRoutes & Record<`POST ${TPrefix}${TPath}`, { body: TBody; params: TParams; query: TQuery; response: TResponse; _prefix: TPrefix }>>
  post(path: string, handler: RouteHandler<TCtx> | ((ctx: TCtx) => Response | Promise<Response>)): ModuleBuilder<TCtx, TPrefix, TRoutes>
  post(path: string, defOrHandler: Parameters<typeof this._registerMethod>[2]): ModuleBuilder<TCtx, TPrefix, RouteMap> {
    return this._registerMethod('POST', path, defOrHandler)
  }

  put<
    TBody     extends ZodTypeAny = never,
    TParams   extends ZodTypeAny = never,
    TQuery    extends ZodTypeAny = never,
    TResponse extends ZodTypeAny = never,
    TPath     extends string     = string,
  >(path: TPath, def: {
    body?:     TBody
    params?:   TParams
    query?:    TQuery
    response?: TResponse
    docs?:     RouteDocs
    guard?:    Guard<TCtx> | false
    handler: (ctx: TCtx & { body: z.infer<TBody>; params: z.infer<TParams>; query: z.infer<TQuery> }) => Response | Promise<Response>
  }): ModuleBuilder<TCtx, TPrefix, TRoutes & Record<`PUT ${TPrefix}${TPath}`, { body: TBody; params: TParams; query: TQuery; response: TResponse; _prefix: TPrefix }>>
  put(path: string, handler: RouteHandler<TCtx> | ((ctx: TCtx) => Response | Promise<Response>)): ModuleBuilder<TCtx, TPrefix, TRoutes>
  put(path: string, defOrHandler: Parameters<typeof this._registerMethod>[2]): ModuleBuilder<TCtx, TPrefix, RouteMap> {
    return this._registerMethod('PUT', path, defOrHandler)
  }

  patch<
    TBody     extends ZodTypeAny = never,
    TParams   extends ZodTypeAny = never,
    TQuery    extends ZodTypeAny = never,
    TResponse extends ZodTypeAny = never,
    TPath     extends string     = string,
  >(path: TPath, def: {
    body?:     TBody
    params?:   TParams
    query?:    TQuery
    response?: TResponse
    docs?:     RouteDocs
    guard?:    Guard<TCtx> | false
    handler: (ctx: TCtx & { body: z.infer<TBody>; params: z.infer<TParams>; query: z.infer<TQuery> }) => Response | Promise<Response>
  }): ModuleBuilder<TCtx, TPrefix, TRoutes & Record<`PATCH ${TPrefix}${TPath}`, { body: TBody; params: TParams; query: TQuery; response: TResponse; _prefix: TPrefix }>>
  patch(path: string, handler: RouteHandler<TCtx> | ((ctx: TCtx) => Response | Promise<Response>)): ModuleBuilder<TCtx, TPrefix, TRoutes>
  patch(path: string, defOrHandler: Parameters<typeof this._registerMethod>[2]): ModuleBuilder<TCtx, TPrefix, RouteMap> {
    return this._registerMethod('PATCH', path, defOrHandler)
  }

  delete<
    TBody     extends ZodTypeAny = never,
    TParams   extends ZodTypeAny = never,
    TQuery    extends ZodTypeAny = never,
    TResponse extends ZodTypeAny = never,
    TPath     extends string     = string,
  >(path: TPath, def: {
    body?:     TBody
    params?:   TParams
    query?:    TQuery
    response?: TResponse
    docs?:     RouteDocs
    guard?:    Guard<TCtx> | false
    handler: (ctx: TCtx & { body: z.infer<TBody>; params: z.infer<TParams>; query: z.infer<TQuery> }) => Response | Promise<Response>
  }): ModuleBuilder<TCtx, TPrefix, TRoutes & Record<`DELETE ${TPrefix}${TPath}`, { body: TBody; params: TParams; query: TQuery; response: TResponse; _prefix: TPrefix }>>
  delete(path: string, handler: RouteHandler<TCtx> | ((ctx: TCtx) => Response | Promise<Response>)): ModuleBuilder<TCtx, TPrefix, TRoutes>
  delete(path: string, defOrHandler: Parameters<typeof this._registerMethod>[2]): ModuleBuilder<TCtx, TPrefix, RouteMap> {
    return this._registerMethod('DELETE', path, defOrHandler)
  }

  onError(handler: ErrorHandler<TCtx>): ModuleBuilder<TCtx, TPrefix, TRoutes> {
    return this.clone({ onError: handler as ErrorHandler<any> })
  }

  build(): VelnModule & { readonly _routes: TRoutes; readonly _prefix: TPrefix } {
    const s = this._state
    const mod: VelnModule = {
      prefix:              s.prefix,
      routes:              [...s.routes],
      wsRoutes:            [...s.wsRoutes],
      hookDeclarations:    [...s.hookDeclarations],
      auditDeclarations:   [...s.auditDeclarations],
      serviceDeclarations: [...s.serviceDeclarations],
      plugins:             [...s.plugins],
      guards:              [...s.guards],
      onRequestHooks:      [...s.onRequestHooks],
      onBeforeHandleHooks: [...s.onBeforeHandleHooks],
      onResponseHooks:     [...s.onResponseHooks],
      onError:             s.onError,
      eventHandlerDefs:    [...s.eventHandlerDefs],
      cronDefs:            [...s.cronDefs],
      visibility:          s.visibility,
      meta:                s.meta,
      options:             s.options,
    }
    // Phantom cast — _routes and _prefix don't exist at runtime,
    // they only carry type information for createProxyClient / .module()
    return mod as VelnModule & { readonly _routes: TRoutes; readonly _prefix: TPrefix }
  }
}

/**
 * defineModule — groups routes, guards, services, and cron jobs under a shared prefix.
 *
 * @param prefix  URL prefix for all routes in this module (e.g. `'/users'`).
 *
 * Supply a `TCtx` generic to get typed handlers without casts:
 *   `defineModule<BaseCtx & { user: AuthUser }>('/admin')`
 *
 * @example
 * const usersModule = defineModule('/users')
 *   .get('/', (ctx) => ctx.json([]))
 *   .build()
 * app.register(usersModule)
 */
export function defineModule<TCtx extends BaseCtx = BaseCtx, TPrefix extends string = string>(
  prefix: TPrefix,
): ModuleBuilder<TCtx, TPrefix, Record<never, never>> {
  // ModuleBuilder.create() always returns ModuleBuilder<BaseCtx, ...>.
  // We cast to the caller-supplied TCtx here — this is the only cast needed,
  // and it's in the framework internals, not user code.
  return ModuleBuilder.create(prefix) as unknown as ModuleBuilder<TCtx, TPrefix, Record<never, never>>
}
