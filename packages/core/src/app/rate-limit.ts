import type { BaseCtx, OnRequestHook } from './types'
import { createOnRequest } from './types'

// ── Store Interface ────────────────────────────────────────────────────────────

export interface RateLimitStore {
  /**
   * Increment the counter for `key` within the given window.
   * Returns the new count and the timestamp (ms) when the window resets.
   * If the key is new or expired, the window starts fresh from now.
   */
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>
  /** Reset the counter for `key` immediately. */
  reset(key: string): Promise<void>
}

// ── In-Memory Store ────────────────────────────────────────────────────────────

interface Entry {
  count:   number
  resetAt: number
}

export class InMemoryStore implements RateLimitStore {
  private readonly _map = new Map<string, Entry>()

  // Probabilistic sweep: 1-in-N chance on every increment() call.
  // Amortizes cleanup cost across all requests — no manual calls, no Interval,
  // no process-keep-alive issues. At 1000 req/s with N=100, ~10 sweeps/s.
  private readonly _sweepEvery: number

  // Hard cap on map size — prevents memory exhaustion under unique-IP DoS attacks.
  // When the cap is reached, the oldest 20% of entries are evicted before inserting
  // a new key. Only new-key inserts check the cap; increments on existing keys are free.
  private readonly _maxEntries: number

  constructor(sweepEvery = 100, maxEntries = 100_000) {
    this._sweepEvery = sweepEvery
    this._maxEntries = maxEntries
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now()

    // Probabilistic sweep — runs on ~1/sweepEvery calls
    if (Math.random() * this._sweepEvery < 1) {
      this._sweep(now)
    }

    const existing = this._map.get(key)

    if (existing && now < existing.resetAt) {
      existing.count += 1
      return { count: existing.count, resetAt: existing.resetAt }
    }

    // New window — enforce max-entries cap before inserting
    if (this._map.size >= this._maxEntries) {
      this._evictOldest(Math.max(1, Math.floor(this._maxEntries * 0.2)))
    }

    const entry: Entry = { count: 1, resetAt: now + windowMs }
    this._map.set(key, entry)
    return { count: 1, resetAt: entry.resetAt }
  }

  async reset(key: string): Promise<void> {
    this._map.delete(key)
  }

  /** Evict all expired entries. Called automatically on a probabilistic basis
   *  during increment(). Can also be called manually for eager cleanup. */
  cleanup(): void {
    this._sweep(Date.now())
  }

  private _sweep(now: number): void {
    for (const [key, entry] of this._map) {
      if (now >= entry.resetAt) this._map.delete(key)
    }
  }

  // Evict the `count` entries with the smallest resetAt (oldest windows).
  private _evictOldest(count: number): void {
    const sorted = [...this._map.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
    for (let i = 0; i < count && i < sorted.length; i++) {
      this._map.delete(sorted[i]![0])
    }
  }
}

// ── Options ────────────────────────────────────────────────────────────────────

export interface RateLimitOptions {
  /** Maximum number of requests allowed per window. */
  max: number
  /** Window duration in milliseconds. */
  windowMs: number
  /** Store implementation. Defaults to InMemoryStore. */
  store?: RateLimitStore
  /**
   * Extracts the rate-limit key from a request context.
   * When not specified, uses the default resolver which respects `trustProxy`.
   */
  keyResolver?: (ctx: BaseCtx) => string
  /** Response message when limit is exceeded. Defaults to 'Too many requests'. */
  message?: string
  /**
   * When true, the default keyResolver trusts the X-Forwarded-For header as the
   * real client IP. Only enable this if you are behind a trusted reverse proxy.
   * Default: false
   *
   * Without trustProxy, the default resolver uses x-real-ip or 'unknown'.
   *
   * trustProxy can also be an object for advanced configuration:
   *   { strict: true } — returns 400 when the expected proxy header is missing,
   *   instead of falling back to 'unknown'. Use this in security-critical deployments
   *   where a missing header indicates a misconfigured proxy or direct client access.
   */
  trustProxy?: boolean | { strict: boolean }
}

// ── Plugin ─────────────────────────────────────────────────────────────────────

/**
 * rateLimitPlugin — sliding-window rate limiter.
 *
 * Returns an OnRequestHook — pass it to app.onRequest() or module.onRequest():
 *   app.onRequest(rateLimitPlugin({ max: 100, windowMs: 60_000 }))
 *
 * When the limit is exceeded, returns a 429 response with:
 *   - Retry-After: seconds until the window resets
 *   - X-RateLimit-Limit: max
 *   - X-RateLimit-Remaining: 0
 *   - X-RateLimit-Reset: unix timestamp (seconds)
 *
 * Under the limit, the hook returns void — request continues normally.
 */
// ── Security analysis: X-Forwarded-For header handling ───────────────────────
//
// VULNERABILITY (if using first entry): A client can spoof X-Forwarded-For by
// sending "FAKE_IP, real_proxy_ip". If the rate limiter reads the FIRST entry,
// the attacker controls their own bucket key and bypasses rate limiting entirely.
//
// CORRECT behavior: read the LAST entry — set by the outermost trusted proxy,
// which the client cannot control. The client can prepend values to the list
// but cannot forge the final entry added by the proxy.
//
// Example: client sends  X-Forwarded-For: 10.0.0.1
//          proxy appends X-Forwarded-For: 10.0.0.1, 203.0.113.5
//          → correct client IP = last entry = 203.0.113.5
//
// MISSING HEADER behavior (trustProxy: true, no X-Forwarded-For):
//   - Default (option A): falls back to 'unknown' + emits a one-time warning.
//     All requests without the header share the same bucket — DoS vector if
//     the proxy is misconfigured. The warning helps operators detect this.
//   - Strict (option B): returns 400 Bad Request immediately. Use this in
//     security-critical deployments where a missing header means a broken proxy.

export function rateLimitPlugin(options: RateLimitOptions): OnRequestHook {
  const { max, windowMs, message = 'Too many requests' } = options
  const store: RateLimitStore = options.store ?? new InMemoryStore()

  const trustProxy = options.trustProxy
  const isStrict   = typeof trustProxy === 'object' && trustProxy.strict === true
  const doTrust    = trustProxy === true || isStrict

  // Pitfall warning: no keyResolver + no trustProxy → default falls back to
  // x-real-ip and then 'unknown'. Behind a proxy that doesn't set x-real-ip,
  // every request maps to the same key — the entire app shares one rate-limit
  // bucket. This is almost certainly unintentional.
  if (!options.keyResolver && !trustProxy) {
    console.warn(
      '[oakbun:rateLimit] Warning: no keyResolver or trustProxy provided. ' +
      "If your app runs behind a reverse proxy, the default key resolver may fall back to 'unknown', " +
      'causing all clients to share a single rate-limit bucket. ' +
      'Set trustProxy: true (if behind a trusted proxy) or provide a custom keyResolver.',
    )
  }

  // Track whether the missing-header warning has been emitted — once per plugin instance.
  let _missingHeaderWarned = false

  const defaultKeyResolver = (ctx: BaseCtx): string | Response => {
    if (doTrust) {
      const forwardedFor = ctx.req.headers.get('x-forwarded-for')
      if (forwardedFor) {
        // Use the LAST entry — set by the outermost trusted proxy, not forgeable by client.
        // Client can prepend fake IPs but cannot control the final proxy-appended entry.
        const parts = forwardedFor.split(',')
        const lastIp = parts[parts.length - 1]?.trim()
        if (lastIp) return lastIp
      }

      // Header missing — proxy may be misconfigured
      if (isStrict) {
        // Strict mode: reject the request — a missing header is a hard error
        return new Response(
          JSON.stringify({ error: 'Bad Request', code: 'MISSING_PROXY_HEADER', message: 'X-Forwarded-For header is required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }

      // Option A: warn once, fall back to 'unknown'
      if (!_missingHeaderWarned) {
        _missingHeaderWarned = true
        console.warn(
          '[oakbun:rateLimit] trustProxy is enabled but no X-Forwarded-For header found. ' +
          'All requests may be bucketed under the same IP. ' +
          'Ensure your reverse proxy sets X-Forwarded-For correctly.',
        )
      }
    }

    // Without trustProxy, use x-real-ip or fall back to 'unknown'
    return ctx.req.headers.get('x-real-ip') ?? 'unknown'
  }

  const keyResolver = options.keyResolver
    ? (ctx: BaseCtx): string | Response => options.keyResolver!(ctx)
    : defaultKeyResolver

  return createOnRequest(async (ctx) => {
    const keyOrResponse = keyResolver(ctx)

    // Strict mode returns a Response directly when the proxy header is missing
    if (keyOrResponse instanceof Response) return keyOrResponse

    const key = keyOrResponse
    const { count, resetAt } = await store.increment(key, windowMs)

    const remaining = Math.max(0, max - count)
    const resetSec  = Math.ceil(resetAt / 1000)

    if (count > max) {
      const retryAfter = Math.ceil((resetAt - Date.now()) / 1000)
      return new Response(
        JSON.stringify({ error: 'Too Many Requests', code: 'RATE_LIMIT_EXCEEDED', message }),
        {
          status: 429,
          headers: {
            'Content-Type':       'application/json',
            'Retry-After':        String(retryAfter),
            'X-RateLimit-Limit':  String(max),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset':  String(resetSec),
          },
        },
      )
    }

    // Under limit — attach informational headers via response hook is not possible
    // from onRequest. We return void and let the request continue.
    // RateLimit info headers (Limit/Remaining/Reset) are intentionally omitted on
    // the success path to avoid leaking rate-limit state to clients by default.
    // Advanced users can add them via a custom onResponse hook if needed.
    void remaining
    void resetSec
  })
}
