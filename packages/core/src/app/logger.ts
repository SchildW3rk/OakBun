import type { Logger, LogOptions } from './types'

// ── LogLevel ──────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
}

// ── ANSI ──────────────────────────────────────────────────────────────────────

const RESET = '\x1b[0m'
const DIM   = '\x1b[2m'

const SCOPE_COLORS: Record<string, string> = {
  service:    '\x1b[34m',        // Blue
  model:      '\x1b[36m',        // Cyan
  plugin:     '\x1b[35m',        // Magenta
  cron:       '\x1b[33m',        // Yellow
  guard:      '\x1b[31m',        // Red
  middleware: '\x1b[32m',        // Green
  event:      '\x1b[38;5;208m',  // Orange
  module:     '\x1b[34m',        // Blue
  resource:   '\x1b[36m',        // Cyan
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[2m',   // Dim
  info:  '',          // No extra color — scope is enough
  warn:  '\x1b[33m',  // Yellow
  error: '\x1b[31m',  // Red
}

// TTY detection — no ANSI in pipes/files
const isTTY: boolean = process.stdout.isTTY ?? false

function colorScope(scope: string): string {
  if (!isTTY) return `[${scope}]`
  const prefix = scope.split(':')[0]
  const color  = SCOPE_COLORS[prefix] ?? ''
  return `${color}[${scope}]${RESET}`
}

function formatData(
  data:     Record<string, unknown>,
  maskKeys: Set<string>,
): string {
  const entries = Object.entries(data)
  if (entries.length === 0) return ''

  const masked: Array<[string, unknown]> = entries.map(([k, v]) => [
    k,
    maskKeys.has(k.toLowerCase()) ? '***' : v,
  ])

  if (masked.length <= 3) {
    const inline = masked
      .map(([k, v]) => (isTTY ? `${DIM}${k}${RESET}=${JSON.stringify(v)}` : `${k}=${JSON.stringify(v)}`))
      .join(' ')
    return `  ${inline}`
  }

  const lines = masked
    .map(([k, v]) => (isTTY ? `  ${DIM}${k}${RESET}=${JSON.stringify(v)}` : `  ${k}=${JSON.stringify(v)}`))
    .join('\n')
  return `\n${lines}`
}

// ── createMinimalLogger ───────────────────────────────────────────────────────
// Pure console-based logger — no @oakbun/logger dependency.
// Used by defineService (.options({ log })), defineModel (.options({ log })),
// and defineCron (.options({ log })) when no external logger plugin is registered.

export function createMinimalLogger(scope: string, opts?: LogOptions): Logger {
  if (opts?.silent) return noopLogger()

  const minLevel   = LEVEL_ORDER[opts?.level ?? 'info']
  const maskKeys   = new Set((opts?.mask ?? []).map((k) => k.toLowerCase()))
  const scopeLabel = colorScope(scope)

  function log(method: LogLevel, msg: string, args: unknown[]): void {
    if (LEVEL_ORDER[method] < minLevel) return

    // Extract first object arg as structured data
    const [first, ...rest] = args
    const isDataObj =
      first !== null &&
      first !== undefined &&
      typeof first === 'object' &&
      !Array.isArray(first)

    const dataStr = isDataObj
      ? formatData(first as Record<string, unknown>, maskKeys)
      : ''

    const levelColor = isTTY ? LEVEL_COLORS[method] : ''
    const msgPart    = levelColor ? `${levelColor}${msg}${RESET}` : msg
    const line       = `${scopeLabel}  ${msgPart}${dataStr}`

    // Remaining args (beyond the first data object) appended as-is
    const extra = isDataObj ? rest : args

    if (method === 'error') {
      console.error(line, ...extra)
    } else if (method === 'warn') {
      console.warn(line, ...extra)
    } else {
      console.log(line, ...extra)
    }
  }

  return {
    info(msg: string, ...args: unknown[])  { log('info',  msg, args) },
    warn(msg: string, ...args: unknown[])  { log('warn',  msg, args) },
    error(msg: string, ...args: unknown[]) { log('error', msg, args) },
    debug(msg: string, ...args: unknown[]) { log('debug', msg, args) },
  }
}

function noopLogger(): Logger {
  return {
    debug: () => {},
    info:  () => {},
    warn:  () => {},
    error: () => {},
  }
}
