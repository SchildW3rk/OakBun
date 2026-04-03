import { describe, test, expect } from 'bun:test'
import { defineResource, NotFoundError } from '../../packages/core/src/resource/index'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'
import { createApp } from '../../packages/core/src/app/index'
import { dbPlugin } from '../../packages/core/src/app/plugin'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'

// ── Shared schema ─────────────────────────────────────────────────────────────

const itemsTable = defineTable('res_items', {
  id:    column.integer().primaryKey(),
  name:  column.text(),
  price: column.integer().default(0),
}).build()

async function makeApp() {
  const adapter = new SQLiteAdapter()
  await adapter.execute(toCreateTableSql(itemsTable))

  const { module } = defineResource(itemsTable, { prefix: '/items' }).build()

  const app = createApp().plugin(dbPlugin(adapter))
  app.register(module)
  return app
}

// ── Happy path ────────────────────────────────────────────────────────────────

describe('defineResource — happy path', () => {
  test('GET / returns empty array initially', async () => {
    const app = await makeApp()
    const res = await app.fetch(new Request('http://localhost/items/'))
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(0)
  })

  test('POST / creates a row and returns 201', async () => {
    const app = await makeApp()
    const res = await app.fetch(new Request('http://localhost/items/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Widget' }),
    }))
    expect(res.status).toBe(201)
    const body = await res.json() as { id: number; name: string }
    expect(body.name).toBe('Widget')
    expect(typeof body.id).toBe('number')
  })

  test('GET /:id returns the created row', async () => {
    const app = await makeApp()
    const create = await app.fetch(new Request('http://localhost/items/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Gadget' }),
    }))
    const created = await create.json() as { id: number; name: string }

    const res = await app.fetch(new Request(`http://localhost/items/${created.id}`))
    expect(res.status).toBe(200)
    const body = await res.json() as { id: number; name: string }
    expect(body.name).toBe('Gadget')
  })

  test('PATCH /:id updates the row', async () => {
    const app = await makeApp()
    const create = await app.fetch(new Request('http://localhost/items/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Old' }),
    }))
    const created = await create.json() as { id: number; name: string }

    const res = await app.fetch(new Request(`http://localhost/items/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New' }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as { id: number; name: string }
    expect(body.name).toBe('New')
  })

  test('DELETE /:id removes the row', async () => {
    const app = await makeApp()
    const create = await app.fetch(new Request('http://localhost/items/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ToDelete' }),
    }))
    const created = await create.json() as { id: number }

    const del = await app.fetch(new Request(`http://localhost/items/${created.id}`, {
      method: 'DELETE',
    }))
    expect(del.status).toBe(200)

    const get = await app.fetch(new Request(`http://localhost/items/${created.id}`))
    expect(get.status).toBe(404)
  })

  test('GET / returns all rows after multiple inserts', async () => {
    const app = await makeApp()
    for (const name of ['A', 'B', 'C']) {
      await app.fetch(new Request('http://localhost/items/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }))
    }
    const res = await app.fetch(new Request('http://localhost/items/'))
    const body = await res.json() as unknown[]
    expect(body.length).toBe(3)
  })

  test('.build() returns Model, Service, module', () => {
    const result = defineResource(itemsTable, { prefix: '/items' }).build()
    expect(result.Model).toBeDefined()
    expect(result.Service).toBeDefined()
    expect(result.module).toBeDefined()
    expect(result.Service._serviceKey).toBe('res_itemsResource')
  })

  test('prefix defaults to table name when not specified', () => {
    const result = defineResource(itemsTable).build()
    expect(result.module.prefix).toBe('/res_items')
  })

  test('string shorthand: defineResource(table, "/items") works', () => {
    const result = defineResource(itemsTable, '/items').build()
    expect(result.module.prefix).toBe('/items')
  })
})

// ── Unhappy path ──────────────────────────────────────────────────────────────

describe('defineResource — unhappy path', () => {
  test('GET /:id with unknown id returns 404', async () => {
    const app = await makeApp()
    const res = await app.fetch(new Request('http://localhost/items/9999'))
    expect(res.status).toBe(404)
  })

  test('PATCH /:id with unknown id returns 404', async () => {
    const app = await makeApp()
    const res = await app.fetch(new Request('http://localhost/items/9999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    }))
    expect(res.status).toBe(404)
  })

  test('DELETE /:id with unknown id returns 404', async () => {
    const app = await makeApp()
    const res = await app.fetch(new Request('http://localhost/items/9999', {
      method: 'DELETE',
    }))
    expect(res.status).toBe(404)
  })

  test('POST / with invalid body returns 422 (schema validation)', async () => {
    const app = await makeApp()
    const res = await app.fetch(new Request('http://localhost/items/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: 'not-a-number' }), // name missing, price wrong type
    }))
    expect(res.status).toBe(422)
  })

  test('NotFoundError carries status 404', () => {
    const err = new NotFoundError('items with id 42 not found')
    expect(err.status).toBe(404)
    expect(err.message).toContain('42')
  })
})

// ── model override ────────────────────────────────────────────────────────────

describe('defineResource — model override', () => {
  test('model.index replaces default findAll', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const { module } = defineResource(itemsTable, {
      prefix: '/override-items',
      model: {
        index: (_db) => async () => [{ id: 99, name: 'mocked', price: 0 }],
      },
    }).build()

    const app = createApp().plugin(dbPlugin(adapter))
    app.register(module)

    const res  = await app.fetch(new Request('http://localhost/override-items/'))
    const body = await res.json() as { id: number; name: string }[]
    expect(body.length).toBe(1)
    expect(body[0]?.name).toBe('mocked')
  })

  test('model.store override — custom logic before insert', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const { module } = defineResource(itemsTable, {
      prefix: '/custom-store',
      model: {
        store: (db) => async (data) => {
          // force price to 999
          return db.into(itemsTable).insert({ ...data, price: 999 })
        },
      },
    }).build()

    const app = createApp().plugin(dbPlugin(adapter))
    app.register(module)

    const res  = await app.fetch(new Request('http://localhost/custom-store/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Pricy' }),
    }))
    expect(res.status).toBe(201)
    const body = await res.json() as { price: number }
    expect(body.price).toBe(999)
  })
})

// ── service override ──────────────────────────────────────────────────────────

describe('defineResource — service override', () => {
  test('service.store gets access to model and can call model methods', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const { module } = defineResource(itemsTable, {
      prefix: '/svc-store',
      service: {
        store: ({ model }) => async (data) => {
          // Use model.index to check count before insert
          const existing = await model.index()
          if (existing.length >= 2) throw new Error('Max 2 items')
          return model.store(data)
        },
      },
    }).build()

    const app = createApp().plugin(dbPlugin(adapter))
    app.register(module)

    // First two succeed
    await app.fetch(new Request('http://localhost/svc-store/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'A' }) }))
    await app.fetch(new Request('http://localhost/svc-store/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'B' }) }))

    // Third is blocked
    const res = await app.fetch(new Request('http://localhost/svc-store/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'C' }) }))
    expect(res.status).toBe(500) // service error → no status on Error → 500
  })
})

// ── routes config ─────────────────────────────────────────────────────────────

describe('defineResource — routes config', () => {
  test('routes.destroy: false removes DELETE /:id route', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const { module } = defineResource(itemsTable, {
      prefix: '/no-delete',
      routes: { destroy: false },
    }).build()

    const app = createApp().plugin(dbPlugin(adapter))
    app.register(module)

    const res = await app.fetch(new Request('http://localhost/no-delete/1', { method: 'DELETE' }))
    // Path exists (GET/PUT/PATCH registered) but DELETE was disabled — 405
    expect(res.status).toBe(405)
  })

  test('routes.index: false removes GET / route', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const { module } = defineResource(itemsTable, {
      prefix: '/no-list',
      routes: { index: false },
    }).build()

    const app = createApp().plugin(dbPlugin(adapter))
    app.register(module)

    const res = await app.fetch(new Request('http://localhost/no-list/'))
    // POST / (store) is still registered — GET / is disabled → 405
    expect(res.status).toBe(405)
  })

  test('routes.store: { summary } keeps route active', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const { module } = defineResource(itemsTable, {
      prefix: '/with-summary',
      routes: { store: { summary: 'Custom create' } },
    }).build()

    const app = createApp().plugin(dbPlugin(adapter))
    app.register(module)

    const res = await app.fetch(new Request('http://localhost/with-summary/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Widget' }),
    }))
    expect(res.status).toBe(201)
  })
})
