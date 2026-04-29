// ── JWT Error Types ────────────────────────────────────────────────────────────
// JwtBaseError extends OakBunError so app.onError() catches JWT errors automatically
// without any special-casing — invalid/expired tokens return 401, not 500.

import { OakBunError } from 'oakbun'

export { OakBunError as JwtBaseError }

export class WeakSecretError extends OakBunError {
  constructor(message = 'HS256 secret must be at least 32 characters (256 bits)') {
    super(message, 500, 'JWT_WEAK_SECRET')
    this.name = 'WeakSecretError'
  }
}

export class TokenExpiredError extends OakBunError {
  constructor(message = 'Token expired') {
    super(message, 401, 'TOKEN_EXPIRED')
    this.name = 'TokenExpiredError'
  }
}

export class InvalidTokenError extends OakBunError {
  constructor(message = 'Invalid token') {
    super(message, 401, 'TOKEN_INVALID')
    this.name = 'InvalidTokenError'
  }
}
