import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { scalarPlugin } from '../../packages/core/src/app/scalar'
import type { OpenApiSpec } from '../../packages/core/src/openapi/generator'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeApp() {
  const app = createApp()
  app.get('/health', (ctx) => ctx.json({ ok: true }))
  app.register(scalarPlugin(app))
  return app
}

// ── 1. Default routes ─────────────────────────────────────────────────────────

describe('scalarPlugin — default routes', () => {
  test('GET /scalar → 200 text/html', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/scalar'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
  })

  test('GET /scalar/openapi.json → 200 application/json', async () => {
    const app = makeApp()
    const res = await app.fetch(new Request('http://localhost/scalar/openapi.json'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
  })

  test('GET /scalar/openapi.json → valid OpenAPI 3.1.0 shape', async () => {
    const app = makeApp()
    const res  = await app.fetch(new Request('http://localhost/scalar/openapi.json'))
    const spec = await res.json() as OpenApiSpec
    expect(spec.openapi).toBe('3.1.0')
    expect(typeof spec.info.title).toBe('string')
    expect(typeof spec.paths).toBe('object')
  })

  test('/health route appears in openapi.json paths', async () => {
    const app = makeApp()
    const res  = await app.fetch(new Request('http://localhost/scalar/openapi.json'))
    const spec = await res.json() as OpenApiSpec
    expect('/health' in spec.paths).toBe(true)
  })

  test('scalar routes do not appear in openapi.json (hidden)', async () => {
    const app = makeApp()
    const res  = await app.fetch(new Request('http://localhost/scalar/openapi.json'))
    const spec = await res.json() as OpenApiSpec
    expect('/scalar' in spec.paths).toBe(false)
    expect('/scalar/openapi.json' in spec.paths).toBe(false)
  })
})

// ── 2. HTML content ────────────────────────────────────────────────────────────

describe('scalarPlugin — HTML content', () => {
  test('HTML contains Scalar CDN script tag', async () => {
    const app = makeApp()
    const res  = await app.fetch(new Request('http://localhost/scalar'))
    const html = await res.text()
    expect(html).toContain('cdn.jsdelivr.net/npm/@scalar/api-reference')
  })

  test('HTML contains embedded OpenAPI JSON as inline script', async () => {
    const app = makeApp()
    const res  = await app.fetch(new Request('http://localhost/scalar'))
    const html = await res.text()
    expect(html).toContain('id="api-reference"')
    expect(html).toContain('application/json')
    expect(html).toContain('3.1.0')
  })

  test('HTML contains default title', async () => {
    const app = makeApp()
    const res  = await app.fetch(new Request('http://localhost/scalar'))
    const html = await res.text()
    expect(html).toContain('Veln API')
  })

  test('HTML contains default theme', async () => {
    const app = makeApp()
    const res  = await app.fetch(new Request('http://localhost/scalar'))
    const html = await res.text()
    expect(html).toContain('purple')
  })
})

// ── 3. Custom path ─────────────────────────────────────────────────────────────

describe('scalarPlugin — custom path', () => {
  test('custom path → UI reachable at new path', async () => {
    const app = createApp()
    app.register(scalarPlugin(app, { path: '/docs' }))
    const res = await app.fetch(new Request('http://localhost/docs'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
  })

  test('custom path → openapi.json reachable at new path', async () => {
    const app = createApp()
    app.register(scalarPlugin(app, { path: '/docs' }))
    const res = await app.fetch(new Request('http://localhost/docs/openapi.json'))
    expect(res.status).toBe(200)
    const spec = await res.json() as OpenApiSpec
    expect(spec.openapi).toBe('3.1.0')
  })

  test('default /scalar → 404 when custom path used', async () => {
    const app = createApp()
    app.register(scalarPlugin(app, { path: '/docs' }))
    const res = await app.fetch(new Request('http://localhost/scalar'))
    expect(res.status).toBe(404)
  })
})

// ── 4. Custom title and theme ─────────────────────────────────────────────────

describe('scalarPlugin — custom options', () => {
  test('custom title appears in HTML', async () => {
    const app = createApp()
    app.register(scalarPlugin(app, { title: 'My Custom API' }))
    const res  = await app.fetch(new Request('http://localhost/scalar'))
    const html = await res.text()
    expect(html).toContain('My Custom API')
  })

  test('custom title appears in openapi.json info', async () => {
    const app = createApp()
    app.register(scalarPlugin(app, { title: 'My Custom API' }))
    const res  = await app.fetch(new Request('http://localhost/scalar/openapi.json'))
    const spec = await res.json() as OpenApiSpec
    expect(spec.info.title).toBe('My Custom API')
  })

  test('custom theme appears in HTML', async () => {
    const app = createApp()
    app.register(scalarPlugin(app, { theme: 'blue' }))
    const res  = await app.fetch(new Request('http://localhost/scalar'))
    const html = await res.text()
    expect(html).toContain('blue')
  })
})

// ── 5. Cache option ───────────────────────────────────────────────────────────

describe('scalarPlugin — cache: true', () => {
  test('cache: true → spec served correctly on first request', async () => {
    const app = createApp()
    app.get('/cached-route', (ctx) => ctx.json({ ok: true }))
    app.register(scalarPlugin(app, { cache: true }))
    const res  = await app.fetch(new Request('http://localhost/scalar/openapi.json'))
    const spec = await res.json() as OpenApiSpec
    expect(spec.openapi).toBe('3.1.0')
    expect('/cached-route' in spec.paths).toBe(true)
  })

  test('cache: true → late-registered routes do NOT appear (spec frozen after first request)', async () => {
    const app = createApp()
    app.register(scalarPlugin(app, { cache: true }))
    // Warm the cache
    await app.fetch(new Request('http://localhost/scalar/openapi.json'))
    // Register a route after cache is warm
    app.get('/late', (ctx) => ctx.json({ ok: true }))
    const res  = await app.fetch(new Request('http://localhost/scalar/openapi.json'))
    const spec = await res.json() as OpenApiSpec
    // Cache is frozen — late route not present
    expect('/late' in spec.paths).toBe(false)
  })

  test('cache: false (default) → late-registered routes DO appear', async () => {
    const app = createApp()
    app.register(scalarPlugin(app))  // cache: false by default
    await app.fetch(new Request('http://localhost/scalar/openapi.json'))
    app.get('/late', (ctx) => ctx.json({ ok: true }))
    const res  = await app.fetch(new Request('http://localhost/scalar/openapi.json'))
    const spec = await res.json() as OpenApiSpec
    expect('/late' in spec.paths).toBe(true)
  })
})

// ── 6. Reflects late-registered routes ────────────────────────────────────────

describe('scalarPlugin — live spec', () => {
  test('routes registered after scalarPlugin appear in spec', async () => {
    const app = createApp()
    app.register(scalarPlugin(app))   // registered first
    app.get('/late-route', (ctx) => ctx.json({ ok: true }))  // registered after

    const res  = await app.fetch(new Request('http://localhost/scalar/openapi.json'))
    const spec = await res.json() as OpenApiSpec
    // Spec is generated at request time — late routes are included
    expect('/late-route' in spec.paths).toBe(true)
  })

  test('module routes appear in spec', async () => {
    const mod = defineModule('/api/users')
      .get('/', (ctx) => ctx.json([]))
      .build()
    const app = createApp()
    app.register(scalarPlugin(app))
    app.register(mod)

    const res  = await app.fetch(new Request('http://localhost/scalar/openapi.json'))
    const spec = await res.json() as OpenApiSpec
    expect('/api/users/' in spec.paths).toBe(true)
  })
})
