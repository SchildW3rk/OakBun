import { describe, test, expect, mock, spyOn } from 'bun:test'
import { loggerPlugin, eventBusPlugin, dbPlugin } from '../../packages/core/src/app/plugin'
import { EventBus } from '../../packages/core/src/events/index'
import { HookExecutor } from '../../packages/core/src/hooks/executor'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { BoundVelnDB } from '../../packages/core/src/db/index'
import type { BaseCtx } from '../../packages/core/src/app/types'

function makeBaseCtx(overrides: Partial<BaseCtx> = {}): BaseCtx {
  return {
    req: new Request('http://localhost/'),
    params: {},
    query: {},
    json: (data, status = 200) => Response.json(data, { status }),
    text: (data, status = 200) => new Response(data, { status }),
    html: (data, status = 200) => new Response(data, { status }),
    ...overrides,
  }
}

describe('loggerPlugin', () => {
  test('adds ctx.logger with info/warn/error', () => {
    const plugin = loggerPlugin()
    const ctx = makeBaseCtx()
    const result = plugin.request(ctx)
    expect(result).toHaveProperty('logger')
    expect(typeof (result as any).logger.info).toBe('function')
    expect(typeof (result as any).logger.warn).toBe('function')
    expect(typeof (result as any).logger.error).toBe('function')
  })

  test('logger.info calls console.log', () => {
    const plugin = loggerPlugin()
    const ctx = makeBaseCtx()
    const result = plugin.request(ctx) as any

    const spy = spyOn(console, 'log').mockImplementation(() => {})
    result.logger.info('test message', 'extra')
    expect(spy).toHaveBeenCalled()
    const args = spy.mock.calls[0] as unknown[]
    expect((args[0] as string)).toContain('test message')
    spy.mockRestore()
  })

  test('plugin has name "logger"', () => {
    expect(loggerPlugin().name).toBe('logger')
  })
})

describe('eventBusPlugin', () => {
  test('adds ctx.events as EventBus instance', () => {
    const bus = new EventBus()
    const plugin = eventBusPlugin(bus)
    const ctx = makeBaseCtx()
    const result = plugin.request(ctx) as any
    expect(result.events).toBe(bus)
    expect(result.events).toBeInstanceOf(EventBus)
  })

  test('plugin has name "eventBus"', () => {
    const bus = new EventBus()
    expect(eventBusPlugin(bus).name).toBe('eventBus')
  })
})

describe('dbPlugin', () => {
  test('adds ctx.db as BoundVelnDB', () => {
    const adapter = new SQLiteAdapter()
    const plugin = dbPlugin(adapter)
    plugin.install!(new HookExecutor())
    const ctx = makeBaseCtx()
    const result = plugin.request(ctx) as any
    expect(result.db).toBeInstanceOf(BoundVelnDB)
  })

  test('ctx.db is scoped to the request ctx (withCtx called with full ctx)', () => {
    const adapter = new SQLiteAdapter()
    const plugin = dbPlugin(adapter)
    plugin.install!(new HookExecutor())

    // First add eventBusPlugin so ctx has events
    const bus = new EventBus()
    const eventPlugin = eventBusPlugin(bus)
    let ctx: any = makeBaseCtx()
    ctx = eventPlugin.request(ctx)

    const result = plugin.request(ctx) as any
    expect(result.db).toBeInstanceOf(BoundVelnDB)
    // The db is scoped — ctx.events should still be on the enriched ctx
    expect(result.events).toBe(bus)
  })

  test('plugin has name "db"', () => {
    const adapter = new SQLiteAdapter()
    expect(dbPlugin(adapter).name).toBe('db')
  })
})

describe('Plugin ordering', () => {
  test('second plugin sees result of first plugin', () => {
    const plugin1 = loggerPlugin()
    const bus = new EventBus()
    const plugin2 = eventBusPlugin(bus)

    let ctx: any = makeBaseCtx()
    ctx = plugin1.request(ctx)
    ctx = plugin2.request(ctx)

    // ctx should have both logger and events
    expect(ctx.logger).toBeDefined()
    expect(ctx.events).toBe(bus)
  })

  test('dbPlugin after eventBusPlugin — ctx.db can see ctx.events', () => {
    const bus = new EventBus()
    const adapter = new SQLiteAdapter()
    const db = dbPlugin(adapter)
    db.install!(new HookExecutor())

    let ctx: any = makeBaseCtx()
    ctx = eventBusPlugin(bus).request(ctx)
    ctx = db.request(ctx)

    // ctx.db is BoundVelnDB, and ctx.events is available
    expect(ctx.db).toBeInstanceOf(BoundVelnDB)
    expect(ctx.events).toBe(bus)
  })
})

// ── Plugin dependency validation (requires) ───────────────────────────────────

import { createApp } from '../../packages/core/src/app/index'
import { VelnError } from '../../packages/core/src/errors/index'

describe('plugin — requires dependency validation', () => {
  function makePlugin(name: string, requires?: string[]) {
    return {
      name,
      requires,
      request: (ctx: BaseCtx) => ({ ...ctx }),
    }
  }

  test('plugin without requires — always registers successfully', () => {
    const app = createApp()
    expect(() => app.plugin(makePlugin('standalone'))).not.toThrow()
  })

  test('plugin with empty requires array — always registers successfully', () => {
    const app = createApp()
    expect(() => app.plugin(makePlugin('standalone', []))).not.toThrow()
  })

  test('plugin with satisfied requires — registers successfully', () => {
    const app = createApp()
    app.plugin(makePlugin('alpha'))
    expect(() => app.plugin(makePlugin('beta', ['alpha']))).not.toThrow()
  })

  test('plugin with unsatisfied requires — throws PLUGIN_MISSING_DEP', () => {
    const app = createApp()
    let caught: VelnError | null = null
    try {
      app.plugin(makePlugin('beta', ['alpha']))
    } catch (e) {
      caught = e as VelnError
    }
    expect(caught).not.toBeNull()
    expect(caught?.code).toBe('PLUGIN_MISSING_DEP')
  })

  test('PLUGIN_MISSING_DEP error message names both plugins', () => {
    const app = createApp()
    let caught: VelnError | null = null
    try {
      app.plugin(makePlugin('myPlugin', ['missingDep']))
    } catch (e) {
      caught = e as VelnError
    }
    expect(caught?.message).toContain('myPlugin')
    expect(caught?.message).toContain('missingDep')
  })

  test('multiple requires — all must be registered', () => {
    const app = createApp()
    app.plugin(makePlugin('a'))
    app.plugin(makePlugin('b'))
    expect(() => app.plugin(makePlugin('c', ['a', 'b']))).not.toThrow()
  })

  test('multiple requires — one missing → throws', () => {
    const app = createApp()
    app.plugin(makePlugin('a'))
    // 'b' is missing
    expect(() => app.plugin(makePlugin('c', ['a', 'b']))).toThrow(VelnError)
  })
})
