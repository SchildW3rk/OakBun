import type { BaseCtx } from 'oakbun'
import type { Plugin } from 'oakbun'
import type { CryptoKey, KeyObject } from 'jose'
import { importSPKI } from 'jose'

type JoseKey = CryptoKey | KeyObject
import { encodeHmacSecret, verifyToken } from './utils'
import { WeakSecretError, InvalidTokenError } from './errors'
import type { JwtPayload, JwtConfig, JwtOptions } from './types'

// ── jwtPlugin ─────────────────────────────────────────────────────────────────

/**
 * jwtPlugin — verifies JWT tokens and exposes the payload as ctx.jwtUser.
 *
 * HS256 (backward-compatible shorthand):
 *   app.plugin(jwtPlugin('your-secret'))
 *
 * RS256 (asymmetric — recommended for multi-service architectures):
 *   app.plugin(jwtPlugin({ algorithm: 'RS256', publicKey: rsaPublicKeyPem }))
 *
 * Optional auth (ctx.jwtUser may be undefined):
 *   app.plugin(jwtPlugin('your-secret', { optional: true }))
 *
 * Token sources (default: Authorization header):
 *   Authorization: Bearer <token>    source: 'header' (default)
 *   Cookie: token=<token>            source: 'cookie', cookieName: 'token'
 *   Both, header first               source: 'auto'
 *
 * Errors (both extend JwtBaseError, status 401):
 *   TokenExpiredError  — code: 'TOKEN_EXPIRED'
 *   InvalidTokenError  — code: 'TOKEN_INVALID'
 */
export function jwtPlugin(
  config: string | JwtConfig,
  options: JwtOptions = {},
): Plugin<BaseCtx, { jwtUser: JwtPayload | undefined }> {
  const resolved: JwtConfig = typeof config === 'string'
    ? { algorithm: 'HS256', secret: config }
    : config

  if (resolved.algorithm === 'HS256' && resolved.secret.length < 32) {
    throw new WeakSecretError()
  }

  const source           = options.source           ?? 'header'
  const cookieName       = options.cookieName       ?? 'token'
  const optional         = options.optional         ?? false
  const clockSkewSeconds = options.clockSkewSeconds ?? 0
  const issuer           = options.issuer
  const audience         = options.audience

  // Cached verify key — imported once on first request, reused on subsequent requests.
  // HS256: Uint8Array (TextEncoder output — no async needed)
  // RS256: KeyLike (CryptoKey from importSPKI)
  let cachedVerifyKey: JoseKey | Uint8Array | undefined

  return {
    name: 'jwt',

    request: async (ctx) => {
      // Lazy-initialize the cached verify key on first request
      if (cachedVerifyKey === undefined) {
        if (resolved.algorithm === 'HS256') {
          cachedVerifyKey = encodeHmacSecret(resolved.secret)
        } else if (resolved.publicKey !== undefined) {
          cachedVerifyKey = await importSPKI(resolved.publicKey, 'RS256')
        }
      }

      // Extract raw token string
      let token: string | undefined

      if (source === 'header' || source === 'auto') {
        const auth = ctx.req.headers.get('authorization')
        if (auth?.startsWith('Bearer ')) token = auth.slice(7)
      }

      if (!token && (source === 'cookie' || source === 'auto')) {
        token = ctx.cookie.get(cookieName)
      }

      // No token
      if (!token) {
        if (optional) return { ...ctx, jwtUser: undefined }
        throw new InvalidTokenError('Missing token')
      }

      // Verify — throws TokenExpiredError or InvalidTokenError on failure
      const payload = await verifyToken(token, resolved, cachedVerifyKey, clockSkewSeconds, issuer, audience)
      return { ...ctx, jwtUser: payload }
    },
  }
}
