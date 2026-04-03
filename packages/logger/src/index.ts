import { maskData }                    from './masker'
import { formatPretty, formatJson }   from './formatter'
import { isTTY }                      from './colors'
import { DEFAULT_MASK_KEYS }          from './types'
import type { VelnLogger, LoggerOptions } from './types'

export { DEFAULT_MASK_KEYS }         from './types'
export type { VelnLogger, LoggerOptions } from './types'
export { isTTY, colors, colorMethod } from './colors'
export { maskData }                   from './masker'
export { formatPretty, formatJson }   from './formatter'
export { printRouteTree }             from './tree'
export type { RouteInfo }             from './tree'
export { loggerPlugin }               from './plugin'

export function createLogger(options: LoggerOptions = {}): VelnLogger {
  const {
    scope,
    level = 'info',
    timestamp = true,
    format = isTTY ? 'pretty' : 'json',
    mask = [...DEFAULT_MASK_KEYS],
  } = options

  const levels: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 }
  const minLevel = levels[level] ?? 1

  function log(
    lvl: 'debug' | 'info' | 'warn' | 'error',
    msg: string,
    data?: Record<string, unknown>,
  ): void {
    if ((levels[lvl] ?? 0) < minLevel) return

    const masked = data ? maskData(data, mask) : undefined
    const line = format === 'json'
      ? formatJson(lvl, scope, msg, masked)
      : formatPretty(lvl, scope, msg, masked, timestamp)

    if (lvl === 'error') console.error(line)
    else if (lvl === 'warn') console.warn(line)
    else console.log(line)
  }

  return {
    info:  (msg, data) => log('info',  msg, data),
    warn:  (msg, data) => log('warn',  msg, data),
    error: (msg, data) => log('error', msg, data),
    debug: (msg, data) => log('debug', msg, data),
    child: (childScope) => createLogger({
      ...options,
      scope: scope ? `${scope}.${childScope}` : childScope,
    }),
  }
}
