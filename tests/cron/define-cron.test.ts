import { describe, test, expect, mock, spyOn } from 'bun:test'
import { defineCron, resolveExpression } from '../../packages/core/src/cron/index'
import type { CronDef, CronCtx } from '../../packages/core/src/cron/index'
import { defineModule } from '../../packages/core/src/app/module'
import { createApp } from '../../packages/core/src/app/index'
import { dbPlugin } from '../../packages/core/src/app/plugin'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'
import { defineService } from '../../packages/core/src/service/index'
import { defineModel } from '../../packages/core/src/model/index'
import { BoundOakBunDB } from '../../packages/core/src/db/index'

// ── Test table + service ───────────────────────────────────────────────────────

const jobsTable = defineTable('jobs', {
  id:   column.integer().primaryKey(),
  name: column.text(),
  done: column.boolean().default(false),
}).build()

const JobModel = defineModel('jobs', jobsTable, (db) => ({
  findAll: () => db.from(jobsTable).select(),
  create:  (name: string) => db.into(jobsTable).insert({ name }),
}))

const JobService = defineService('jobService')
  .use(JobModel)
  .define((deps) => ({
    listJobs:  () => deps.jobs.findAll(),
    createJob: (name: string) => deps.jobs.create(name),
  }))

// ── 1. defineCron — structure ─────────────────────────────────────────────────

describe('defineCron — structure', () => {
  test('process-mode: .handler() produces CronDef with correct fields', () => {
    const handler = mock(async (_ctx: CronCtx) => {})
    const def = defineCron('test.job', '0 * * * *').handler(handler)

    expect(def._name).toBe('test.job')
    expect(def._expression).toBe('0 * * * *')
    expect(def._timezone).toBeUndefined()
    expect(def._runOnStart).toBe(false)
    expect(def._mode).toBe('process')
    expect(def._handler).toBe(handler)
    expect(def._script).toBeUndefined()
    expect(def._services).toHaveLength(0)
  })

  test('expression shortcuts are expanded at definition time', () => {
    expect(defineCron('a', '@minute'  ).handler(async () => {})._expression).toBe('* * * * *')
    expect(defineCron('b', '@hourly'  ).handler(async () => {})._expression).toBe('0 * * * *')
    expect(defineCron('c', '@daily'   ).handler(async () => {})._expression).toBe('0 0 * * *')
    expect(defineCron('d', '@midnight').handler(async () => {})._expression).toBe('0 0 * * *')
    expect(defineCron('e', '@weekly'  ).handler(async () => {})._expression).toBe('0 0 * * 0')
    expect(defineCron('f', '@monthly' ).handler(async () => {})._expression).toBe('0 0 1 * *')
    expect(defineCron('g', '@yearly'  ).handler(async () => {})._expression).toBe('0 0 1 1 *')
    expect(defineCron('h', '@annually').handler(async () => {})._expression).toBe('0 0 1 1 *')
  })

  test('custom expression is stored unchanged', () => {
    expect(defineCron('i', '0 3 * * *').handler(async () => {})._expression).toBe('0 3 * * *')
  })

  test('unknown expression string is stored unchanged', () => {
    expect(defineCron('j', '@unknown').handler(async () => {})._expression).toBe('@unknown')
  })

  test('os-mode: .os() produces CronDef with script, no handler', () => {
    const def = defineCron('backup.job', '0 2 * * *').os('./crons/backup.ts')

    expect(def._name).toBe('backup.job')
    expect(def._mode).toBe('os')
    expect(def._script).toBe('./crons/backup.ts')
    expect(def._handler).toBeUndefined()
    expect(def._services).toHaveLength(0)
  })

  test('timezone and runOnStart are stored via .options()', () => {
    const def = defineCron('tz.job', '*/5 * * * *')
      .options({ timezone: 'Europe/Vienna', runOnStart: true })
      .handler(async () => {})

    expect(def._timezone).toBe('Europe/Vienna')
    expect(def._runOnStart).toBe(true)
  })

  test('runOnStart defaults to false', () => {
    expect(defineCron('x', '* * * * *').handler(async () => {})._runOnStart).toBe(false)
  })

  test('.options() is chainable and merges correctly', () => {
    const def = defineCron('opts.test', '* * * * *')
      .options({ timezone: 'UTC' })
      .options({ runOnStart: true })
      .handler(async () => {})
    expect(def._timezone).toBe('UTC')
    expect(def._runOnStart).toBe(true)
  })

  test('mode defaults to process', () => {
    expect(defineCron('y', '* * * * *').handler(async () => {})._mode).toBe('process')
  })
})

// ── 1b. resolveExpression ─────────────────────────────────────────────────────

describe('resolveExpression', () => {
  test('@minute → * * * * *',   () => expect(resolveExpression('@minute')).toBe('* * * * *'))
  test('@hourly → 0 * * * *',   () => expect(resolveExpression('@hourly')).toBe('0 * * * *'))
  test('@daily → 0 0 * * *',    () => expect(resolveExpression('@daily')).toBe('0 0 * * *'))
  test('@midnight → 0 0 * * *', () => expect(resolveExpression('@midnight')).toBe('0 0 * * *'))
  test('@weekly → 0 0 * * 0',   () => expect(resolveExpression('@weekly')).toBe('0 0 * * 0'))
  test('@monthly → 0 0 1 * *',  () => expect(resolveExpression('@monthly')).toBe('0 0 1 * *'))
  test('@yearly → 0 0 1 1 *',   () => expect(resolveExpression('@yearly')).toBe('0 0 1 1 *'))
  test('@annually → 0 0 1 1 *', () => expect(resolveExpression('@annually')).toBe('0 0 1 1 *'))
  test('custom expression passthrough', () => expect(resolveExpression('0 3 * * *')).toBe('0 3 * * *'))
  test('unknown string passthrough', () => expect(resolveExpression('@unknown')).toBe('@unknown'))
})

// ── 2. CronBuilder.use() — immutable ──────────────────────────────────────────

describe('CronBuilder.use() — immutable', () => {
  test('.use() returns a new builder, original unchanged', () => {
    const builder  = defineCron('orig', '* * * * *')
    const withSvc  = builder.use(JobService)

    // Sealing each independently
    const defOrig = builder.handler(async () => {})
    const defWith = withSvc.handler(async () => {})

    expect(defOrig._services).toHaveLength(0)
    expect(defWith._services).toHaveLength(1)
    expect(defWith._services[0]!._serviceKey).toBe('jobService')
  })

  test('.use() chaining accumulates services', () => {
    const svc2 = defineService('svc2').define(() => ({ x: 1 }))
    const def = defineCron('chain', '* * * * *')
      .use(JobService)
      .use(svc2)
      .handler(async () => {})

    expect(def._services).toHaveLength(2)
  })

  test('.use() preserves name and expression', () => {
    const handler = mock(async (_ctx: CronCtx) => {})
    const def = defineCron('preserved', '0 2 * * *')
      .use(JobService)
      .handler(handler)

    expect(def._name).toBe('preserved')
    expect(def._expression).toBe('0 2 * * *')
    expect(def._handler).toBe(handler)
  })
})

// ── 3. Handler receives db ────────────────────────────────────────────────────

describe('Handler receives db', () => {
  test('handler ctx.db is a BoundOakBunDB', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(jobsTable))

    let receivedDb: unknown = null

    const def = defineCron('db.test', '* * * * *', { runOnStart: true })
      .handler(async ({ db }) => { receivedDb = db })

    const app = createApp().plugin(dbPlugin(adapter)).cron(def)

    const sysCtx = await import('../../packages/core/src/app/system-ctx').then((m) => m.createSystemCtx())
    const { OakBunDB } = await import('../../packages/core/src/db/index')
    const oakBunDb = new OakBunDB(adapter, app.hooks)
    const boundDb = oakBunDb.withCtx(sysCtx)

    const cronCtx: CronCtx = { db: boundDb }
    await def._handler!(cronCtx)

    expect(receivedDb).toBeInstanceOf(BoundOakBunDB)
  })

  test('handler can perform DB operations', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(jobsTable))

    const created: string[] = []

    const def = defineCron('db.ops', '* * * * *').handler(async ({ db }) => {
      await db.into(jobsTable).insert({ name: 'cron-created' })
      const all = await db.from(jobsTable).select()
      created.push(...all.map((j: { name: string }) => j.name))
    })

    const { OakBunDB } = await import('../../packages/core/src/db/index')
    const { createSystemCtx } = await import('../../packages/core/src/app/system-ctx')
    const oakBunDb = new OakBunDB(adapter, (createApp().plugin(dbPlugin(adapter))).hooks)
    const sysCtx = createSystemCtx()
    const boundDb = oakBunDb.withCtx(sysCtx)

    await def._handler!({ db: boundDb })
    expect(created).toContain('cron-created')
  })
})

// ── 4. Handler receives services — fully typed ────────────────────────────────

describe('Handler receives services via .use()', () => {
  test('ctx.jobService is typed — no cast needed', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(jobsTable))

    let svcAvailable = false

    // .use() before .handler() — ctx.jobService is fully typed
    const def = defineCron('svc.test', '* * * * *')
      .use(JobService)
      .handler(async (ctx) => {
        // No cast — TypeScript knows ctx.jobService
        svcAvailable = typeof ctx.jobService.listJobs === 'function'
      })

    const { OakBunDB } = await import('../../packages/core/src/db/index')
    const { createSystemCtx } = await import('../../packages/core/src/app/system-ctx')
    const { instantiateServices } = await import('../../packages/core/src/service/index')
    const appHooks = createApp().plugin(dbPlugin(adapter)).hooks
    const oakBunDb = new OakBunDB(adapter, appHooks)
    const sysCtx = createSystemCtx()
    const boundDb = oakBunDb.withCtx(sysCtx)
    const services = instantiateServices(def._services, boundDb)

    await def._handler!({ db: boundDb, ...services })
    expect(svcAvailable).toBe(true)
  })

  test('two .use() calls — both services typed on ctx', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(jobsTable))

    const svc2 = defineService('extraService').define(() => ({ ping: () => 'pong' }))

    let bothAvailable = false

    const def = defineCron('two-svc', '* * * * *')
      .use(JobService)
      .use(svc2)
      .handler(async (ctx) => {
        // Both typed — no cast
        const hasJob   = typeof ctx.jobService.listJobs === 'function'
        const hasExtra = typeof ctx.extraService.ping === 'function'
        bothAvailable  = hasJob && hasExtra
      })

    const { OakBunDB } = await import('../../packages/core/src/db/index')
    const { createSystemCtx } = await import('../../packages/core/src/app/system-ctx')
    const { instantiateServices } = await import('../../packages/core/src/service/index')
    const appHooks = createApp().plugin(dbPlugin(adapter)).hooks
    const oakBunDb = new OakBunDB(adapter, appHooks)
    const sysCtx = createSystemCtx()
    const boundDb = oakBunDb.withCtx(sysCtx)
    const services = instantiateServices(def._services, boundDb)

    await def._handler!({ db: boundDb, ...services })
    expect(bothAvailable).toBe(true)
  })
})

// ── 5. app.cron() ─────────────────────────────────────────────────────────────

describe('app.cron()', () => {
  test('stores CronDef on the app', () => {
    const def = defineCron('app.stored', '* * * * *').handler(async () => {})
    const app = createApp().cron(def)
    expect((app as any)._cronDefs).toHaveLength(1)
    expect((app as any)._cronDefs[0]._name).toBe('app.stored')
  })

  test('chaining multiple .cron() calls accumulates defs', () => {
    const def1 = defineCron('j1', '* * * * *').handler(async () => {})
    const def2 = defineCron('j2', '@hourly').handler(async () => {})
    const app = createApp().cron(def1).cron(def2)
    expect((app as any)._cronDefs).toHaveLength(2)
  })

  test('returns this for chaining', () => {
    const app = createApp()
    const def = defineCron('chain', '* * * * *').handler(async () => {})
    expect(app.cron(def)).toBe(app)
  })
})

// ── 6. ModuleBuilder.cron() ───────────────────────────────────────────────────

describe('ModuleBuilder.cron()', () => {
  test('.cron() stores def in module.cronDefs', () => {
    const def = defineCron('mod.job', '* * * * *').handler(async () => {})
    const module = defineModule('/jobs').cron(def).build()
    expect(module.cronDefs).toHaveLength(1)
    expect(module.cronDefs[0]!._name).toBe('mod.job')
  })

  test('two .cron() calls accumulate', () => {
    const def1 = defineCron('m1', '* * * * *').handler(async () => {})
    const def2 = defineCron('m2', '@hourly').handler(async () => {})
    const module = defineModule('/x').cron(def1).cron(def2).build()
    expect(module.cronDefs).toHaveLength(2)
  })

  test('without .cron() — cronDefs is empty array', () => {
    const module = defineModule('/plain').build()
    expect(module.cronDefs).toEqual([])
  })
})

// ── 7. app.register() merges module services into cron ───────────────────────

describe('app.register() — module cron service merging', () => {
  test('module-level service is merged into cron _services', () => {
    const def = defineCron('merge.test', '* * * * *').handler(async () => {})

    const module = defineModule('/jobs')
      .use(JobService)
      .cron(def)
      .build()

    const app = createApp()
    app.register(module)

    const cronDefs = (app as any)._cronDefs as CronDef[]
    expect(cronDefs).toHaveLength(1)
    expect(cronDefs[0]!._services.some((s: any) => s._serviceKey === 'jobService')).toBe(true)
  })

  test('cron-level .use() takes precedence over module service (not duplicated)', () => {
    const def = defineCron('dedup', '* * * * *')
      .use(JobService)
      .handler(async () => {})

    const module = defineModule('/jobs')
      .use(JobService)
      .cron(def)
      .build()

    const app = createApp()
    app.register(module)

    const cronDefs = (app as any)._cronDefs as CronDef[]
    const jobSvcCount = cronDefs[0]!._services.filter((s: any) => s._serviceKey === 'jobService').length
    expect(jobSvcCount).toBe(1)
  })
})

// ── 8. runOnStart — integration ───────────────────────────────────────────────

describe('runOnStart integration', () => {
  test('handler is called immediately when runOnStart: true and listen() is called', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(jobsTable))

    const called: boolean[] = []

    const def = defineCron('run.on.start', '0 3 * * *')
      .options({ runOnStart: true })
      .handler(async () => { called.push(true) })

    const app = createApp().plugin(dbPlugin(adapter)).cron(def)

    try {
      app.listen(0)
    } catch {
      // listen may throw in test context — that's fine
    }

    await new Promise((r) => setTimeout(r, 30))
    expect(called).toHaveLength(1)
  })
})

// ── 9. Error safety ───────────────────────────────────────────────────────────

describe('Error safety', () => {
  test('handler error is caught and logged — does not propagate', async () => {
    const errors: unknown[] = []

    const def = defineCron('error.job', '* * * * *', { onError: (err) => errors.push(err) })
      .handler(async () => { throw new Error('job failed') })

    const adapter = new SQLiteAdapter()

    const defWithStart: CronDef = {
      ...def,
      _runOnStart: true,
      use: def.use.bind(def),
    }

    const app2 = createApp().plugin(dbPlugin(adapter)).cron(defWithStart)

    try {
      app2.listen(0)
    } catch {
      // ignore
    }

    await new Promise((r) => setTimeout(r, 30))
    expect(errors.length).toBeGreaterThan(0)
    expect((errors[0] as Error).message).toBe('job failed')
  })
})

// ── 10. os-mode scheduling ────────────────────────────────────────────────────

describe('os-mode scheduling', () => {
  test('Bun.cron is called with (script, expression, name) for os-mode jobs', () => {
    const calls: Array<[string, string, string]> = []
    const originalCron = (Bun as any).cron
    ;(Bun as any).cron = (_script: string, _expr: string, _name: string) => {
      calls.push([_script, _expr, _name])
    }

    const def = defineCron('db-backup', '0 2 * * *').os('./crons/backup.ts')

    const app = createApp().cron(def)
    try { app.listen(0) } catch { /* ignore */ }

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(['./crons/backup.ts', '0 2 * * *', 'db-backup'])

    ;(Bun as any).cron = originalCron
  })

  test('os-mode: .os() shortcuts also expand', () => {
    const def = defineCron('nightly', '@daily').os('./crons/nightly.ts')
    expect(def._expression).toBe('0 0 * * *')
    expect(def._script).toBe('./crons/nightly.ts')
    expect(def._mode).toBe('os')
  })
})

// ── 11. createSystemCtx cookie fix ───────────────────────────────────────────

describe('createSystemCtx — cookie fix', () => {
  test('createSystemCtx() includes a cookie field (no TypeScript error)', async () => {
    const { createSystemCtx } = await import('../../packages/core/src/app/system-ctx')
    const ctx = createSystemCtx()
    expect(ctx.cookie).toBeDefined()
    expect(typeof ctx.cookie.get).toBe('function')
    expect(typeof ctx.cookie.set).toBe('function')
    expect(typeof ctx.cookie.delete).toBe('function')
    expect(typeof ctx.cookie._pending).toBe('function')
  })

  test('cookie.get always returns undefined', async () => {
    const { createSystemCtx } = await import('../../packages/core/src/app/system-ctx')
    const ctx = createSystemCtx()
    expect(ctx.cookie.get('session')).toBeUndefined()
  })

  test('cookie._pending always returns []', async () => {
    const { createSystemCtx } = await import('../../packages/core/src/app/system-ctx')
    const ctx = createSystemCtx()
    ctx.cookie.set('x', 'y')  // no-op
    expect(ctx.cookie._pending()).toEqual([])
  })
})

// ── 12. defineCron — LogOptions ───────────────────────────────────────────────

describe('defineCron — .options({ log })', () => {
  test('.options({ log: { level: "debug" } }) — debug logs emitted', () => {
    const calls: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { calls.push(msg) })

    const def = defineCron('log.test', '* * * * *')
      .options({ log: { level: 'debug' } })
      .handler(async (_ctx, logger) => {
        logger.debug('debug-msg')
        logger.info('info-msg')
      })

    // Invoke handler directly
    const { SQLiteAdapter } = require('../../packages/core/src/adapter/sqlite')
    const { OakBunDB } = require('../../packages/core/src/db/index')
    const { createSystemCtx } = require('../../packages/core/src/app/system-ctx')
    const adapter = new SQLiteAdapter()
    const { HookExecutor } = require('../../packages/core/src/hooks/executor')
    const oakBunDb = new OakBunDB(adapter, new HookExecutor())
    const boundDb = oakBunDb.withCtx(createSystemCtx())

    void def._handler!({ db: boundDb }, def._logger)
    spy.mockRestore()

    expect(calls.some((c) => c.includes('debug-msg'))).toBe(true)
    expect(calls.some((c) => c.includes('info-msg'))).toBe(true)
  })

  test('.options({ log: { mask: ["secret"] } }) — secret masked', () => {
    const lines: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { lines.push(msg) })

    const def = defineCron('mask.test', '* * * * *')
      .options({ log: { level: 'info', mask: ['secret'] } })
      .handler(async (_ctx, logger) => {
        logger.info('auth', { secret: 'abc', user: 'bob' })
      })

    void def._handler!({ db: undefined as never }, def._logger)
    spy.mockRestore()

    const line = lines.find((l) => l.includes('auth'))
    expect(line).toBeDefined()
    expect(line).not.toContain('abc')
    expect(line).toContain('***')
    expect(line).toContain('bob')
  })

  test('.options({ log: { silent: true } }) — no output', () => {
    const spy = spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})

    const def = defineCron('silent.test', '* * * * *')
      .options({ log: { silent: true } })
      .handler(async (_ctx, logger) => {
        logger.info('x')
        logger.error('y')
      })

    void def._handler!({ db: undefined as never }, def._logger)
    expect(spy).not.toHaveBeenCalled()
    expect(errSpy).not.toHaveBeenCalled()
    spy.mockRestore()
    errSpy.mockRestore()
  })
})
