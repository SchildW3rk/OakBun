import type { ZodTypeAny } from 'zod'
import type { AuthPayload } from 'oakbun'
import type { BoundVelnDB } from '../../core/src/db/index'

// ── WsCtx ─────────────────────────────────────────────────────────────────────
//
// Passed to every WS lifecycle callback (open, message, close, drain).
// ctx.user and ctx.db are optional: present only when jwtPlugin / dbPlugin were
// registered on the app before the upgrade.

export interface WsCtx<TData = unknown> {
  /** Matched path params, e.g. { roomId: '42' } for /rooms/:roomId */
  params: Record<string, string>
  /** Parsed query string from the upgrade request */
  query:  Record<string, string | string[]>
  /**
   * The Bun ServerWebSocket — use ws.send(), ws.close(), ws.subscribe(), etc.
   * Typed with `data: WsCtxData` so ws.data carries ctx.user etc.
   */
  ws:     import('bun').ServerWebSocket<WsCtxData>
  /**
   * Validated & typed message payload.
   * Only set inside onMessage() when a message schema was defined.
   * Undefined in open / close / drain.
   */
  data:   TData
  /** Set by jwtPlugin when registered on the app. undefined otherwise. */
  user?:  AuthPayload
  /** Set by dbPlugin when registered on the app. undefined otherwise. */
  db?:    BoundVelnDB
}

// Internal data stored on each ws.data — carries full context from upgrade phase
export interface WsCtxData {
  _wsPath:  string
  params:   Record<string, string>
  query:    Record<string, string | string[]>
  user?:    AuthPayload
  db?:      BoundVelnDB
  // Extra fields passed from plugin-extended ctx
  [key: string]: unknown
  // Typed message — populated during message dispatch
  _data?:   unknown
}

// ── WsHandlers ────────────────────────────────────────────────────────────────

export interface WsHandlers<TMsg = unknown> {
  /** Called when a client opens a connection. ctx.data is undefined here. */
  open?:    (ctx: WsCtx<undefined>) => void | Promise<void>
  /**
   * Called for each incoming message.
   * If a message schema was provided, ctx.data is the validated & typed payload.
   */
  message?: (ctx: WsCtx<TMsg>, raw: string | Uint8Array) => void | Promise<void>
  /**
   * Called when a client disconnects.
   * code: WebSocket close code; reason: human-readable string.
   */
  close?:   (ctx: WsCtx<undefined>, code: number, reason: string) => void | Promise<void>
  /** Called when the send buffer is drained and more data can be written. */
  drain?:   (ctx: WsCtx<undefined>) => void | Promise<void>
}

// ── WsRoute ────────────────────────────────────────────────────────────────────

/** Stored internally — one entry per registered WS path. */
export interface WsRoute {
  /** Registered path pattern, e.g. '/chat' or '/rooms/:id' */
  path:           string
  /** Optional Zod schema to parse incoming messages */
  messageSchema?: ZodTypeAny
  handlers:       WsHandlers<any>
  /** Reference to the originating module (null for app-level) */
  _module:        unknown | null
  /** Index signature — satisfies WsRouteShape from core */
  [key: string]: unknown
}

// ── WsRouteHandler ────────────────────────────────────────────────────────────

/**
 * WsRouteHandler — passed to app.ws() / module.ws().
 *
 * Usage (no schema):
 *   app.ws('/chat', { open(ctx) { ... }, message(ctx, raw) { ... } })
 *
 * Usage (with Zod schema — message is typed):
 *   app.ws('/chat', {
 *     message: z.object({ text: z.string() }),
 *     handlers: {
 *       message(ctx, raw) { ctx.data.text  // ← typed }
 *     }
 *   })
 */
export type WsRouteHandler<TMsg = unknown> =
  | WsHandlers<TMsg>
  | WsRouteHandlerWithSchema<TMsg>

export interface WsRouteHandlerWithSchema<TMsg = unknown> {
  /** Zod schema for incoming messages. Parsed before onMessage is called. */
  message:   ZodTypeAny
  /** Lifecycle callbacks — message(ctx) receives the validated & typed payload */
  handlers:  WsHandlers<TMsg>
}

// ── normalizeWsHandler ────────────────────────────────────────────────────────

export function normalizeWsHandler<TMsg>(
  handler: WsRouteHandler<TMsg>,
): { messageSchema?: ZodTypeAny; handlers: WsHandlers<TMsg> } {
  if ('handlers' in handler) {
    return {
      messageSchema: (handler as WsRouteHandlerWithSchema<TMsg>).message,
      handlers: (handler as WsRouteHandlerWithSchema<TMsg>).handlers,
    }
  }
  return { handlers: handler as WsHandlers<TMsg> }
}
