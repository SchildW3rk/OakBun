// ── @veln/jwt ─────────────────────────────────────────────────────────────────
// JWT plugin and utilities for the Veln framework.
// Uses jose as the underlying JWT engine.

export { jwtPlugin }                                        from './plugin'
export { signJwt }                                          from './utils'
export { WeakSecretError, TokenExpiredError, InvalidTokenError, JwtBaseError } from './errors'
export type { JwtPayload, JwtConfig, HS256Config, RS256Config, JwtOptions }   from './types'
