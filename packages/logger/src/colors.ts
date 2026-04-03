// TTY Detection — no color codes in pipes/files
export const isTTY: boolean = (process.stdout as { isTTY?: boolean }).isTTY ?? false

export const colors = {
  reset:     isTTY ? '\x1b[0m'    : '',
  bold:      isTTY ? '\x1b[1m'    : '',
  dim:       isTTY ? '\x1b[2m'    : '',
  // Levels:
  info:      isTTY ? '\x1b[36m'   : '',   // Cyan
  warn:      isTTY ? '\x1b[33m'   : '',   // Yellow
  error:     isTTY ? '\x1b[31m'   : '',   // Red
  debug:     isTTY ? '\x1b[35m'   : '',   // Magenta
  // UI:
  scope:     isTTY ? '\x1b[34m'   : '',   // Blue
  dim_white: isTTY ? '\x1b[2;37m' : '',
  // Route Tree:
  get:       isTTY ? '\x1b[32m'   : '',   // Green
  post:      isTTY ? '\x1b[34m'   : '',   // Blue
  patch:     isTTY ? '\x1b[33m'   : '',   // Yellow
  put:       isTTY ? '\x1b[33m'   : '',   // Yellow
  delete:    isTTY ? '\x1b[31m'   : '',   // Red
  ws:        isTTY ? '\x1b[35m'   : '',   // Magenta
}

export function colorMethod(method: string): string {
  const key = method.toLowerCase() as keyof typeof colors
  const c = key in colors ? colors[key] : ''
  return `${c}${method.padEnd(6)}${colors.reset}`
}
