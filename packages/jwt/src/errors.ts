// ── JWT Error Types ────────────────────────────────────────────────────────────
// JwtBaseError extends VelnError so app.onError() catches JWT errors automatically
// without any special-casing — invalid/expired tokens return 401, not 500.

import { VelnError } from 'oakbun'

export { VelnError as JwtBaseError }

export class WeakSecretError extends VelnError {
  constructor(message = 'HS256 secret must be at least 32 characters (256 bits)') {
    super(message, 500, 'JWT_WEAK_SECRET')
    this.name = 'WeakSecretError'
  }
}

export class TokenExpiredError extends VelnError {
  constructor(message = 'Token expired') {
    super(message, 401, 'TOKEN_EXPIRED')
    this.name = 'TokenExpiredError'
  }
}

export class InvalidTokenError extends VelnError {
  constructor(message = 'Invalid token') {
    super(message, 401, 'TOKEN_INVALID')
    this.name = 'InvalidTokenError'
  }
}
