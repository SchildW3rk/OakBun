export interface CookieOptions {
  httpOnly?: boolean
  secure?:   boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  maxAge?:   number
  path?:     string
  domain?:   string
}

export interface CookieJar {
  get(name: string): string | undefined
  set(name: string, value: string, options?: CookieOptions): void
  delete(name: string): void
  /** Framework-internal: returns all pending Set-Cookie header values */
  _pending(): string[]
}

export function createCookieJar(req: Request): CookieJar {
  const pending: string[] = []

  function parseCookies(): Record<string, string> {
    const header = req.headers.get('Cookie') ?? ''
    const result: Record<string, string> = {}
    for (const part of header.split(';')) {
      const trimmed = part.trim()
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const name  = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (name) result[name] = value
    }
    return result
  }

  // Parse once, cache
  let parsed: Record<string, string> | undefined

  return {
    get(name: string): string | undefined {
      if (!parsed) parsed = parseCookies()
      return parsed[name]
    },

    set(name: string, value: string, options: CookieOptions = {}): void {
      const parts: string[] = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`]
      parts.push(`Path=${options.path ?? '/'}`)
      if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`)
      if (options.domain) parts.push(`Domain=${options.domain}`)
      const sameSiteValue = options.sameSite ?? 'Lax'
      parts.push(`SameSite=${sameSiteValue}`)
      if (options.secure ?? true) parts.push('Secure')
      if (options.httpOnly ?? true) parts.push('HttpOnly')
      pending.push(parts.join('; '))
    },

    delete(name: string): void {
      const parts = [
        `${encodeURIComponent(name)}=`,
        'Path=/',
        'Max-Age=0',
        'Secure',
        'HttpOnly',
      ]
      pending.push(parts.join('; '))
    },

    _pending(): string[] {
      return [...pending]
    },
  }
}
