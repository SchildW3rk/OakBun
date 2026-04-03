import { describe, test, expect } from 'bun:test'
import { printRouteTree } from '../src/tree'
import type { RouteInfo } from '../src/tree'

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

describe('printRouteTree', () => {
  const routes: RouteInfo[] = [
    { method: 'GET',  path: '/health',  protected: false },
    { method: 'GET',  path: '/users',   module: 'users', protected: false },
    { method: 'POST', path: '/users',   module: 'users', protected: true  },
  ]

  test('contains ungrouped route', () => {
    const tree = stripAnsi(printRouteTree(routes, { title: 'Veln', port: 4560 }))
    expect(tree).toContain('GET    /health')
  })

  test('contains module name', () => {
    const tree = stripAnsi(printRouteTree(routes, { title: 'Veln', port: 4560 }))
    expect(tree).toContain('users')
  })

  test('contains grouped route method and path', () => {
    const tree = stripAnsi(printRouteTree(routes, { title: 'Veln', port: 4560 }))
    expect(tree).toContain('POST   /users')
  })

  test('contains lock emoji for protected route', () => {
    const tree = stripAnsi(printRouteTree(routes, { title: 'Veln', port: 4560 }))
    expect(tree).toContain('🔒')
  })

  test('contains port', () => {
    const tree = stripAnsi(printRouteTree(routes, { title: 'Veln', port: 4560 }))
    expect(tree).toContain(':4560')
  })

  test('no lock for unprotected route', () => {
    const tree = stripAnsi(printRouteTree(routes, {}))
    // GET /health is not protected — it should not have 🔒 on its line
    const lines = tree.split('\n')
    const healthLine = lines.find(l => l.includes('/health'))
    expect(healthLine).toBeDefined()
    expect(healthLine).not.toContain('🔒')
  })

  test('WS routes go in WebSockets section', () => {
    const wsRoutes: RouteInfo[] = [
      { method: 'WS', path: '/ws/echo', protected: false },
    ]
    const tree = stripAnsi(printRouteTree(wsRoutes, {}))
    expect(tree).toContain('WebSockets')
    expect(tree).toContain('WS     /ws/echo')
  })

  test('title and version appear in header', () => {
    const tree = stripAnsi(printRouteTree([], { title: 'MyApp', version: 'v2.0' }))
    expect(tree).toContain('MyApp')
    expect(tree).toContain('v2.0')
  })

  test('no version in header when omitted', () => {
    const tree = stripAnsi(printRouteTree([], { title: 'Test' }))
    expect(tree).toContain('Test')
    expect(tree).not.toContain('undefined')
  })

  test('handles empty routes list', () => {
    const tree = stripAnsi(printRouteTree([], { title: 'Empty' }))
    expect(tree).toContain('Empty')
    // Should still have header lines
    expect(tree.split('\n').length).toBeGreaterThan(2)
  })

  // Fix 1 — trailing slash normalization
  test('strips trailing slash from paths', () => {
    const r: RouteInfo[] = [{ method: 'GET', path: '/users/', protected: false }]
    const tree = stripAnsi(printRouteTree(r, {}))
    expect(tree).toContain('/users')
    expect(tree).not.toContain('/users/')
  })

  test('root "/" is not stripped', () => {
    const r: RouteInfo[] = [{ method: 'GET', path: '/', protected: false }]
    const tree = stripAnsi(printRouteTree(r, {}))
    expect(tree).toContain('GET    /')
  })

  // Fix 2 — separator line at correct indent
  test('separator line │ appears between ungrouped routes and modules', () => {
    const tree = stripAnsi(printRouteTree(routes, {}))
    const lines = tree.split('\n')
    const healthIdx = lines.findIndex(l => l.includes('/health'))
    const usersModIdx = lines.findIndex(l => l.includes('users') && !l.includes('/users'))
    // There should be a │ line between the ungrouped route and the module header
    const between = lines.slice(healthIdx + 1, usersModIdx)
    expect(between.some(l => l.includes('│'))).toBe(true)
  })

  test('ungrouped route line starts with ├── at correct indent', () => {
    const tree = stripAnsi(printRouteTree(routes, {}))
    const lines = tree.split('\n')
    const healthLine = lines.find(l => l.includes('GET    /health'))!
    // Should start with "  ├──" (2 spaces, then tree connector)
    expect(healthLine.trimEnd()).toMatch(/^  [├└]──/)
  })
})
