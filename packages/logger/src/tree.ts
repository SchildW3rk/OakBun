import { colors, colorMethod } from './colors'

export interface RouteInfo {
  method:    string   // 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'WS'
  path:      string
  module?:   string   // Module name for grouping
  protected: boolean  // true when guard is active
}

const LINE = '━'.repeat(40)

function lock(isProtected: boolean): string {
  return isProtected ? '  🔒' : ''
}

// Fix 1 — strip trailing slash (except root "/")
function normalizePath(path: string): string {
  return path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path
}

export function printRouteTree(
  routes: RouteInfo[],
  options: {
    title?:   string
    version?: string
    port?:    number
  } = {},
): string {
  const title   = options.title   ?? 'Veln'
  const version = options.version
  const port    = options.port

  const lines: string[] = []

  // Header
  lines.push(LINE)
  const headerParts: string[] = [`  ${colors.bold}${title}${colors.reset}`]
  if (version) headerParts.push(`${colors.dim}${version}${colors.reset}`)
  if (port !== undefined) headerParts.push(`${colors.dim}→${colors.reset}  ${colors.dim_white}:${port}${colors.reset}`)
  lines.push(headerParts.join('  '))
  lines.push(LINE)

  // Separate WS routes from HTTP routes
  const wsRoutes   = routes.filter(r => r.method.toUpperCase() === 'WS')
  const httpRoutes = routes.filter(r => r.method.toUpperCase() !== 'WS')

  // HTTP section
  if (httpRoutes.length > 0) {
    lines.push(`  ${colors.bold}HTTP${colors.reset}`)

    // Split into ungrouped (no module) and grouped (by module)
    const ungrouped = httpRoutes.filter(r => !r.module)
    const grouped   = new Map<string, RouteInfo[]>()
    for (const route of httpRoutes) {
      if (route.module) {
        const existing = grouped.get(route.module)
        if (existing) {
          existing.push(route)
        } else {
          grouped.set(route.module, [route])
        }
      }
    }

    const moduleNames   = [...grouped.keys()]
    const totalTopLevel = ungrouped.length + moduleNames.length
    let topIdx = 0

    // Ungrouped routes first
    for (const route of ungrouped) {
      topIdx++
      const isLast = topIdx === totalTopLevel
      const prefix = isLast ? '  └──' : '  ├──'
      lines.push(`${prefix} ${colorMethod(route.method)} ${normalizePath(route.path)}${lock(route.protected)}`)
    }

    // Grouped modules
    for (const [modName, modRoutes] of grouped) {
      topIdx++
      const isLastMod = topIdx === totalTopLevel

      // Fix 2 — separator line at the same indent level as ├──
      lines.push('  │')

      const modPrefix = isLastMod ? '  └──' : '  ├──'
      lines.push(`${modPrefix} ${colors.bold}${modName}${colors.reset}`)

      const indent = isLastMod ? '      ' : '  │   '
      for (let i = 0; i < modRoutes.length; i++) {
        const route = modRoutes[i]!
        const isLast = i === modRoutes.length - 1
        const rowPrefix = isLast ? '└──' : '├──'
        lines.push(`  ${indent}${rowPrefix} ${colorMethod(route.method)} ${normalizePath(route.path)}${lock(route.protected)}`)
      }
    }
  }

  // WebSocket section
  if (wsRoutes.length > 0) {
    if (httpRoutes.length > 0) lines.push('')
    lines.push(`  ${colors.bold}WebSockets${colors.reset}`)
    for (let i = 0; i < wsRoutes.length; i++) {
      const route = wsRoutes[i]!
      const isLast = i === wsRoutes.length - 1
      const prefix = isLast ? '  └──' : '  ├──'
      lines.push(`  ${prefix} ${colorMethod(route.method)} ${normalizePath(route.path)}${lock(route.protected)}`)
    }
  }

  lines.push(LINE)

  return lines.join('\n')
}
