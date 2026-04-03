import type { BaseCtx, OnRequestHook, OnResponseHook } from './types'
import { createOnRequest, createOnResponse } from './types'

// ── Constants ──────────────────────────────────────────────────────────────────

// Methods that mutate state — CSRF validation is enforced for these.
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// ── Constant-time string comparison ───────────────────────────────────────────

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns false immediately on length mismatch (length is not secret).
 * XORs all character codes and accumulates into a single result so the
 * comparison time is proportional to the string length, not the first mismatch.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

// ── Token generation ───────────────────────────────────────────────────────────

function generateToken(): string {
  // crypto is available globally in Bun, Node 19+, and all modern browsers.
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// ── Options ────────────────────────────────────────────────────────────────────

export interface CsrfOptions {
  /** Cookie name that holds the CSRF token. Default: 'csrf_token' */
  cookieName?: string
  /** Request header that must carry the token on state-changing requests. Default: 'x-csrf-token' */
  headerName?: string
  /** Cookie Max-Age in seconds. Default: 86400 (24h) */
  maxAge?: number
  /** Restrict cookie to HTTPS. Default: true (set false for local development) */
  secure?: boolean
}

// ── Plugin return type ─────────────────────────────────────────────────────────

export interface CsrfPlugin {
  /**
   * Register on app.onRequest() or module.onRequest().
   * Validates the CSRF token on state-changing methods (POST/PUT/PATCH/DELETE).
   * Returns a 403 response on mismatch — short-circuits the request lifecycle.
   */
  onRequest: OnRequestHook
  /**
   * Register on app.onResponse() or module.onResponse().
   * Sets a new CSRF token cookie on responses to safe methods (GET/HEAD/OPTIONS)
   * when no valid token cookie exists yet.
   */
  onResponse: OnResponseHook
}

/**
 * csrfPlugin — Double-Submit Cookie pattern. Stateless, no store required.
 *
 * Usage:
 *   const csrf = csrfPlugin()
 *   app.onRequest(csrf.onRequest)
 *   app.onResponse(csrf.onResponse)
 *
 * How it works:
 *   1. On GET/HEAD/OPTIONS — onResponse sets a readable cookie (httpOnly: false)
 *      so the client-side JS can read the token.
 *   2. On POST/PUT/PATCH/DELETE — onRequest reads the cookie value and compares
 *      it to the x-csrf-token request header. Mismatch or missing → 403.
 *
 * The Double-Submit Cookie pattern is stateless: the server never stores tokens.
 * Security relies on the same-origin policy: a cross-origin attacker can read
 * neither the cookie nor the custom header value.
 */
export function csrfPlugin(options: CsrfOptions = {}): CsrfPlugin {
  const cookieName = options.cookieName ?? 'csrf_token'
  const headerName = options.headerName ?? 'x-csrf-token'
  const maxAge     = options.maxAge     ?? 86_400
  const secure     = options.secure     ?? true

  const onRequest: OnRequestHook = createOnRequest((ctx: BaseCtx) => {
    const method = ctx.req.method.toUpperCase()
    if (!STATE_CHANGING_METHODS.has(method)) return

    const cookieToken  = ctx.cookie.get(cookieName)
    const headerToken  = ctx.req.headers.get(headerName)

    if (!cookieToken || !headerToken || !timingSafeEqual(cookieToken, headerToken)) {
      return new Response(
        JSON.stringify({ error: 'Forbidden', code: 'CSRF_INVALID', message: 'CSRF token mismatch' }),
        {
          status:  403,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }
  })

  const onResponse: OnResponseHook = createOnResponse((ctx: BaseCtx, res: Response) => {
    const method = ctx.req.method.toUpperCase()
    // Only issue tokens on safe methods — no point issuing a fresh token
    // on a request that was just blocked by onRequest.
    if (STATE_CHANGING_METHODS.has(method)) return

    // Don't overwrite a valid existing token — avoids invalidating in-flight requests.
    const existing = ctx.cookie.get(cookieName)
    if (existing) return

    // Set a new token — httpOnly: false so client-side JS can read it.
    ctx.cookie.set(cookieName, generateToken(), {
      httpOnly: false,
      sameSite: 'Strict',
      maxAge,
      secure,
      path:     '/',
    })

    // ctx.cookie._pending() is flushed into the response by the framework
    // after onResponse hooks complete — no manual header manipulation needed.
    void res
  })

  return { onRequest, onResponse }
}
