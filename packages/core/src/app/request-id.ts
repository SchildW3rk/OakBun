import type { BaseCtx, OnRequestHook, OnResponseHook } from './types'
import { createOnRequest, createOnResponse } from './types'

// ── Options ─────────────────────────────────────────────────────────────────

export interface RequestIdOptions {
  /**
   * Name of the incoming request header to read an existing ID from.
   * If present and valid, the existing ID is reused (useful for distributed tracing).
   * Default: `'x-request-id'`
   */
  incomingHeader?: string

  /**
   * Name of the response header to echo the request ID back to the client.
   * Default: `'x-request-id'`
   */
  responseHeader?: string

  /**
   * Custom ID generator. Must return a non-empty string.
   * Default: 16 random hex bytes (128 bits, UUID-compatible entropy)
   */
  generator?: () => string
}

// ── Plugin return type ───────────────────────────────────────────────────────

/** Context extension added by requestIdPlugin. Available after onRequest. */
export interface RequestIdCtx {
  /** Unique ID for this request. Set before any route handler runs. */
  requestId: string
}

export interface RequestIdPlugin {
  /**
   * Register on `app.onRequest()`.
   * Assigns `ctx.requestId` — available in all subsequent lifecycle phases.
   */
  onRequest: OnRequestHook<BaseCtx & RequestIdCtx>
  /**
   * Register on `app.onResponse()`.
   * Echoes the request ID back in the response header.
   */
  onResponse: OnResponseHook<BaseCtx & RequestIdCtx>
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function defaultGenerator(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Returns true if the value is a non-empty string containing only safe characters. */
function isSafeId(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[\w\-]+$/.test(value)
}

// ── Plugin factory ───────────────────────────────────────────────────────────

/**
 * requestIdPlugin — assigns a unique ID to every request and echoes it back.
 *
 * Usage:
 *   const rid = requestIdPlugin()
 *   app.onRequest(rid.onRequest)
 *   app.onResponse(rid.onResponse)
 *
 * After registration, `ctx.requestId` is available in all handlers, guards,
 * and lifecycle hooks. The ID is echoed back in the `x-request-id` response header.
 *
 * Reuses an existing `x-request-id` header if it passes a safe-characters check,
 * enabling distributed tracing across services.
 */
export function requestIdPlugin(options: RequestIdOptions = {}): RequestIdPlugin {
  const incomingHeader = options.incomingHeader ?? 'x-request-id'
  const responseHeader = options.responseHeader ?? 'x-request-id'
  const generate       = options.generator      ?? defaultGenerator

  const onRequest: OnRequestHook<BaseCtx & RequestIdCtx> = createOnRequest<RequestIdCtx>((ctx) => {
    const incoming = ctx.req.headers.get(incomingHeader)
    const id = (incoming && isSafeId(incoming)) ? incoming : generate()
    ctx.requestId = id
  })

  const onResponse: OnResponseHook<BaseCtx & RequestIdCtx> = createOnResponse<RequestIdCtx>((ctx, res) => {
    const headers = new Headers(res.headers)
    headers.set(responseHeader, ctx.requestId)
    return new Response(res.body, { status: res.status, headers })
  })

  return { onRequest, onResponse }
}
