import type { OnResponseHook } from './types'
import { createOnResponse } from './types'

/**
 * CSP preset values for `contentSecurityPolicy`.
 *
 * - `'strict'`  — no unsafe-inline; suitable for APIs and security-critical apps.
 * - `'relaxed'` — allows unsafe-inline scripts/styles; suitable for dashboards and SSR (default).
 * - `false`     — omits the Content-Security-Policy header entirely.
 * - `string`    — passed through as the raw header value.
 */
export type CspPreset = 'strict' | 'relaxed' | false | string

export interface SecureHeadersOptions {
  /** Strict-Transport-Security — default: 'max-age=15552000; includeSubDomains' */
  strictTransportSecurity?: string | false
  /** X-Content-Type-Options — default: 'nosniff' */
  xContentTypeOptions?:     string | false
  /** X-Frame-Options — default: 'SAMEORIGIN' */
  xFrameOptions?:           string | false
  /** X-XSS-Protection — default: '0' (modern recommendation: rely on CSP instead) */
  xXssProtection?:          string | false
  /** Referrer-Policy — default: 'strict-origin-when-cross-origin' */
  referrerPolicy?:          string | false
  /** Permissions-Policy — default: 'camera=(), microphone=(), geolocation=()' */
  permissionsPolicy?:       string | false
  /**
   * Content-Security-Policy — accepts a preset or a raw header string.
   *
   * - `'relaxed'` (default) — allows unsafe-inline scripts/styles.
   * - `'strict'`            — no unsafe-inline; for APIs and security-critical apps.
   * - `false`               — omit header entirely.
   * - custom string         — used as-is.
   */
  contentSecurityPolicy?:   CspPreset
}

const CSP_STRICT  = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'"
const CSP_RELAXED = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data: https:; connect-src 'self'"

function resolveCsp(value: CspPreset | undefined): string | false {
  if (value === false)     return false
  if (value === 'strict')  return CSP_STRICT
  if (value === 'relaxed' || value === undefined) return CSP_RELAXED
  return value  // custom string
}

const DEFAULTS: Record<Exclude<keyof SecureHeadersOptions, 'contentSecurityPolicy'>, string> = {
  strictTransportSecurity: 'max-age=15552000; includeSubDomains',
  xContentTypeOptions:     'nosniff',
  xFrameOptions:           'SAMEORIGIN',
  xXssProtection:          '0',
  referrerPolicy:          'strict-origin-when-cross-origin',
  permissionsPolicy:       'camera=(), microphone=(), geolocation=()',
}

const HEADER_NAMES: Record<Exclude<keyof SecureHeadersOptions, 'contentSecurityPolicy'>, string> = {
  strictTransportSecurity: 'Strict-Transport-Security',
  xContentTypeOptions:     'X-Content-Type-Options',
  xFrameOptions:           'X-Frame-Options',
  xXssProtection:          'X-XSS-Protection',
  referrerPolicy:          'Referrer-Policy',
  permissionsPolicy:       'Permissions-Policy',
}

/**
 * secureHeadersPlugin — adds security response headers to every response.
 *
 * Returns an OnResponseHook — pass it to app.onResponse():
 *   app.onResponse(secureHeadersPlugin())
 *   app.onResponse(secureHeadersPlugin({ xFrameOptions: 'DENY', contentSecurityPolicy: 'strict' }))
 *
 * Each option defaults to a secure value. Pass `false` to omit that header entirely.
 * Pass a custom string to override the default value.
 * `contentSecurityPolicy` also accepts `'strict'` (no unsafe-inline) or `'relaxed'` (default).
 *
 * Header resolution runs once at call time — zero overhead per request.
 */
export function secureHeadersPlugin(options: SecureHeadersOptions = {}): OnResponseHook {
  // Resolve final header list at plugin-creation time — not per request
  const resolved: Array<[string, string]> = []

  // Non-CSP headers
  for (const key of Object.keys(DEFAULTS) as Array<Exclude<keyof SecureHeadersOptions, 'contentSecurityPolicy'>>) {
    const val = key in options ? options[key] : DEFAULTS[key]
    if (val !== false && val !== undefined) {
      resolved.push([HEADER_NAMES[key], val as string])
    }
  }

  // CSP — preset-aware resolution
  const cspVal = resolveCsp(options.contentSecurityPolicy)
  if (cspVal !== false) {
    resolved.push(['Content-Security-Policy', cspVal])
  }

  return createOnResponse((_ctx, res) => {
    const headers = new Headers(res.headers)
    for (const [name, value] of resolved) {
      // Don't overwrite headers already set by the route handler —
      // allows per-route CSP overrides (e.g. scalarPlugin loosens CSP for /docs)
      if (!headers.has(name)) {
        headers.set(name, value)
      }
    }
    return new Response(res.body, {
      status:     res.status,
      statusText: res.statusText,
      headers,
    })
  })
}
