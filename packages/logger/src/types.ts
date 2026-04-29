export interface OakBunLogger {
  info(msg: string, data?: Record<string, unknown>): void
  warn(msg: string, data?: Record<string, unknown>): void
  error(msg: string, data?: Record<string, unknown>): void
  debug(msg: string, data?: Record<string, unknown>): void
  child(scope: string): OakBunLogger
}

export interface LoggerOptions {
  scope?:     string
  level?:     'debug' | 'info' | 'warn' | 'error'  // default: 'info'
  colors?:    boolean           // default: TTY auto-detect
  timestamp?: boolean           // default: true
  format?:    'pretty' | 'json' // default: 'pretty' when TTY, 'json' otherwise
  mask?:      string[]          // default: DEFAULT_MASK_KEYS
}

export const DEFAULT_MASK_KEYS = [
  'password', 'token', 'secret', 'authorization',
  'cookie', 'apiKey', 'api_key', 'accessToken',
  'refreshToken', 'privateKey',
] as const
