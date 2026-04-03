import type { EventBus, VelnEvents } from '../events/index'
import type { BoundVelnDB } from '../db/index'
import type { ZodTypeAny, ZodIssue } from 'zod'
import { VelnError } from '../errors/index'
import { createMinimalLogger } from './logger'

// ── VelnWsAdapter — extension point for @veln/ws ─────────────────────────────
// Core holds only this minimal interface. @veln/ws provides the full implementation.
// Registered via app.registerWsAdapter(adapter).
export interface VelnWsAdapter {
  /** Called in fetch() when an HTTP Upgrade: websocket request arrives. */
  handleUpgrade(
    req: Request,
    server: import('bun').Server<unknown>,
    baseCtx: BaseCtx,
    plugins: ReadonlyArray<import('./plugin').Plugin<any, any>>,
    installedPlugins: { value: boolean },
    installedModulePlugins: Set<string>,
  ): Promise<Response | null>
  /** Returns the Bun websocket handler config. Passed to Bun.serve(). */
  getWebsocketConfig(): import('bun').WebSocketHandler<Record<string, unknown>>
  /** Registers a WS route. Called from app.ws() and app.register(). */
  registerRoute(path: string, route: WsRouteShape): void
  /** Reads all registered WS routes — used by module registration. */
  getRoute(path: string): WsRouteShape | undefined
}

/** Minimal WS route shape that Core knows about. Full type lives in @veln/ws. */
export interface WsRouteShape {
  path: string
  _module: unknown | null
  [key: string]: unknown
}


// ── Auth Payload ──────────────────────────────────────────────────────────────
// Minimal JWT/session payload shape used by WsCtx and plugins.
// @veln/jwt re-exports this as JwtPayload for backward compatibility.
export interface AuthPayload {
  sub?: string
  iat?: number
  exp?: number
  nbf?: number
  aud?: string | string[]
  iss?: string
  jti?: string
  [key: string]: unknown
}

// Key-Format: 'GET /users/:id'
export type RouteKey = `${'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'} /${string}`

export interface RouteEntry {
  params?:   ZodTypeAny
  query?:    ZodTypeAny
  body?:     ZodTypeAny
  response?: ZodTypeAny
  // Phantom field — carries the module prefix so InferProxyClient can group routes.
  // Never set at runtime. Only present when registered via defineModule().
  readonly _prefix?: string
}

export type RouteMap = Record<RouteKey, RouteEntry>

// ValidationError — thrown by validation middleware, caught by error cascade
export class ValidationError extends VelnError {
  readonly issues: ZodIssue[]

  constructor(zodError: import('zod').ZodError) {
    super('Validation failed', 422, 'VALIDATION_ERROR')
    this.name = 'ValidationError'
    this.issues = zodError.issues
  }
}

// Route Schema — all fields optional
export interface RouteSchema {
  params?:   ZodTypeAny
  query?:    ZodTypeAny
  body?:     ZodTypeAny
  response?: ZodTypeAny  // runtime no-op in Phase 4a — used by Phase 4b RPC Client
}

/** Additional response code definition for OpenAPI docs (e.g. 401, 404). */
export interface RouteResponseDoc {
  description: string
}

// RouteDocs — optional OpenAPI documentation override per route
export interface RouteDocs {
  /** Human-readable route summary shown in Scalar / Swagger UI. Auto-generated if absent. */
  summary?:     string
  /** Longer description rendered below the summary. Markdown supported. */
  description?: string
  /** Unique operationId. Auto-generated if absent (e.g. "listUsers", "getUserById"). */
  operationId?: string
  /**
   * Additional HTTP response codes to document in the OpenAPI spec.
   * The 200 success response is always generated automatically.
   * Use this to document error responses like 401, 403, 404, 422, etc.
   *
   * @example
   * docs: {
   *   responses: {
   *     401: { description: 'Unauthorized' },
   *     404: { description: 'Not found' },
   *   }
   * }
   */
  responses?: Record<number, RouteResponseDoc>
}

// Typed ctx when schemas are defined
export type InferCtx<TCtx, S extends RouteSchema> = Omit<TCtx, 'params' | 'query'> & {
  params: S['params'] extends ZodTypeAny ? import('zod').infer<S['params']> : Record<string, string>
  query:  S['query']  extends ZodTypeAny ? import('zod').infer<S['query']>  : Record<string, string | string[]>
  body:   S['body']   extends ZodTypeAny ? import('zod').infer<S['body']>   : unknown
}

// Extended RouteHandler — supports optional schema
export interface RouteHandlerWithSchema<TCtx, S extends RouteSchema> {
  params?:   S['params']
  query?:    S['query']
  body?:     S['body']
  response?: S['response']
  /** Optional OpenAPI documentation override for this route. */
  docs?:     RouteDocs
  /** Optional route-level guard — runs before the handler. Use `false` to opt out of a module-level guard. */
  guard?:    Guard<TCtx> | false
  handler:   (ctx: InferCtx<TCtx, S>) => Response | Promise<Response>
}

// ─── Streaming Support ────────────────────────────────────────────────────────

/** Controls a streaming response. Passed to the ctx.stream() writer callback. */
export interface StreamController {
  /** Push a string or binary chunk to the stream. */
  send(chunk: string | Uint8Array): void
  /** Close the stream. Must be called to end the response. */
  close(): void
}

/** Options for ctx.stream(). */
export interface StreamOptions {
  /**
   * Content-Type header for the streaming response.
   * Defaults to `'text/plain'`.
   * Use `'text/event-stream'` for SSE, `'application/x-ndjson'` for NDJSON.
   */
  contentType?: string
  /** Additional headers to include in the response. */
  headers?: Record<string, string>
  /** HTTP status code. Defaults to 200. */
  status?: number
}

// ─── SSE Support ──────────────────────────────────────────────────────────────

/**
 * Controls a Server-Sent Events stream.
 * Passed to the ctx.sse() writer callback.
 *
 * SSE wire format:
 *   event: <name>\ndata: <json>\n\n   — named event
 *   data: <json>\n\n                  — unnamed event
 *   : <text>\n\n                      — comment / keepalive
 *   id: <value>\n                     — event ID for reconnect
 *   retry: <ms>\n                     — reconnect interval
 */
export interface SseController {
  /** Send a named event with a JSON-serializable payload. */
  event(name: string, data: unknown): Promise<void>
  /** Send an unnamed data event. */
  data(data: unknown): Promise<void>
  /** Send an SSE comment (e.g. keepalive ping). */
  comment(text?: string): Promise<void>
  /** Set the last event ID (used by the browser for reconnect). */
  id(id: string): Promise<void>
  /** Tell the browser how long to wait before reconnecting (milliseconds). */
  retry(ms: number): Promise<void>
}

// Logger interface — no external dependency
export interface Logger {
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
}

// LogOptions — controls the minimal logger behaviour across all define* builders
export interface LogOptions {
  /** Minimum level to emit. Defaults to 'info'. */
  level?:  'debug' | 'info' | 'warn' | 'error'
  /** Keys whose values are replaced with '***' in structured data. Case-insensitive. */
  mask?:   string[]
  /** Suppress all output — useful in tests. */
  silent?: boolean
}

// BaseOptions — base for all define* builder .options() calls
export interface BaseOptions {
  log?: LogOptions
}

// ── AuthAdapter — minimal auth interface ──────────────────────────────────────
// Core only knows this interface. The concrete implementation lives in @oakbun/auth.
// Passed to createApp({ auth }) — if omitted the app works without auth.

export interface AuthUser {
  id: string
  permissions: string[]
}

export interface AuthAdapter {
  getUser(ctx: BaseCtx): Promise<AuthUser | null>
  hasPermission(user: AuthUser, permission: string): boolean
}

// ── BaseCtx — available in every request handler ──────────────────────────────
// ctx.events is optional — only present when eventBusPlugin() is registered
// ctx.db is optional — only present when dbPlugin() is registered
// ctx.logger is optional — only present when loggerPlugin() is registered
export interface BaseCtx {
  req: Request
  params: Record<string, string>
  query: Record<string, string | string[]>
  body?: unknown   // populated by validation middleware when body schema is defined
  json: <T>(data: T, status?: number) => Response
  text: (data: string, status?: number) => Response
  html: (data: string, status?: number) => Response
  /**
   * Returns a streaming Response backed by a ReadableStream.
   *
   * The callback receives a StreamController — call `send(chunk)` to push data
   * and `close()` to end the stream. Errors thrown inside are caught automatically.
   *
   * Set `contentType` for SSE (`'text/event-stream'`) or NDJSON (`'application/x-ndjson'`).
   * Compression is automatically skipped for streaming responses.
   *
   * @example
   * return ctx.stream((stream) => {
   *   stream.send('data: hello\n\n')
   *   stream.send('data: world\n\n')
   *   stream.close()
   * }, { contentType: 'text/event-stream' })
   */
  stream: (
    writer: (controller: StreamController) => void | Promise<void>,
    options?: StreamOptions,
  ) => Response
  /**
   * Returns a Server-Sent Events Response.
   *
   * The callback receives an SseController — call `event()`, `data()`,
   * `comment()`, `id()`, or `retry()` to push SSE frames, then let the
   * callback return (or the async iterator complete) to close the stream.
   *
   * @example
   * return ctx.sse(async (sse) => {
   *   await sse.event('connected', { userId: '42' })
   *   for await (const update of source()) {
   *     await sse.event('update', update)
   *     await sse.comment('keepalive')
   *   }
   * })
   */
  sse: (writer: (controller: SseController) => void | Promise<void>) => Response
  events?: EventBus
  logger?: Logger
  db?: BoundVelnDB
  cookie: import('./cookies').CookieJar
  // Typed event emission into the per-request RequestEventQueue.
  // Fire & forget — buffered until after onResponse, then flushed to EventBus.
  emit: <K extends keyof VelnEvents>(event: K, payload: VelnEvents[K]) => void
  // _requestQueue: framework-internal. Set by fetch() before plugins run.
  // dbPlugin reads it to bind the queue to BoundVelnDB.
  // Never exposed to user-land handlers — prefixed _ to signal framework-only.
  _requestQueue?: import('../events/index').RequestEventQueue
  // _queryLog: framework-internal. Set by fetch() when N+1 detection is enabled.
  // dbPlugin reads it and passes it to BoundVelnDB to count queries per request.
  // Never exposed to user-land handlers — prefixed _ to signal framework-only.
  _queryLog?: import('../db/index').QueryLog
  // _startTime: optional timing field, set by timing middleware.
  _startTime?: number
}

// Guard — pure predicate, never extends ctx
export type Guard<TCtx> = (ctx: TCtx) => Response | null | Promise<Response | null>

// createGuard — typing helper. TAdd is the ctx extension the guard needs.
// BaseCtx is always present — user only declares what they add on top.
// @deprecated Use defineGuard() for the fluent builder API.
export function createGuard<TAdd extends object = object>(
  fn: (ctx: BaseCtx & TAdd) => Response | null | Promise<Response | null>,
): Guard<BaseCtx & TAdd> {
  return fn
}

// ── defineGuard — fluent builder ──────────────────────────────────────────────

/**
 * defineGuard — creates a named guard that protects routes or modules.
 *
 * Call `.check(fn)` to seal into a `Guard`. Throw any error or return a `Response`
 * inside `fn` to block the request; return normally to allow it through.
 *
 * @param name  Used in log output for tracing which guard triggered.
 *
 * @example
 * const authGuard = defineGuard('auth')
 *   .check<{ user: AuthUser }>((ctx) => {
 *     if (!ctx.user) throw new UnauthorizedError()
 *   })
 */
class GuardBuilder {
  private _options: BaseOptions = {}

  constructor(private readonly _name: string) {}

  options(opts: BaseOptions): this {
    this._options = opts
    return this
  }

  check<TAdd extends object = object>(
    fn: (ctx: BaseCtx & TAdd) => void | Promise<void>,
  ): Guard<BaseCtx & TAdd> {
    const logger = createMinimalLogger(`guard:${this._name}`, this._options.log)
    const name = this._name
    return async (ctx: BaseCtx & TAdd): Promise<Response | null> => {
      logger.debug('check', { guard: name })
      try {
        await fn(ctx)
        return null
      } catch (err) {
        logger.warn('blocked', { guard: name })
        throw err
      }
    }
  }
}

/** @see GuardBuilder */
export function defineGuard(name: string): GuardBuilder {
  return new GuardBuilder(name)
}

// ErrorHandler
export type ErrorHandler<TCtx = BaseCtx> = (err: unknown, ctx: TCtx) => Response | Promise<Response>

// Route handler — object style so Phase 4 can add body/params/query schemas non-breakingly
export interface RouteHandler<TCtx> {
  handler: (ctx: TCtx) => Response | Promise<Response>
}

// ─── Lifecycle Hook Types ──────────────────────────────────────────────────────
//
// Three distinct phases — framework always runs them in this order regardless
// of registration order:
//   1. onRequest   — fires before plugins; always runs (even on guard block / plugin error)
//   2. onBeforeHandle — fires after guards pass; skipped when a guard blocks
//   3. onResponse  — fires after handler (or after error); always runs
//
// TCtx for onRequest is BaseCtx (plugins not yet applied).
// TCtx for onBeforeHandle / onResponse is the full ctx including plugin extensions.

// onRequest: receives raw BaseCtx — plugins have NOT run yet.
// Return a Response to short-circuit (replaces 404 / guard / handler entirely).
// Return void to continue.
export type OnRequestFn<TCtx extends BaseCtx = BaseCtx> = (
  ctx: TCtx,
) => Response | void | Promise<Response | void>

// onBeforeHandle: runs after guards pass, before handler.
// Return a Response to short-circuit the handler.
// Return void to continue.
export type OnBeforeHandleFn<TCtx extends BaseCtx = BaseCtx> = (
  ctx: TCtx,
) => Response | void | Promise<Response | void>

// onResponse: always runs; receives the final response (or undefined on plugin/guard error
// before a response was produced — framework provides a 500 fallback in that case).
// Return a new Response to replace it, or void to keep the current response.
export type OnResponseFn<TCtx extends BaseCtx = BaseCtx> = (
  ctx: TCtx,
  response: Response,
) => Response | void | Promise<Response | void>

// Tagged wrappers — distinguishable from plain functions at runtime
export interface OnRequestHook<TCtx extends BaseCtx = BaseCtx> {
  readonly _phase: 'onRequest'
  readonly _fn: OnRequestFn<TCtx>
}

export interface OnBeforeHandleHook<TCtx extends BaseCtx = BaseCtx> {
  readonly _phase: 'onBeforeHandle'
  readonly _fn: OnBeforeHandleFn<TCtx>
}

export interface OnResponseHook<TCtx extends BaseCtx = BaseCtx> {
  readonly _phase: 'onResponse'
  readonly _fn: OnResponseFn<TCtx>
}

// ─── createX helpers ──────────────────────────────────────────────────────────
// TAdd is the ctx extension needed; user doesn't write BaseCtx & TAdd

export function createOnRequest<TAdd extends object = object>(
  fn: OnRequestFn<BaseCtx & TAdd>,
): OnRequestHook<BaseCtx & TAdd> {
  return { _phase: 'onRequest', _fn: fn }
}

export function createOnBeforeHandle<TAdd extends object = object>(
  fn: OnBeforeHandleFn<BaseCtx & TAdd>,
): OnBeforeHandleHook<BaseCtx & TAdd> {
  return { _phase: 'onBeforeHandle', _fn: fn }
}

export function createOnResponse<TAdd extends object = object>(
  fn: OnResponseFn<BaseCtx & TAdd>,
): OnResponseHook<BaseCtx & TAdd> {
  return { _phase: 'onResponse', _fn: fn }
}

// Internal route record
export interface Route<TCtx = BaseCtx> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string          // e.g. '/users/:id'
  summary?:     string
  description?: string
  /** OpenAPI documentation override set via the `docs` option on route registration. */
  docs?:        RouteDocs
  handler: RouteHandler<TCtx>
  guards: Guard<TCtx>[]
  onError?: ErrorHandler<TCtx>
  schema?: RouteSchema
  visibility?: 'public' | 'hidden'
  // Set when the route definition has guard: false — skips module-level guards for this route.
  moduleGuardOptOut?: true
  // Reference to the module this route belongs to (set during registration)
  _module?: import('./module').VelnModule
  // Plugin that contributed this route via .modules() — set by app.plugin() so the
  // permission check in _runRoute can look up the right plugin without a separate Map.
  _pluginName?: string
}
