import { describe, test, expect, spyOn } from 'bun:test'
import { defineModel } from '../../packages/core/src/model/index'
import { OakBunDB, BoundOakBunDB } from '../../packages/core/src/db/index'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { HookExecutor } from '../../packages/core/src/hooks/executor'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'

const itemsTable = defineTable('mi_items', {
  id:   column.integer().primaryKey(),
  name: column.text(),
}).build()

function makeDb(): { adapter: SQLiteAdapter; db: OakBunDB } {
  const adapter = new SQLiteAdapter()
  const hooks   = new HookExecutor()
  const db      = new OakBunDB(adapter, hooks)
  return { adapter, db }
}

// ── Happy path ─────────────────────────────────────────────────────────────

describe('defineModel — happy path', () => {
  test('returns a ModelDef with correct _modelName', () => {
    const ItemModel = defineModel('ItemModel', itemsTable, (_db) => ({}))
    expect(ItemModel._modelName).toBe('ItemModel')
  })

  test('_factory is a function', () => {
    const ItemModel = defineModel('ItemModel', itemsTable, (_db) => ({}))
    expect(typeof ItemModel._factory).toBe('function')
  })

  test('factory receives BoundOakBunDB and returns model methods', async () => {
    const { adapter, db } = makeDb()
    await adapter.execute(toCreateTableSql(itemsTable))

    let capturedDb: BoundOakBunDB | null = null
    const ItemModel = defineModel('ItemModel', itemsTable, (boundDb) => {
      capturedDb = boundDb
      return {
        findAll: () => boundDb.from(itemsTable).select(),
      }
    })

    const bound = db.withCtx({})
    const inst  = ItemModel._factory(bound)

    expect(capturedDb).toBe(bound)
    expect(typeof inst.findAll).toBe('function')
  })

  test('instance has .db for raw access', async () => {
    const { adapter, db } = makeDb()
    await adapter.execute(toCreateTableSql(itemsTable))

    const ItemModel = defineModel('ItemModel', itemsTable, (boundDb) => ({
      findAll: () => boundDb.from(itemsTable).select(),
    }))

    const bound = db.withCtx({})
    const inst  = ItemModel._factory(bound)

    expect(inst.db).toBe(bound)
    expect(inst.db).toBeInstanceOf(BoundOakBunDB)
  })

  test('.db direct access: insert via model.db works', async () => {
    const { adapter, db } = makeDb()
    await adapter.execute(toCreateTableSql(itemsTable))

    const ItemModel = defineModel('ItemModel', itemsTable, (boundDb) => ({
      findAll: () => boundDb.from(itemsTable).select(),
    }))

    const bound = db.withCtx({})
    const inst  = ItemModel._factory(bound)

    await inst.db.into(itemsTable).insert({ name: 'Widget' })
    const rows = await inst.findAll()
    expect(rows.length).toBe(1)
    expect(rows[0]!.name).toBe('Widget')
  })

  test('two requests get separate BoundOakBunDB instances', () => {
    const { db } = makeDb()

    const ItemModel = defineModel('ItemModel', itemsTable, (boundDb) => ({
      findAll: () => boundDb.from(itemsTable).select(),
    }))

    const bound1 = db.withCtx({ req: 1 })
    const bound2 = db.withCtx({ req: 2 })

    const inst1 = ItemModel._factory(bound1)
    const inst2 = ItemModel._factory(bound2)

    expect(inst1.db).not.toBe(inst2.db)
  })

  test('model methods are callable and return correct types', async () => {
    const { adapter, db } = makeDb()
    await adapter.execute(toCreateTableSql(itemsTable))

    const ItemModel = defineModel('ItemModel', itemsTable, (boundDb) => ({
      findById: (id: number) =>
        boundDb.from(itemsTable).where({ id } as { id: number }).first(),
    }))

    const bound = db.withCtx({})
    const inst  = ItemModel._factory(bound)

    await inst.db.into(itemsTable).insert({ name: 'Alpha' })
    const all = await inst.db.from(itemsTable).select()
    const found = await inst.findById(all[0]!.id)
    expect(found?.name).toBe('Alpha')
  })
})

// ── Unhappy path ───────────────────────────────────────────────────────────

describe('defineModel — unhappy path', () => {
  test('model method throws → error propagates to caller', async () => {
    const { adapter, db } = makeDb()
    await adapter.execute(toCreateTableSql(itemsTable))

    const ItemModel = defineModel('ItemModel', itemsTable, (_db) => ({
      broken: (): never => { throw new Error('model-error') },
    }))

    const bound = db.withCtx({})
    const inst  = ItemModel._factory(bound)

    expect(() => inst.broken()).toThrow('model-error')
  })
})

// ── Builder pattern ─────────────────────────────────────────────────────────

describe('defineModel — builder pattern', () => {
  test('defineModel(name, table).define(...) returns ModelDef with correct _modelName', () => {
    const m = defineModel('ItemModel', itemsTable).define((_db) => ({}))
    expect(m._modelName).toBe('ItemModel')
  })

  test('builder factory receives { logger }', () => {
    const { db } = makeDb()
    let receivedLogger: unknown = undefined

    const m = defineModel('ItemModel', itemsTable).define((_db, { logger }) => {
      receivedLogger = logger
      return {}
    })

    m._factory(db.withCtx({}))
    expect(receivedLogger).toBeDefined()
    expect(typeof (receivedLogger as { debug: unknown }).debug).toBe('function')
  })

  test('logger scope is model:<name>', () => {
    const { db } = makeDb()
    const calls: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { calls.push(msg) })

    const m = defineModel('ItemModel', itemsTable)
      .options({ log: { level: 'debug' } })
      .define((_db, { logger }) => ({
        doWork: () => logger.debug('working'),
      }))

    const inst = m._factory(db.withCtx({}))
    inst.doWork()
    spy.mockRestore()

    expect(calls.some((c) => c.includes('model:ItemModel'))).toBe(true)
  })

  test('.options({ log: { mask } }) — masked key replaced with ***', () => {
    const { db } = makeDb()
    const lines: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { lines.push(msg) })

    const m = defineModel('ItemModel', itemsTable)
      .options({ log: { level: 'info', mask: ['token'] } })
      .define((_db, { logger }) => ({
        auth: () => logger.info('auth', { token: 'abc123', user: 'alice' }),
      }))

    const inst = m._factory(db.withCtx({}))
    inst.auth()
    spy.mockRestore()

    const line = lines.find((l) => l.includes('auth'))
    expect(line).toBeDefined()
    expect(line).not.toContain('abc123')
    expect(line).toContain('***')
    expect(line).toContain('alice')
  })

  test('compat: 3-arg defineModel still works — logger ignored', () => {
    const { db } = makeDb()
    const m = defineModel('ItemModel', itemsTable, (boundDb) => ({
      findAll: () => boundDb.from(itemsTable).select(),
    }))
    expect(m._modelName).toBe('ItemModel')
    expect(typeof m._factory).toBe('function')
    const inst = m._factory(db.withCtx({}))
    expect(typeof inst.findAll).toBe('function')
  })
})
