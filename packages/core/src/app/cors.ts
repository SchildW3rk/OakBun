import type { OnRequestHook, OnResponseHook } from './types'
import { createOnRequest, createOnResponse } from './types'

// ── Options ─────────────────────────────────────────────────────────────────

export interface CorsOptions {
  /**
   * Allowed origins. Can be:
   * - `'*'`                  → any origin (not usable with credentials)
   * - `string`               → single allowed origin
   * - `string[]`             → list of allowed origins (matched against request Origin header)
   * - `(origin: string) => boolean` → custom predicate
   *
   * Default: `'*'`
   */
  origin?: '*' | string | string[] | ((origin: string) => boolean)

  /**
   * HTTP methods allowed in CORS requests.
   * Default: `['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']`
   */
  methods?: string[]

  /**
   * Request headers the client is allowed to send.
   * Default: `['Content-Type', 'Authorization', 'x-csrf-token']`
   */
  allowHeaders?: string[]

  /**
   * Response headers that the browser may expose to the client-side script.
   * Default: `[]` (none exposed beyond the CORS-safelisted headers)
   */
  exposeHeaders?: string[]

  /**
   * Whether cross-origin requests may include credentials (cookies, auth headers).
   * When true, `origin` must not be `'*'`.
   * Default: `false`
   */
  credentials?: boolean

  /**
   * How long (in seconds) the preflight result may be cached.
   * Default: `86400` (24h)
   */
  maxAge?: number
}

// ── Plugin return type ───────────────────────────────────────────────────────

export interface CorsPlugin {
  /**
   * Register on `app.onRequest()`.
   * Handles OPTIONS preflight requests — returns a 204 with CORS headers directly,
   * short-circuiting the pipeline (no route handler runs for OPTIONS).
   */
  onRequest: OnRequestHook
  /**
   * Register on `app.onResponse()`.
   * Appends CORS headers to every response.
   */
  onResponse: OnResponseHook
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveOrigin(
  allowedOrigin: CorsOptions['origin'],
  requestOrigin: string | null,
): string | null {
  if (!requestOrigin) return null

  if (allowedOrigin === '*') return '*'
  if (typeof allowedOrigin === 'string') {
    return allowedOrigin === requestOrigin ? requestOrigin : null
  }
  if (Array.isArray(allowedOrigin)) {
    return allowedOrigin.includes(requestOrigin) ? requestOrigin : null
  }
  if (typeof allowedOrigin === 'function') {
    return allowedOrigin(requestOrigin) ? requestOrigin : null
  }
  return null
}

// ── Plugin factory ───────────────────────────────────────────────────────────

/**
 * corsPlugin — adds CORS headers to responses and handles preflight OPTIONS requests.
 *
 * Usage:
 *   const cors = corsPlugin({ origin: 'https://app.example.com', credentials: true })
 *   app.onRequest(cors.onRequest)
 *   app.onResponse(cors.onResponse)
 *
 * Preflight (OPTIONS) requests are short-circuited with a 204 — no route handler
 * runs. All other requests receive CORS headers in onResponse.
 */
export function corsPlugin(options: CorsOptions = {}): CorsPlugin {
  const allowedOrigin  = options.origin        ?? '*'

  // Validate: wildcard origin cannot be combined with credentials
  if ((allowedOrigin === '*') && options.credentials === true) {
    throw new Error(
      "CORS: origin: '*' cannot be combined with credentials: true. Use a specific origin instead.",
    )
  }
  const methods        = options.methods        ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  const allowHeaders   = options.allowHeaders   ?? ['Content-Type', 'Authorization', 'x-csrf-token']
  const exposeHeaders  = options.exposeHeaders  ?? []
  const credentials    = options.credentials    ?? false
  const maxAge         = options.maxAge         ?? 86_400

  const methodsStr      = methods.join(', ')
  const allowHeadersStr = allowHeaders.join(', ')
  const exposeHeadersStr = exposeHeaders.join(', ')
  const maxAgeStr        = String(maxAge)

  function buildCorsHeaders(requestOrigin: string | null): Headers {
    const headers = new Headers()
    const resolved = resolveOrigin(allowedOrigin, requestOrigin)
    if (resolved) {
      headers.set('Access-Control-Allow-Origin', resolved)
      // Vary: Origin when not wildcard — required for correct cache behaviour
      if (resolved !== '*') {
        headers.set('Vary', 'Origin')
      }
    }
    if (credentials) {
      headers.set('Access-Control-Allow-Credentials', 'true')
    }
    if (exposeHeadersStr) {
      headers.set('Access-Control-Expose-Headers', exposeHeadersStr)
    }
    return headers
  }

  const onRequest: OnRequestHook = createOnRequest((ctx) => {
    if (ctx.req.method.toUpperCase() !== 'OPTIONS') return

    const requestOrigin = ctx.req.headers.get('Origin')
    const corsHeaders   = buildCorsHeaders(requestOrigin)

    // Add preflight-specific headers
    corsHeaders.set('Access-Control-Allow-Methods', methodsStr)
    corsHeaders.set('Access-Control-Allow-Headers', allowHeadersStr)
    corsHeaders.set('Access-Control-Max-Age', maxAgeStr)

    return new Response(null, { status: 204, headers: corsHeaders })
  })

  const onResponse: OnResponseHook = createOnResponse((ctx, res) => {
    const requestOrigin = ctx.req.headers.get('Origin')
    const corsHeaders   = buildCorsHeaders(requestOrigin)

    // Don't mutate the original response — rebuild with merged headers
    const merged = new Headers(res.headers)
    for (const [key, value] of corsHeaders) {
      merged.set(key, value)
    }

    return new Response(res.body, {
      status:  res.status,
      headers: merged,
    })
  })

  return { onRequest, onResponse }
}
