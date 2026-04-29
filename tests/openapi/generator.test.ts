import { describe, test, expect } from 'bun:test'
import { z } from 'zod'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { generateOpenApiSpec } from '../../packages/core/src/openapi/generator'
import { jwtPlugin } from '../../packages/jwt/src/index'

describe('generateOpenApiSpec — basic', () => {
  test('empty routes → empty paths', () => {
    const app = createApp()
    const spec = app.getOpenApiSpec()
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info.title).toBe('OakBun API')
    expect(spec.info.version).toBe('1.0.0')
    expect(spec.paths).toEqual({})
  })

  test('custom title and version', () => {
    const app = createApp()
    const spec = app.getOpenApiSpec({ title: 'My API', version: '2.0.0' })
    expect(spec.info.title).toBe('My API')
    expect(spec.info.version).toBe('2.0.0')
  })

  test('simple GET route without schema', () => {
    const app = createApp()
    app.get('/users', (ctx) => ctx.json([]))
    const spec = app.getOpenApiSpec()
    expect(spec.paths['/users']).toBeDefined()
    expect(spec.paths['/users']!['get']).toBeDefined()
    expect(spec.paths['/users']!['get']!.responses['200']).toEqual({ description: 'Success' })
  })

  test('route with params schema', () => {
    const app = createApp()
    app.get('/users/:id', {
      params: z.object({ id: z.string() }),
      handler: (ctx) => ctx.json({ id: ctx.params.id }),
    })
    const spec = app.getOpenApiSpec()
    const op = spec.paths['/users/{id}']!['get']!
    expect(op.parameters).toHaveLength(1)
    expect(op.parameters![0]).toEqual({
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string' },
    })
  })

  test('route with query schema', () => {
    const app = createApp()
    app.get('/search', {
      query: z.object({ q: z.string(), limit: z.optional(z.number()) }),
      handler: (ctx) => ctx.json({ q: ctx.query['q'] }),
    })
    const spec = app.getOpenApiSpec()
    const op = spec.paths['/search']!['get']!
    expect(op.parameters).toHaveLength(2)
    const qParam = op.parameters!.find(p => p.name === 'q')!
    expect(qParam.required).toBe(true)
    expect(qParam.in).toBe('query')
    const limitParam = op.parameters!.find(p => p.name === 'limit')!
    expect(limitParam.required).toBe(false)
  })

  test('POST route with body schema', () => {
    const app = createApp()
    app.post('/users', {
      body: z.object({ name: z.string(), email: z.string().email() }),
      handler: (ctx) => ctx.json({ ok: true }),
    })
    const spec = app.getOpenApiSpec()
    const op = spec.paths['/users']!['post']!
    expect(op.requestBody).toBeDefined()
    expect(op.requestBody!.required).toBe(true)
    const bodySchema = op.requestBody!.content['application/json'].schema
    expect(bodySchema['type']).toBe('object')
  })

  test('route with response schema', () => {
    const app = createApp()
    app.get('/ping', {
      response: z.object({ pong: z.boolean() }),
      handler: (ctx) => ctx.json({ pong: true }),
    })
    const spec = app.getOpenApiSpec()
    const op = spec.paths['/ping']!['get']!
    expect(op.responses['200']!.content).toBeDefined()
    const responseSchema = op.responses['200']!.content!['application/json'].schema
    expect(responseSchema['type']).toBe('object')
  })

  test(':param path converted to {param} in OpenAPI path', () => {
    const app = createApp()
    app.get('/users/:userId/posts/:postId', (ctx) => ctx.json({}))
    const spec = app.getOpenApiSpec()
    expect(spec.paths['/users/{userId}/posts/{postId}']).toBeDefined()
  })

  test('multiple path params extracted', () => {
    const app = createApp()
    app.get('/a/:x/b/:y', (ctx) => ctx.json({}))
    const spec = app.getOpenApiSpec()
    const op = spec.paths['/a/{x}/b/{y}']!['get']!
    expect(op.parameters).toHaveLength(2)
    expect(op.parameters!.map(p => p.name)).toContain('x')
    expect(op.parameters!.map(p => p.name)).toContain('y')
  })
})

describe('generateOpenApiSpec — visibility', () => {
  test('route with visibility hidden is excluded', () => {
    const app = createApp()
    app.get('/public', (ctx) => ctx.json({}))
    // Register a hidden route via module
    const mod = defineModule('/internal')
      .visibility('hidden')
      .get('/secret', (ctx) => ctx.json({}))
      .build()
    app.register(mod)
    const spec = app.getOpenApiSpec()
    expect(spec.paths['/public']).toBeDefined()
    expect(spec.paths['/internal/secret']).toBeUndefined()
  })

  test('public module routes are included', () => {
    const app = createApp()
    const mod = defineModule('/api')
      .visibility('public')
      .get('/hello', (ctx) => ctx.json({}))
      .build()
    app.register(mod)
    const spec = app.getOpenApiSpec()
    expect(spec.paths['/api/hello']).toBeDefined()
  })

  test('module defaults to public when no visibility set', () => {
    const app = createApp()
    const mod = defineModule('/api')
      .get('/hello', (ctx) => ctx.json({}))
      .build()
    app.register(mod)
    const spec = app.getOpenApiSpec()
    expect(spec.paths['/api/hello']).toBeDefined()
  })
})

describe('generateOpenApiSpec — module schema routes', () => {
  test('module route with body schema appears in spec', () => {
    const app = createApp()
    const mod = defineModule('/users')
      .post('/', {
        body: z.object({ name: z.string() }),
        handler: (ctx) => ctx.json({ ok: true }),
      })
      .build()
    app.register(mod)
    const spec = app.getOpenApiSpec()
    const op = spec.paths['/users/']!['post']!
    expect(op.requestBody).toBeDefined()
  })

  test('standalone generateOpenApiSpec with routes array', () => {
    const routes = [
      {
        method: 'GET' as const,
        path: '/standalone',
        handler: { handler: (_ctx: unknown) => new Response('ok') },
        guards: [],
      },
    ]
    const spec = generateOpenApiSpec(routes, { title: 'Test', version: '3.0.0' })
    expect(spec.info.title).toBe('Test')
    expect(spec.paths['/standalone']).toBeDefined()
  })
})

// ── Auto-summary ───────────────────────────────────────────────────────────────

describe('generateOpenApiSpec — auto-summary', () => {
  function opFor(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string) {
    const app = createApp()
    if (method === 'GET')    app.get(path,    (ctx) => ctx.json({}))
    if (method === 'POST')   app.post(path,   (ctx) => ctx.json({}))
    if (method === 'PATCH')  app.patch(path,  (ctx) => ctx.json({}))
    if (method === 'PUT')    app.put(path,    (ctx) => ctx.json({}))
    if (method === 'DELETE') app.delete(path, (ctx) => ctx.json({}))
    const spec = app.getOpenApiSpec()
    const oaPath = path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}')
    return spec.paths[oaPath]![method.toLowerCase()]!
  }

  test('GET /users → "List users"', () => {
    expect(opFor('GET', '/users').summary).toBe('List users')
  })

  test('GET /users/:id → "Get users by id"', () => {
    expect(opFor('GET', '/users/:id').summary).toBe('Get users by id')
  })

  test('GET /users/search → "Search users"', () => {
    expect(opFor('GET', '/users/search').summary).toBe('Search users')
  })

  test('POST /users → "Create users"', () => {
    expect(opFor('POST', '/users').summary).toBe('Create users')
  })

  test('POST /users/export → "Export users"', () => {
    expect(opFor('POST', '/users/export').summary).toBe('Export users')
  })

  test('PATCH /users/:id → "Update users"', () => {
    expect(opFor('PATCH', '/users/:id').summary).toBe('Update users')
  })

  test('PUT /users/:id → "Update users"', () => {
    expect(opFor('PUT', '/users/:id').summary).toBe('Update users')
  })

  test('DELETE /users/:id → "Delete users"', () => {
    expect(opFor('DELETE', '/users/:id').summary).toBe('Delete users')
  })
})

// ── Auto-operationId ───────────────────────────────────────────────────────────

describe('generateOpenApiSpec — auto-operationId', () => {
  function opFor(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string) {
    const app = createApp()
    if (method === 'GET')    app.get(path,    (ctx) => ctx.json({}))
    if (method === 'POST')   app.post(path,   (ctx) => ctx.json({}))
    if (method === 'PATCH')  app.patch(path,  (ctx) => ctx.json({}))
    if (method === 'DELETE') app.delete(path, (ctx) => ctx.json({}))
    const spec = app.getOpenApiSpec()
    const oaPath = path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}')
    return spec.paths[oaPath]![method.toLowerCase()]!
  }

  test('GET /users → "listUsers"', () => {
    expect(opFor('GET', '/users').operationId).toBe('listUsers')
  })

  test('GET /users/:id → "getUsersById"', () => {
    expect(opFor('GET', '/users/:id').operationId).toBe('getUsersById')
  })

  test('GET /users/search → "searchUsers"', () => {
    expect(opFor('GET', '/users/search').operationId).toBe('searchUsers')
  })

  test('POST /users → "createUsers"', () => {
    expect(opFor('POST', '/users').operationId).toBe('createUsers')
  })

  test('PATCH /users/:id → "updateUsers"', () => {
    expect(opFor('PATCH', '/users/:id').operationId).toBe('updateUsers')
  })

  test('DELETE /users/:id → "deleteUsers"', () => {
    expect(opFor('DELETE', '/users/:id').operationId).toBe('deleteUsers')
  })
})

// ── docs override ──────────────────────────────────────────────────────────────

describe('generateOpenApiSpec — docs override', () => {
  test('docs.summary overrides auto-summary', () => {
    const app = createApp()
    app.get('/users', {
      docs: { summary: 'Fetch all users' },
      handler: (ctx) => ctx.json([]),
    })
    const spec = app.getOpenApiSpec()
    expect(spec.paths['/users']!['get']!.summary).toBe('Fetch all users')
  })

  test('docs.operationId overrides auto-operationId', () => {
    const app = createApp()
    app.get('/users', {
      docs: { operationId: 'myCustomOp' },
      handler: (ctx) => ctx.json([]),
    })
    const spec = app.getOpenApiSpec()
    expect(spec.paths['/users']!['get']!.operationId).toBe('myCustomOp')
  })

  test('docs.description appears in operation', () => {
    const app = createApp()
    app.get('/users', {
      docs: { description: 'Returns all users in the system.' },
      handler: (ctx) => ctx.json([]),
    })
    const spec = app.getOpenApiSpec()
    expect(spec.paths['/users']!['get']!.description).toBe('Returns all users in the system.')
  })

  test('docs override works on module routes', () => {
    const app = createApp()
    const mod = defineModule('/api')
      .get('/items', {
        docs: { summary: 'List items override' },
        handler: (ctx) => ctx.json([]),
      })
      .build()
    app.register(mod)
    const spec = app.getOpenApiSpec()
    expect(spec.paths['/api/items']!['get']!.summary).toBe('List items override')
  })
})

// ── Tag capitalization ─────────────────────────────────────────────────────────

describe('generateOpenApiSpec — tag capitalization', () => {
  test('single word tag is capitalized', () => {
    const app = createApp()
    app.get('/users', (ctx) => ctx.json([]))
    const spec = app.getOpenApiSpec()
    expect(spec.paths['/users']!['get']!.tags).toEqual(['Users'])
  })

  test('kebab-case tag becomes title case', () => {
    const mod = defineModule('/api-keys')
      .meta({ tag: 'api-keys' })
      .get('/', (ctx) => ctx.json([]))
      .build()
    const app = createApp()
    app.register(mod)
    const spec = app.getOpenApiSpec()
    expect(spec.paths['/api-keys/']!['get']!.tags).toEqual(['Api Keys'])
  })

  test('module meta.tag wins over path segment', () => {
    const mod = defineModule('/v1/items')
      .meta({ tag: 'inventory' })
      .get('/', (ctx) => ctx.json([]))
      .build()
    const app = createApp()
    app.register(mod)
    const spec = app.getOpenApiSpec()
    expect(spec.paths['/v1/items/']!['get']!.tags).toEqual(['Inventory'])
  })
})

// ── Security schemes ───────────────────────────────────────────────────────────

describe('generateOpenApiSpec — bearerAuth security', () => {
  test('jwtPlugin on module adds bearerAuth to operation', () => {
    const mod = defineModule('/protected')
      .plugin(jwtPlugin('test-secret-that-is-32-chars-ok!'))
      .get('/data', (ctx) => ctx.json({}))
      .build()
    const app = createApp()
    app.register(mod)
    const spec = app.getOpenApiSpec()
    const op = spec.paths['/protected/data']!['get']!
    expect(op.security).toEqual([{ bearerAuth: [] }])
  })

  test('jwtPlugin on module adds bearerAuth scheme to components', () => {
    const mod = defineModule('/secure')
      .plugin(jwtPlugin('test-secret-that-is-32-chars-ok!'))
      .get('/resource', (ctx) => ctx.json({}))
      .build()
    const app = createApp()
    app.register(mod)
    const spec = app.getOpenApiSpec()
    expect(spec.components?.securitySchemes?.['bearerAuth']).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    })
  })

  test('route without jwtPlugin has no security field', () => {
    const app = createApp()
    app.get('/public', (ctx) => ctx.json({}))
    const spec = app.getOpenApiSpec()
    expect(spec.paths['/public']!['get']!.security).toBeUndefined()
  })

  test('no jwtPlugin → no components.securitySchemes', () => {
    const app = createApp()
    app.get('/open', (ctx) => ctx.json({}))
    const spec = app.getOpenApiSpec()
    expect(spec.components?.securitySchemes).toBeUndefined()
  })
})

// ── description in info ────────────────────────────────────────────────────────

describe('generateOpenApiSpec — description option', () => {
  test('description is included in info when provided', () => {
    const spec = generateOpenApiSpec([], { title: 'Test', version: '1.0.0', description: 'My API description' })
    expect(spec.info.description).toBe('My API description')
  })

  test('description absent when not provided', () => {
    const spec = generateOpenApiSpec([], { title: 'Test', version: '1.0.0' })
    expect(spec.info.description).toBeUndefined()
  })

  test('getOpenApiSpec passes description through', () => {
    const app = createApp()
    const spec = app.getOpenApiSpec({ description: 'App description' })
    expect(spec.info.description).toBe('App description')
  })
})
