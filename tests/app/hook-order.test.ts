import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { defineGuard, createOnRequest, createOnBeforeHandle, createOnResponse } from '../../packages/core/src/app/types'
import { definePlugin } from '../../packages/core/src/app/plugin'
import { HookExecutor } from '../../packages/core/src/hooks/executor'
import { defineTable } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'
import { ForbiddenError } from '../../packages/core/src/errors/index'
import type { BaseCtx } from '../../packages/core/src/app/types'

// ── Test 1 — Full Request-Pipeline Order ─────────────────────────────────────
//
// Invariant (must never change):
//   appOnRequest → moduleOnRequest → pluginContext →
//   appBeforeHandle → moduleBeforeHandle → handler →
//   appOnResponse → moduleOnResponse
//
// Notes:
//   - Schema validation and service instantiation run between pluginContext and guards
//     but are not observable without schemas/services — omitted from this test.
//   - Guards run after pluginContext, before appBeforeHandle — covered in Test 2.

describe('Test 1 — Request-pipeline phase order', () => {
  test('all hook types fire in correct order', async () => {
    const log: string[] = []

    // Plugin that records when request() runs (Phase 2a)
    const tracingPlugin = definePlugin<{ _traced: true }>('tracing')
      .extend(() => {
        log.push('pluginContext')
        return { _traced: true as const }
      })

    const mod = defineModule('/pipeline')
      .plugin(tracingPlugin)
      .onRequest(createOnRequest(() => { log.push('moduleOnRequest') }))
      .onBeforeHandle(createOnBeforeHandle(() => { log.push('moduleBeforeHandle') }))
      .onResponse(createOnResponse(() => { log.push('moduleOnResponse') }))
      .get('/go', { handler: (ctx) => { log.push('handler'); return ctx.json({ ok: true }) } })
      .build()

    const app = createApp()
    app.register(mod)

    app.onRequest(createOnRequest(() => { log.push('appOnRequest') }))
    app.onBeforeHandle(createOnBeforeHandle(() => { log.push('appBeforeHandle') }))
    app.onResponse(createOnResponse(() => { log.push('appOnResponse') }))

    const res = await app.fetch(new Request('http://localhost/pipeline/go'))
    expect(res.status).toBe(200)

    expect(log).toEqual([
      'appOnRequest',
      'moduleOnRequest',
      'pluginContext',
      'appBeforeHandle',
      'moduleBeforeHandle',
      'handler',
      'appOnResponse',
      'moduleOnResponse',
    ])
  })
})

// ── Test 2 — Guard Execution Order ───────────────────────────────────────────
//
// Invariant: Module Guards → Route Guards (module guards run before route guards)
// All guards pass → handler runs.
//
// Note: App-level "global guards" are not a public API on createApp() —
// they are only accessible via plugins with .permissions() and are checked
// in Phase 0 (before module/route guards). Module and route guards are the
// two observable tiers tested here.

describe('Test 2 — Guard execution order (all pass)', () => {
  test('module guard runs before route guard, then handler', async () => {
    const log: string[] = []

    const moduleGuard = defineGuard('module-order').check(() => { log.push('module') })
    const routeGuard  = defineGuard('route-order').check(() => { log.push('route') })

    const mod = defineModule('/guards')
      .guard(moduleGuard)
      .get('/check', {
        guard:   routeGuard,
        handler: (ctx) => { log.push('handler'); return ctx.json({ ok: true }) },
      })
      .build()

    const app = createApp()
    app.register(mod)

    const res = await app.fetch(new Request('http://localhost/guards/check'))
    expect(res.status).toBe(200)

    expect(log).toEqual(['module', 'route', 'handler'])
  })
})

// ── Test 3 — Guard Short-Circuit ─────────────────────────────────────────────
//
// Invariant: When a guard blocks, all subsequent guards and the handler
// must never be called.

describe('Test 3 — Guard short-circuit', () => {
  test('blocking module guard prevents route guard and handler from running', async () => {
    const log: string[] = []

    const blockingGuard = defineGuard('blocking-sc').check(() => {
      log.push('blocking')
      throw new ForbiddenError('access denied')
    })
    const routeGuard = defineGuard('route-sc').check(() => { log.push('route') })

    const mod = defineModule('/sc')
      .guard(blockingGuard)
      .get('/resource', {
        guard:   routeGuard,
        handler: (ctx) => { log.push('handler'); return ctx.json({ ok: true }) },
      })
      .build()

    const app = createApp()
    app.register(mod)

    const res = await app.fetch(new Request('http://localhost/sc/resource'))

    expect(res.status).toBe(403)
    expect(log).toEqual(['blocking'])   // route guard and handler never called
  })
})

// ── Test 4 — Module Guard OptOut ─────────────────────────────────────────────
//
// Invariant: guard: false on a route bypasses module guard for that route only.
// Other routes in the same module still run the module guard.

describe('Test 4 — Module guard opt-out isolation', () => {
  test('guard: false skips module guard for that route, other routes still guarded', async () => {
    const guardLog: string[] = []

    const moduleGuard = defineGuard('mod-optout').check(() => {
      guardLog.push('moduleGuard')
      // passes — does not throw
    })

    const mod = defineModule('/optout')
      .guard(moduleGuard)
      .get('/public',  { guard: false, handler: (ctx) => ctx.json({ route: 'public' }) })
      .get('/private', {               handler: (ctx) => ctx.json({ route: 'private' }) })
      .build()

    const app = createApp()
    app.register(mod)

    // Public route — module guard must NOT run
    guardLog.length = 0
    const pub = await app.fetch(new Request('http://localhost/optout/public'))
    expect(pub.status).toBe(200)
    expect(guardLog).toEqual([])

    // Private route — module guard MUST run
    guardLog.length = 0
    const priv = await app.fetch(new Request('http://localhost/optout/private'))
    expect(priv.status).toBe(200)
    expect(guardLog).toEqual(['moduleGuard'])
  })
})

// ── Test 5 — DB Hook Order ───────────────────────────────────────────────────
//
// Invariant (HookExecutor):
//   table.beforeInsert → module.beforeInsert → SQL → table.afterInsert → module.afterInsert
//
// Tested directly via HookExecutor.runBeforeInsert / runAfterInsert — no HTTP pipeline needed.

describe('Test 5 — DB hook execution order', () => {
  test('table hooks run before module hooks (beforeInsert)', async () => {
    const log: string[] = []

    const usersTable = defineTable('hook_order_users', {
      id:   column.integer().primaryKey(),
      name: column.text(),
    })
      .hook({
        beforeInsert: (data) => {
          log.push('table.beforeInsert')
          return data
        },
        afterInsert: (_result, _input) => {
          log.push('table.afterInsert')
        },
      })
      .build()

    const executor = new HookExecutor()
    executor.registerModuleHook(usersTable.name, {
      beforeInsert: (_ctx, data) => {
        log.push('module.beforeInsert')
        return data
      },
      afterInsert: (_ctx, _result, _input) => {
        log.push('module.afterInsert')
      },
    })

    // Simulate: before → SQL (represented by pushing 'sql') → after
    const inputData = { name: 'Alice' }
    await executor.runBeforeInsert(usersTable, {}, inputData)
    log.push('sql')
    const inserted = { id: 1, name: 'Alice' }
    await executor.runAfterInsert(usersTable, {}, inserted, inputData)

    expect(log).toEqual([
      'table.beforeInsert',
      'module.beforeInsert',
      'sql',
      'table.afterInsert',
      'module.afterInsert',
    ])
  })
})

// ── Test 6 — onResponse always runs ──────────────────────────────────────────
//
// Invariant: onResponse hooks fire even when the handler throws.
// This guarantees logging/cleanup hooks always execute.

describe('Test 6 — onResponse always runs, even on handler error', () => {
  test('app onResponse and module onResponse both fire after handler throw', async () => {
    const log: string[] = []

    const mod = defineModule('/always')
      .onResponse(createOnResponse(() => { log.push('moduleOnResponse') }))
      .get('/boom', (_ctx) => {
        throw new Error('handler crash')
      })
      .build()

    const app = createApp()
    app.register(mod)
    app.onResponse(createOnResponse(() => { log.push('appOnResponse') }))

    const res = await app.fetch(new Request('http://localhost/always/boom'))

    expect(res.status).toBe(500)
    // Both onResponse hooks must have fired despite the error
    expect(log).toContain('appOnResponse')
    expect(log).toContain('moduleOnResponse')
  })
})

// ── Test 7 — Plugin install() exactly once ────────────────────────────────────
//
// Invariant: plugin.install() is called exactly once regardless of how many
// concurrent requests hit the module before install completes.
//
// The "optimistic add before await" pattern (Spec 07) guarantees:
//   - .add(name) is synchronous before the first await inside install()
//   - Subsequent concurrent requests see .has(name) = true and skip install()
//   - install() is idempotent — never called twice
//
// Note: request() may run concurrently with install() for parallel requests
// during the install window — that is expected and correct behavior.

describe('Test 7 — Plugin install() runs exactly once', () => {
  test('install called once across 10 parallel requests, request called per-request', async () => {
    let installCount = 0
    let requestCount = 0

    const trackedPlugin = definePlugin<{ _installed: true }>('tracked-install-t7')
      .build({
        install: async () => {
          installCount++
          // Async delay — the yield point where concurrent requests could re-enter
          await new Promise<void>((resolve) => setTimeout(resolve, 5))
        },
        request: (_ctx: BaseCtx) => {
          requestCount++
          return { _installed: true as const }
        },
      })

    const mod = defineModule('/install-order')
      .plugin(trackedPlugin)
      .get('/ping', { handler: (ctx) => ctx.json({ ok: true }) })
      .build()

    const app = createApp()
    app.register(mod)

    // 10 parallel requests — install() must still run exactly once
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.fetch(new Request('http://localhost/install-order/ping')),
      ),
    )

    // All requests must succeed
    for (const res of responses) {
      expect(res.status).toBe(200)
    }

    // install() exactly once — the core invariant
    expect(installCount).toBe(1)
    // request() runs per-request — 10 times
    expect(requestCount).toBe(10)
  })
})
