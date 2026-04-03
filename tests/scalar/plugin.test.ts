import { describe, test, expect } from 'bun:test'
import { z } from 'zod'
import { createApp } from '../../packages/core/src/app/index'
import { scalarPlugin } from '../../packages/scalar/src/index'

describe('scalarPlugin', () => {
  test('registers GET route at default /docs path', async () => {
    const app = createApp()
    app.plugin(scalarPlugin(app))

    const res = await app.fetch(new Request('http://localhost/docs'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
  })

  test('registers GET route at custom path', async () => {
    const app = createApp()
    app.plugin(scalarPlugin(app, { path: '/api-docs' }))

    const res = await app.fetch(new Request('http://localhost/api-docs'))
    expect(res.status).toBe(200)
  })

  test('returns HTML with embedded spec JSON', async () => {
    const app = createApp()
    app.get('/hello', (ctx) => ctx.json({ hello: 'world' }))
    app.plugin(scalarPlugin(app, { title: 'Test API', version: '1.2.3' }))

    const res = await app.fetch(new Request('http://localhost/docs'))
    const html = await res.text()

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Test API')
    expect(html).toContain('application/json')
    expect(html).toContain('@scalar/api-reference')
    // Spec JSON is embedded
    expect(html).toContain('"openapi":"3.1.0"')
    expect(html).toContain('"version":"1.2.3"')
  })

  test('spec includes routes registered before scalarPlugin', async () => {
    const app = createApp()
    app.get('/users', {
      response: z.object({ users: z.array(z.string()) }),
      handler: (ctx) => ctx.json({ users: [] }),
    })
    app.plugin(scalarPlugin(app))

    const res = await app.fetch(new Request('http://localhost/docs'))
    const html = await res.text()
    expect(html).toContain('/users')
  })

  test('docs route is not 404 after plugin registration', async () => {
    const app = createApp()
    // Without plugin
    const resBefore = await app.fetch(new Request('http://localhost/docs'))
    expect(resBefore.status).toBe(404)

    // With plugin
    const app2 = createApp()
    app2.plugin(scalarPlugin(app2))
    const resAfter = await app2.fetch(new Request('http://localhost/docs'))
    expect(resAfter.status).toBe(200)
  })

  test('plugin name is scalar', () => {
    const app = createApp()
    const plugin = scalarPlugin(app)
    expect(plugin.name).toBe('scalar')
  })

  test('plugin request() returns ctx unchanged', async () => {
    const app = createApp()
    const plugin = scalarPlugin(app)
    const fakeCtx = { req: new Request('http://localhost/'), params: {}, query: {}, json: () => new Response(), text: () => new Response(), html: () => new Response() }
    const result = await plugin.request(fakeCtx)
    expect(result).toMatchObject(fakeCtx)
  })
})
