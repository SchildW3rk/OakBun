import { describe, test, expect, spyOn } from 'bun:test'
import { defineModel } from '../../packages/core/src/model/index'
import { defineService, detectCircular, instantiateServices } from '../../packages/core/src/service/index'
import { OakBunDB, BoundOakBunDB } from '../../packages/core/src/db/index'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { HookExecutor } from '../../packages/core/src/hooks/executor'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { dbPlugin } from '../../packages/core/src/app/plugin'

// ── Shared schema ──────────────────────────────────────────────────────────

const usersTable = defineTable('sv_users', {
  id:   column.integer().primaryKey(),
  name: column.text(),
  email: column.text(),
}).build()

function makeDb(): { adapter: SQLiteAdapter; db: OakBunDB; bound: BoundOakBunDB } {
  const adapter = new SQLiteAdapter()
  const hooks   = new HookExecutor()
  const db      = new OakBunDB(adapter, hooks)
  const bound   = db.withCtx({})
  return { adapter, db, bound }
}

const UserModel = defineModel('UserModel', usersTable, (db) => ({
  findByEmail: (email: string) =>
    db.from(usersTable).where({ email } as { email: string }).first(),
  findById: (id: number) =>
    db.from(usersTable).where({ id } as { id: number }).first(),
  findAll: () =>
    db.from(usersTable).select(),
}))

// ── Happy path ─────────────────────────────────────────────────────────────

describe('defineService — happy path', () => {
  test('defineService(key) sets _serviceKey correctly', () => {
    const svc = defineService('myService').define(() => ({}))
    expect(svc._serviceKey).toBe('myService')
  })

  test('.use(Model) adds model to _deps', () => {
    const svc = defineService('svc').use(UserModel).define(() => ({}))
    expect(svc._deps.length).toBe(1)
    expect((svc._deps[0] as typeof UserModel)._modelName).toBe('UserModel')
  })

  test('.define() receives typed deps — UserModel.findAll callable', async () => {
    const { adapter, db, bound } = makeDb()
    await adapter.execute(toCreateTableSql(usersTable))

    await bound.into(usersTable).insert({ name: 'Alice', email: 'alice@test.dev' })

    const UserSvc = defineService('users')
      .use(UserModel)
      .define(({ UserModel }) => ({
        listAll: () => UserModel.findAll(),
      }))

    const instances = instantiateServices([UserSvc], bound)
    const users = instances['users'] as { listAll: () => Promise<unknown[]> }
    const all = await users.listAll()
    expect(all.length).toBe(1)
  })

  test('ctx[key] available after .use(service) on module', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))

    const UserSvc = defineService('users')
      .use(UserModel)
      .define(({ UserModel }) => ({
        findAll: () => UserModel.findAll(),
      }))

    const mod = defineModule('/test')
      .use(UserSvc)
      .get('/', async (ctx) => {
        const users = await ctx.users.findAll()
        return ctx.json(users)
      })
      .build()

    const app = createApp()
      .plugin(dbPlugin(adapter))
    app.register(mod)

    const res = await app.fetch(new Request('http://localhost/test/'))
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })

  test('service-in-service: NotificationService via UserService', async () => {
    const { adapter, bound } = makeDb()
    await adapter.execute(toCreateTableSql(usersTable))

    const notified: number[] = []

    const NotifSvc = defineService('NotificationService')
      .use(UserModel)
      .define(({ UserModel }) => ({
        sendWelcome: async (id: number) => {
          const user = await UserModel.findById(id)
          if (user) notified.push(id)
        },
      }))

    const UserSvc = defineService('users')
      .use(UserModel)
      .use(NotifSvc)
      .define(({ UserModel, NotificationService }) => ({
        create: async (name: string, email: string) => {
          const user = await UserModel.db.into(usersTable).insert({ name, email })
          await NotificationService.sendWelcome(user.id)
          return user
        },
      }))

    const instances = instantiateServices([UserSvc], bound)
    const users = instances['users'] as { create: (n: string, e: string) => Promise<{ id: number }> }
    const u = await users.create('Bob', 'bob@test.dev')
    expect(notified).toContain(u.id)
  })

  test('app-level .use() — service global on all routes', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))

    const UserSvc = defineService('users')
      .use(UserModel)
      .define(({ UserModel }) => ({
        findAll: () => UserModel.findAll(),
      }))

    const app = createApp()
      .plugin(dbPlugin(adapter))
      .use(UserSvc)

    app.get('/users', async (ctx) => {
      const users = await ctx.users.findAll()
      return ctx.json(users)
    })

    const res = await app.fetch(new Request('http://localhost/users'))
    expect(res.status).toBe(200)
  })

  test('per-request — fresh instance per request', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))

    const instances: unknown[] = []

    const UserSvc = defineService('users')
      .use(UserModel)
      .define(({ UserModel }) => {
        const inst = { findAll: () => UserModel.findAll(), _id: Math.random() }
        instances.push(inst)
        return inst
      })

    const app = createApp()
      .plugin(dbPlugin(adapter))
      .use(UserSvc)
    app.get('/check', (ctx) => ctx.json({ ok: true }))

    await app.fetch(new Request('http://localhost/check'))
    await app.fetch(new Request('http://localhost/check'))

    expect(instances.length).toBe(2)
    expect((instances[0] as { _id: number })._id).not.toBe((instances[1] as { _id: number })._id)
  })
})

// ── Unhappy path ───────────────────────────────────────────────────────────

describe('defineService — unhappy path', () => {
  test('service method throws → handler gets 500', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))

    const BrokenSvc = defineService('broken')
      .define(() => ({
        doThing: (): never => { throw new Error('service-error') },
      }))

    const app = createApp()
      .plugin(dbPlugin(adapter))
      .use(BrokenSvc)
    app.get('/boom', (ctx) => {
      ctx.broken.doThing()
      return ctx.json({ ok: true })
    })

    const res = await app.fetch(new Request('http://localhost/boom'))
    expect(res.status).toBe(500)
  })

  test('circular dependency A → B → A → throws (both in top-level)', () => {
    const svcA: import('../../packages/core/src/service/index').ServiceDef<'A', unknown> = {
      _serviceKey: 'A',
      _deps: [],
      _factory: () => ({}),
    }
    const svcB: import('../../packages/core/src/service/index').ServiceDef<'B', unknown> = {
      _serviceKey: 'B',
      _deps: [svcA],
      _factory: () => ({}),
    }
    // Make A depend on B — cycle
    ;(svcA as { _deps: unknown[] })._deps = [svcB]

    expect(() => detectCircular([svcA, svcB])).toThrow('Circular dependency detected')
  })

  test('circular dependency detected even when only root is in top-level array', () => {
    // svcA only in top-level; svcB is a transitive dep — cycle must still be found
    const svcA: import('../../packages/core/src/service/index').ServiceDef<'A', unknown> = {
      _serviceKey: 'A',
      _deps: [],
      _factory: () => ({}),
    }
    const svcB: import('../../packages/core/src/service/index').ServiceDef<'B', unknown> = {
      _serviceKey: 'B',
      _deps: [svcA],
      _factory: () => ({}),
    }
    ;(svcA as { _deps: unknown[] })._deps = [svcB]

    // Only pass svcA — svcB is only reachable via svcA._deps
    expect(() => detectCircular([svcA])).toThrow('Circular dependency detected')
  })
})

// ── .options() — logger injection ──────────────────────────────────────────

describe('defineService — .options() logger', () => {
  test('logger always in deps — no .options() needed', () => {
    const { bound } = makeDb()
    let receivedLogger: unknown = undefined

    const Svc = defineService('svc').define(({ logger }) => {
      receivedLogger = logger
      return {}
    })

    instantiateServices([Svc], bound)
    expect(receivedLogger).toBeDefined()
    expect(typeof (receivedLogger as { debug: unknown }).debug).toBe('function')
  })

  test('.options({ log: { mask } }) — masked key replaced with ***', () => {
    const { bound } = makeDb()
    const lines: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { lines.push(msg) })

    const Svc = defineService('svc')
      .options({ log: { level: 'info', mask: ['password'] } })
      .define(({ logger }) => ({
        test: () => logger.info('credentials', { password: 'secret', name: 'alice' }),
      }))

    const inst = instantiateServices([Svc], bound) as { svc: { test: () => void } }
    inst.svc.test()

    spy.mockRestore()
    const line = lines.find((l) => l.includes('credentials'))
    expect(line).toBeDefined()
    expect(line).not.toContain('secret')
    expect(line).toContain('***')
    expect(line).toContain('alice')
  })

  test('.options({ log: { silent: true } }) — no output', () => {
    const { bound } = makeDb()
    const spy = spyOn(console, 'log').mockImplementation(() => {})

    const Svc = defineService('svc')
      .options({ log: { silent: true } })
      .define(({ logger }) => ({
        test: () => { logger.info('should be silent'); logger.debug('also silent') },
      }))

    const inst = instantiateServices([Svc], bound) as { svc: { test: () => void } }
    inst.svc.test()

    spy.mockRestore()
    // No assertions on spy needed — the fact it didn't throw is enough
    // but we verify by checking spy wasn't called
    // Re-spy to count calls
    const spy2 = spyOn(console, 'log').mockImplementation(() => {})
    const Svc2 = defineService('svc2')
      .options({ log: { silent: true } })
      .define(({ logger }) => ({ test: () => logger.info('x') }))
    const inst2 = instantiateServices([Svc2], bound) as { svc2: { test: () => void } }
    inst2.svc2.test()
    expect(spy2).not.toHaveBeenCalled()
    spy2.mockRestore()
  })

  test('.options({ log: { level: "error" } }) — only error level passes', () => {
    const { bound } = makeDb()
    const infoCalls: string[] = []
    const errorCalls: string[] = []
    const spy1 = spyOn(console, 'log').mockImplementation((msg: string) => { infoCalls.push(msg) })
    const spy2 = spyOn(console, 'error').mockImplementation((msg: string) => { errorCalls.push(msg) })

    const Svc = defineService('svc')
      .options({ log: { level: 'error' } })
      .define(({ logger }) => ({
        test: () => { logger.info('info-msg'); logger.error('error-msg') },
      }))

    const inst = instantiateServices([Svc], bound) as { svc: { test: () => void } }
    inst.svc.test()

    spy1.mockRestore()
    spy2.mockRestore()
    expect(infoCalls.some((m) => m.includes('info-msg'))).toBe(false)
    expect(errorCalls.some((m) => m.includes('error-msg'))).toBe(true)
  })
})
