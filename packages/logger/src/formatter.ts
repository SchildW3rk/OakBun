import { colors } from './colors'

// Level display: 4 chars padded, colored
const LEVEL_LABELS: Record<string, string> = {
  info:  'INFO',
  warn:  'WARN',
  error: 'ERR ',
  debug: 'DBG ',
}

function levelColor(level: string): string {
  const key = level as keyof typeof colors
  return key in colors ? colors[key] : ''
}

function formatTime(): string {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function formatDataPretty(data: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object') {
      parts.push(`${key}=${JSON.stringify(value)}`)
    } else {
      parts.push(`${key}=${String(value)}`)
    }
  }
  return parts.join(' ')
}

export function formatPretty(
  level: string,
  scope: string | undefined,
  msg: string,
  data: Record<string, unknown> | undefined,
  timestamp: boolean,
): string {
  const parts: string[] = []

  if (timestamp) {
    parts.push(`${colors.dim_white}${formatTime()}${colors.reset}`)
  }

  const label = LEVEL_LABELS[level] ?? level.toUpperCase().padEnd(4)
  parts.push(`${levelColor(level)}${label}${colors.reset}`)

  if (scope) {
    parts.push(`${colors.scope}${colors.dim}${scope}${colors.reset} ${colors.dim}\u203a${colors.reset}`)
  }

  parts.push(msg)

  if (data && Object.keys(data).length > 0) {
    parts.push(`${colors.dim_white}${formatDataPretty(data)}${colors.reset}`)
  }

  return parts.join(' ')
}

export function formatJson(
  level: string,
  scope: string | undefined,
  msg: string,
  data: Record<string, unknown> | undefined,
): string {
  const entry: Record<string, unknown> = {
    ts:    new Date().toISOString(),
    level,
  }
  if (scope !== undefined) {
    entry['scope'] = scope
  }
  entry['msg'] = msg
  if (data) {
    for (const [key, value] of Object.entries(data)) {
      entry[key] = value
    }
  }
  return JSON.stringify(entry)
}
