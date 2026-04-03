export interface MatchResult {
  params: Record<string, string | undefined>
}

export function matchPath(pattern: string, pathname: string): MatchResult | null {
  // Normalize trailing slashes (but keep root '/')
  const normPattern  = pattern.length  > 1 ? pattern.replace(/\/$/, '')  : pattern
  const normPathname = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname

  // Wildcard: pattern ends with /*
  if (normPattern.endsWith('/*')) {
    const prefix = normPattern.slice(0, -2)  // remove /*
    if (normPathname.startsWith(prefix + '/')) {
      const rest = normPathname.slice(prefix.length + 1)  // skip leading /
      return { params: { '*': rest } }
    }
    return null
  }

  const patternSegments  = normPattern.split('/')
  const pathSegments     = normPathname.split('/')

  const params: Record<string, string | undefined> = {}

  let pi = 0  // path index
  for (let i = 0; i < patternSegments.length; i++) {
    const pSeg = patternSegments[i]!

    if (pSeg.startsWith(':') && pSeg.endsWith('?')) {
      // Optional param
      const paramName = pSeg.slice(1, -1)
      if (pi < pathSegments.length) {
        params[paramName] = pathSegments[pi]
        pi++
      } else {
        params[paramName] = undefined
      }
    } else if (pSeg.startsWith(':')) {
      // Required param
      if (pi >= pathSegments.length) return null
      params[pSeg.slice(1)] = pathSegments[pi]!
      pi++
    } else {
      // Literal
      if (pi >= pathSegments.length || pathSegments[pi] !== pSeg) return null
      pi++
    }
  }

  // All path segments must be consumed (unless optional params left pattern shorter)
  if (pi !== pathSegments.length) return null

  return { params }
}

export function parseQuery(search: string): Record<string, string | string[]> {
  // Strip leading '?' if present
  const raw = search.startsWith('?') ? search.slice(1) : search
  if (!raw) return {}

  const result: Record<string, string | string[]> = {}
  const params = new URLSearchParams(raw)

  for (const key of params.keys()) {
    const values = params.getAll(key)
    result[key] = values.length === 1 ? values[0]! : values
  }

  return result
}
