// ── JWT Error Types ────────────────────────────────────────────────────────────
// These extend a minimal base error so @veln/jwt can be used standalone
// (without requiring the full veln core).

export class JwtBaseError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = this.constructor.name
    this.status = status
    this.code = code
  }
}

export class WeakSecretError extends JwtBaseError {
  constructor(message = 'HS256 secret must be at least 32 characters (256 bits)') {
    super(message, 500, 'JWT_WEAK_SECRET')
    this.name = 'WeakSecretError'
  }
}

export class TokenExpiredError extends JwtBaseError {
  constructor(message = 'Token expired') {
    super(message, 401, 'TOKEN_EXPIRED')
    this.name = 'TokenExpiredError'
  }
}

export class InvalidTokenError extends JwtBaseError {
  constructor(message = 'Invalid token') {
    super(message, 401, 'TOKEN_INVALID')
    this.name = 'InvalidTokenError'
  }
}
