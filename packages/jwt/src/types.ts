// ── JWT Payload ────────────────────────────────────────────────────────────────
// Re-exports AuthPayload from oakbun core under the JWT-specific name.

export interface JwtPayload {
  /** Subject — typically user ID */
  sub?: string
  /** Issued at (unix seconds) */
  iat?: number
  /** Expiration (unix seconds) */
  exp?: number
  /** Not Before (unix seconds) — token must not be accepted before this time */
  nbf?: number
  /** Audience */
  aud?: string | string[]
  /** Issuer */
  iss?: string
  /** JWT ID */
  jti?: string
  /** Additional custom claims */
  [key: string]: unknown
}

// ── Algorithm configs ─────────────────────────────────────────────────────────

/** HS256 — symmetric HMAC-SHA256. Pass a string secret (min 32 chars). */
export interface HS256Config {
  algorithm: 'HS256'
  secret: string
}

/** RS256 — asymmetric RSA-SHA256. Pass PEM strings for the key material. */
export interface RS256Config {
  algorithm: 'RS256'
  /**
   * PEM-encoded RSA public key for verification.
   * Required for jwtPlugin (verify). Also used by signJwt when privateKey is absent.
   */
  publicKey?: string
  /**
   * PEM-encoded RSA private key (PKCS#8) for signing.
   * Required for signJwt with RS256. Optional for jwtPlugin (verify only needs publicKey).
   */
  privateKey?: string
}

export type JwtConfig = HS256Config | RS256Config

// ── Plugin options ────────────────────────────────────────────────────────────

export interface JwtOptions {
  /**
   * Where to read the token from.
   * 'header' — Authorization: Bearer <token>  (default)
   * 'cookie' — reads from the named cookie (requires cookieName)
   * 'auto'   — header first, falls back to cookie
   */
  source?: 'header' | 'cookie' | 'auto'
  /** Cookie name when source is 'cookie' or 'auto'. Default: 'token' */
  cookieName?: string
  /**
   * If true, missing token is treated as anonymous — ctx.jwtUser is undefined.
   * Plugin does NOT throw on missing token. Useful for optional auth routes.
   * Default: false (missing token → 401)
   */
  optional?: boolean
  /**
   * Allow this many seconds of clock skew when validating exp and nbf claims.
   * Default: 0 (exact comparison)
   */
  clockSkewSeconds?: number
  /**
   * Expected issuer (iss claim). When set, tokens with a different or missing
   * iss claim are rejected with InvalidTokenError.
   * Default: undefined (no issuer check)
   */
  issuer?: string
  /**
   * Expected audience (aud claim). When set, tokens that do not include this
   * audience are rejected with InvalidTokenError.
   * Default: undefined (no audience check)
   */
  audience?: string
}
