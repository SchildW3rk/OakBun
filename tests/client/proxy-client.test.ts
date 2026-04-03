import { describe, test, expect } from 'bun:test'
import { z } from 'zod'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { createProxyClient, createModuleClient, pathToClientKey } from '../../packages/core/src/client/proxy'
import { VelnClientError } from '../../packages/core/src/client/error'
import { NotFoundError, ConflictError } from '../../packages/core/src/errors/index'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'
import { dbPlugin } from '../../packages/core/src/app/plugin'

// ── Shared test table ─────────────────────────────────────────────────────────

const usersTable = defineTable('proxy_users', {
  id:   column.integer().primaryKey(),
  name: column.text(),
  role: column.text().default('user'),
}).build()

// ── 1. pathToClientKey ────────────────────────────────────────────────────────

describe('pathToClientKey', () => {
  test('/users → users', () => expect(pathToClientKey('/users')).toBe('users'))
  test('/api/users → apiUsers', () => expect(pathToClientKey('/api/users')).toBe('apiUsers'))
  test('/blog-posts → blogPosts', () => expect(pathToClientKey('/blog-posts')).toBe('blogPosts'))
  test('/v1/orders → v1Orders', () => expect(pathToClientKey('/v1/orders')).toBe('v1Orders'))
  test('/shop/items → shopItems', () => expect(pathToClientKey('/shop/items')).toBe('shopItems'))
})

// ── 2. Happy path — CRUD methods ──────────────────────────────────────────────

function makeCrudApp() {
  const mod = defineModule('/api/users')
    .get('/', (ctx) => ctx.json([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]))
    .get('/:id', (ctx) => ctx.json({ id: Number(ctx.params.id), name: 'Alice' }))
    .post('/', async (ctx) => {
      const body = await ctx.req.json() as { name: string }
      return ctx.json({ id: 3, name: body.name }, 201)
    })
    .patch('/:id', async (ctx) => {
      const body = await ctx.req.json() as { name: string }
      return ctx.json({ id: Number(ctx.params.id), name: body.name })
    })
    .delete('/:id', (ctx) => ctx.json({ id: Number(ctx.params.id), name: 'Deleted' }))
    .build()

  const app = createApp()
  app.register(mod)
  return app
}

describe('createProxyClient — happy path CRUD', () => {
  test('index() → ok: true, data: User[], status: 200', async () => {
    const app = makeCrudApp()
    const client = createProxyClient(app, 'http://localhost', { fetch: app.fetch.bind(app) })
    const result = await client.apiUsers.index()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.status).toBe(200)
      expect(Array.isArray(result.data)).toBe(true)
    }
  })

  test('show(1) → ok: true, data: User, status: 200', async () => {
    const app = makeCrudApp()
    const client = createProxyClient(app, 'http://localhost', { fetch: app.fetch.bind(app) })
    const result = await client.apiUsers.show(1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.status).toBe(200)
      expect((result.data as { id: number }).id).toBe(1)
    }
  })

  test('store(body) → ok: true, status: 201', async () => {
    const app = makeCrudApp()
    const client = createProxyClient(app, 'http://localhost', { fetch: app.fetch.bind(app) })
    const result = await client.apiUsers.store({ name: 'Charlie' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.status).toBe(201)
      expect((result.data as { name: string }).name).toBe('Charlie')
    }
  })

  test('update(1, body) → ok: true, status: 200', async () => {
    const app = makeCrudApp()
    const client = createProxyClient(app, 'http://localhost', { fetch: app.fetch.bind(app) })
    const result = await client.apiUsers.update(1, { name: 'Updated' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.data as { name: string }).name).toBe('Updated')
    }
  })

  test('destroy(1) → ok: true, status: 200', async () => {
    const app = makeCrudApp()
    const client = createProxyClient(app, 'http://localhost', { fetch: app.fetch.bind(app) })
    const result = await client.apiUsers.destroy(1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.status).toBe(200)
    }
  })
})

// ── 3. Result pattern — unhappy path ─────────────────────────────────────────

describe('createProxyClient — result pattern (ok: false)', () => {
  test('404 VelnError → { ok: false, status: 404, code, message }', async () => {
    const mod = defineModule('/users')
      .get('/:id', (ctx) => {
        throw new NotFoundError(`User with id ${ctx.params.id} not found`, 'USER_NOT_FOUND')
      })
      .build()
    const app = createApp()
    app.register(mod)
    const client = createProxyClient(app, 'http://localhost', { fetch: app.fetch.bind(app) })

    const result = await client.users.show(99)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(404)
      expect(result.code).toBe('USER_NOT_FOUND')
      expect(result.message).toContain('User with id 99')
      expect(result.error).toBeInstanceOf(VelnClientError)
    }
  })

  test('409 ConflictError → { ok: false, status: 409, code }', async () => {
    const mod = defineModule('/items')
      .post('/', () => { throw new ConflictError('Slug taken', 'SLUG_CONFLICT') })
      .build()
    const app = createApp()
    app.register(mod)
    const client = createProxyClient(app, 'http://localhost', { fetch: app.fetch.bind(app) })

    const result = await client.items.store({})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.code).toBe('SLUG_CONFLICT')
    }
  })
})

// ── 4. throws: true option ────────────────────────────────────────────────────

describe('createProxyClient — throws: true', () => {
  test('404 → throws VelnClientError with status + code', async () => {
    const mod = defineModule('/users')
      .get('/:id', () => { throw new NotFoundError('not found', 'USER_NOT_FOUND') })
      .build()
    const app = createApp()
    app.register(mod)
    const client = createProxyClient(app, 'http://localhost', {
      fetch: app.fetch.bind(app),
      throws: true,
    })

    let caught: VelnClientError | null = null
    try {
      await client.users.show(99)
    } catch (err) {
      if (err instanceof VelnClientError) caught = err
    }
    expect(caught).not.toBeNull()
    expect(caught!.status).toBe(404)
    expect(caught!.code).toBe('USER_NOT_FOUND')
  })
})

// ── 5. Global headers ─────────────────────────────────────────────────────────

describe('createProxyClient — global headers', () => {
  test('global headers are sent with every request', async () => {
    let receivedAuth: string | null = null
    const mod = defineModule('/secure')
      .get('/', (ctx) => {
        receivedAuth = ctx.req.headers.get('Authorization')
        return ctx.json({ ok: true })
      })
      .build()
    const app = createApp()
    app.register(mod)
    const client = createProxyClient(app, 'http://localhost', {
      fetch: app.fetch.bind(app),
      headers: { Authorization: 'Bearer test-token' },
    })

    await client.secure.index()
    expect(receivedAuth).toBe('Bearer test-token')
  })
})

// ── 6. Query parameters ───────────────────────────────────────────────────────

describe('createProxyClient — query parameters', () => {
  test('query option is appended as URLSearchParams', async () => {
    let receivedQuery: Record<string, string | string[]> = {}
    const mod = defineModule('/search')
      .get('/', (ctx) => {
        receivedQuery = ctx.query as Record<string, string | string[]>
        return ctx.json({ results: [] })
      })
      .build()
    const app = createApp()
    app.register(mod)
    const client = createProxyClient(app, 'http://localhost', { fetch: app.fetch.bind(app) })

    await client.search.index({ query: { role: 'admin' } })
    expect(receivedQuery.role).toBe('admin')
  })
})

// ── 7. Multiple modules → multiple namespaces ─────────────────────────────────

describe('createProxyClient — multiple modules', () => {
  test('two modules produce two namespaces', async () => {
    const usersMod = defineModule('/users')
      .get('/', (ctx) => ctx.json([]))
      .build()
    const itemsMod = defineModule('/items')
      .get('/', (ctx) => ctx.json([]))
      .build()

    const app = createApp()
    app.register(usersMod)
    app.register(itemsMod)

    const client = createProxyClient(app, 'http://localhost', { fetch: app.fetch.bind(app) })

    const ur = await client.users.index()
    const ir = await client.items.index()
    expect(ur.ok).toBe(true)
    expect(ir.ok).toBe(true)
  })
})

// ── 8. createModuleClient — single module ────────────────────────────────────

describe('createModuleClient', () => {
  test('single module client has correct methods', async () => {
    const mod = defineModule('/products')
      .get('/', (ctx) => ctx.json([{ id: 1, name: 'Widget' }]))
      .get('/:id', (ctx) => ctx.json({ id: Number(ctx.params.id), name: 'Widget' }))
      .build()
    const app = createApp()
    app.register(mod)

    const client = createModuleClient(mod, 'http://localhost', { fetch: app.fetch.bind(app) })
    const result = await client.index()
    expect(result.ok).toBe(true)
    if (result.ok) expect(Array.isArray(result.data)).toBe(true)
  })
})

// ── 9. Integration — with dbPlugin ───────────────────────────────────────────

describe('createProxyClient — integration with DB', () => {
  test('full flow: store → show → 404 with code', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))

    const mod = defineModule('/api/users')
      .get('/:id', async (ctx) => {
        const user = await ctx.db!.from(usersTable)
          .where({ id: Number(ctx.params.id) as unknown as boolean })
          .first()
        if (!user) throw new NotFoundError(`User with id ${ctx.params.id} not found`, 'USER_NOT_FOUND')
        return ctx.json(user)
      })
      .post('/', async (ctx) => {
        const body = await ctx.req.json() as { name: string }
        const user = await ctx.db!.into(usersTable).insert({ name: body.name })
        return ctx.json(user, 201)
      })
      .build()

    const app = createApp().plugin(dbPlugin(adapter))
    app.register(mod)

    const client = createProxyClient(app, 'http://localhost', { fetch: app.fetch.bind(app) })

    // store
    const storeResult = await client.apiUsers.store({ name: 'Alice' })
    expect(storeResult.ok).toBe(true)
    if (storeResult.ok) {
      expect((storeResult.data as { name: string }).name).toBe('Alice')
      expect(storeResult.status).toBe(201)
    }

    // 404 with code
    const notFound = await client.apiUsers.show(9999)
    expect(notFound.ok).toBe(false)
    if (!notFound.ok) {
      expect(notFound.status).toBe(404)
      expect(notFound.code).toBe('USER_NOT_FOUND')
    }
  })
})

// ── 10. Custom method names ───────────────────────────────────────────────────

describe('createProxyClient — custom route method names', () => {
  test('GET /export → getExport()', async () => {
    const mod = defineModule('/items')
      .get('/export', (ctx) => ctx.json({ format: 'csv' }))
      .build()
    const app = createApp()
    app.register(mod)
    const client = createProxyClient(app, 'http://localhost', { fetch: app.fetch.bind(app) })

    expect(typeof client.items.getExport).toBe('function')
    const result = await client.items.getExport()
    expect(result.ok).toBe(true)
  })

  test('POST /:id/publish → postByIdPublish(id)', async () => {
    const mod = defineModule('/posts')
      .post('/:id/publish', (ctx) => ctx.json({ id: ctx.params.id, published: true }, 200))
      .build()
    const app = createApp()
    app.register(mod)
    const client = createProxyClient(app, 'http://localhost', { fetch: app.fetch.bind(app) })

    expect(typeof client.posts.postByIdPublish).toBe('function')
    const result = await client.posts.postByIdPublish(42)
    expect(result.ok).toBe(true)
  })
})
