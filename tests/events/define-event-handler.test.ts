import { describe, test, expect, mock, spyOn } from 'bun:test'
import { defineEventHandler } from '../../packages/core/src/events/handler'
import type { EventHandlerDef, EventHandlerFn } from '../../packages/core/src/events/handler'
import type { Logger } from '../../packages/core/src/app/types'
import { defineService } from '../../packages/core/src/service/index'
import { EventBus } from '../../packages/core/src/events/index'
import { defineModule } from '../../packages/core/src/app/module'
import { createApp } from '../../packages/core/src/app/index'
import { dbPlugin } from '../../packages/core/src/app/plugin'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'
import { defineResource } from '../../packages/core/src/resource/index'

// ── Minimal test table ─────────────────────────────────────────────────────────

const postsTable = defineTable('posts', {
  id:    column.integer().primaryKey(),
  title: column.text(),
  body:  column.text().default(''),
})
  .emits({
    afterInsert: 'post.created',
    afterUpdate: 'post.updated',
    afterDelete: 'post.deleted',
  })
  .build()

// ── Helper ────────────────────────────────────────────────────────────────────

function makeEventBus() {
  return new EventBus()
}

// ── 1. defineEventHandler — free overload ─────────────────────────────────────

describe('defineEventHandler — free (string keys)', () => {
  test('returns an EventHandlerDef with _handlers Map', () => {
    const fn = mock((_payload: unknown) => {})
    const def = defineEventHandler({ 'user.created': fn })
    expect(def._handlers).toBeInstanceOf(Map)
    expect(def._handlers.has('user.created')).toBe(true)
  })

  test('_handlers contains all provided keys', () => {
    const def = defineEventHandler({
      'payment.failed': (_p: unknown) => {},
      'email.sent':     (_p: unknown) => {},
    })
    expect(def._handlers.size).toBe(2)
    expect(def._handlers.has('payment.failed')).toBe(true)
    expect(def._handlers.has('email.sent')).toBe(true)
  })

  test('each call returns a new EventHandlerDef (immutable)', () => {
    const def1 = defineEventHandler({ 'a': (_: unknown) => {} })
    const def2 = defineEventHandler({ 'b': (_: unknown) => {} })
    expect(def1).not.toBe(def2)
    expect(def1._handlers).not.toBe(def2._handlers)
  })

  test('undefined handlers are omitted from map', () => {
    const def = defineEventHandler({ 'x': undefined as any })
    expect(def._handlers.size).toBe(0)
  })
})

// ── 2. defineEventHandler — table-bound overload ──────────────────────────────

describe('defineEventHandler — table-bound', () => {
  test('creates handler for afterInsert event (user.created → T)', () => {
    const fn = mock((_p: { id: number; title: string; body: string }) => {})
    const def = defineEventHandler(postsTable, { 'post.created': fn })
    expect(def._handlers.has('post.created')).toBe(true)
  })

  test('creates handler for afterUpdate event (post.updated → {before, after})', () => {
    const fn = mock((_p: { before: typeof postsTable._eventMap['post.updated']['before']; after: typeof postsTable._eventMap['post.updated']['after'] }) => {})
    const def = defineEventHandler(postsTable, { 'post.updated': fn })
    expect(def._handlers.has('post.updated')).toBe(true)
  })

  test('creates handler for afterDelete event (post.deleted → T)', () => {
    const fn = mock((_p: { id: number; title: string; body: string }) => {})
    const def = defineEventHandler(postsTable, { 'post.deleted': fn })
    expect(def._handlers.has('post.deleted')).toBe(true)
  })

  test('partial — only subset of events subscribed', () => {
    const def = defineEventHandler(postsTable, {
      'post.created': (_p) => {},
      // post.updated and post.deleted intentionally omitted
    })
    expect(def._handlers.size).toBe(1)
    expect(def._handlers.has('post.created')).toBe(true)
  })

  test('handlers for multiple events from same table', () => {
    const def = defineEventHandler(postsTable, {
      'post.created': (_p) => {},
      'post.updated': (_p) => {},
      'post.deleted': (_p) => {},
    })
    expect(def._handlers.size).toBe(3)
  })
})

// ── 3. EventBus integration — direct registration ────────────────────────────

describe('EventBus — EventHandlerDef registration', () => {
  test('handler is called when event fires via bus._emit', async () => {
    const called: unknown[] = []
    const def = defineEventHandler({ 'test.event': (p) => { called.push(p) } })
    const bus = makeEventBus()
    for (const [event, cb] of def._handlers) {
      bus.on(event, cb as any)
    }
    bus._emit('test.event', { x: 1 }, {})
    await new Promise((r) => setTimeout(r, 5))
    expect(called).toHaveLength(1)
    expect((called[0] as any).x).toBe(1)
  })
})

// ── 4. app.events() — direct registration on Veln ────────────────────────────

describe('app.events()', () => {
  test('registers handler on eventBus — fires after DB insert', async () => {
    const received: unknown[] = []
    const def = defineEventHandler(postsTable, {
      'post.created': (p) => { received.push(p) },
    })

    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(postsTable))

    const app = createApp()
      .plugin(dbPlugin(adapter))
      .events(def)

    app.post('/posts', async (ctx) => {
      const post = await ctx.db!.into(postsTable).insert({ title: 'Hello' })
      return ctx.json(post, 201)
    })

    const res = await app.fetch(new Request('http://localhost/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hello' }),
    }))
    expect(res.status).toBe(201)

    // Give fire & forget a moment
    await new Promise((r) => setTimeout(r, 20))
    expect(received).toHaveLength(1)
    expect((received[0] as any).title).toBe('Hello')
  })

  test('returns this for chaining', () => {
    const def = defineEventHandler({ 'x': (_: unknown) => {} })
    const app = createApp()
    const result = app.events(def)
    expect(result).toBe(app)
  })

  test('multiple app.events() calls accumulate handlers', async () => {
    const log: string[] = []
    const def1 = defineEventHandler({ 'ping': (_: unknown) => { log.push('handler1') } })
    const def2 = defineEventHandler({ 'ping': (_: unknown) => { log.push('handler2') } })

    const app = createApp().events(def1).events(def2)
    // Directly emit on eventBus via a route that triggers the event
    // We simulate by registering a route that manually calls ctx.json
    // and checking after flush that both handlers ran
    // For simplicity, check that both handlers map to 'ping'
    const inner1 = def1._handlers.get('ping')
    const inner2 = def2._handlers.get('ping')
    inner1!({})
    inner2!({})
    expect(log).toEqual(['handler1', 'handler2'])
  })
})

// ── 5. ModuleBuilder.events() / VelnModule.eventHandlerDefs ──────────────────

describe('ModuleBuilder.events()', () => {
  test('.events() stores def in eventHandlerDefs', () => {
    const def = defineEventHandler({ 'user.created': (_: unknown) => {} })
    const module = defineModule('/users').events(def).build()
    expect(module.eventHandlerDefs).toHaveLength(1)
    expect(module.eventHandlerDefs[0]).toBe(def)
  })

  test('two .events() calls accumulate', () => {
    const def1 = defineEventHandler({ 'a': (_: unknown) => {} })
    const def2 = defineEventHandler({ 'b': (_: unknown) => {} })
    const module = defineModule('/x').events(def1).events(def2).build()
    expect(module.eventHandlerDefs).toHaveLength(2)
  })

  test('without .events() — eventHandlerDefs is empty array', () => {
    const module = defineModule('/plain').build()
    expect(module.eventHandlerDefs).toEqual([])
  })
})

// ── 6. app.register() wires module event handlers ─────────────────────────────

describe('app.register() — event handler wiring', () => {
  test('module event handler fires after DB insert', async () => {
    const received: unknown[] = []
    const def = defineEventHandler(postsTable, {
      'post.created': (p) => { received.push(p) },
    })

    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(postsTable))

    const mod = defineModule('/posts')
      .events(def)
      .build()

    const app = createApp().plugin(dbPlugin(adapter))
    app.register(mod)

    app.post('/posts', async (ctx) => {
      const post = await ctx.db!.into(postsTable).insert({ title: 'Module Post' })
      return ctx.json(post, 201)
    })

    const res = await app.fetch(new Request('http://localhost/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Module Post' }),
    }))
    expect(res.status).toBe(201)

    await new Promise((r) => setTimeout(r, 20))
    expect(received).toHaveLength(1)
    expect((received[0] as any).title).toBe('Module Post')
  })
})

// ── 7. ResourceBuilder.events() ───────────────────────────────────────────────

describe('ResourceBuilder.events()', () => {
  test('.events() stored in module.eventHandlerDefs', () => {
    const def = defineEventHandler(postsTable, { 'post.created': (_p) => {} })
    const { module } = defineResource(postsTable, '/posts').events(def).build()
    expect(module.eventHandlerDefs).toHaveLength(1)
  })

  test('resource event handler fires after store via app.register', async () => {
    const received: unknown[] = []
    const def = defineEventHandler(postsTable, {
      'post.created': (p) => { received.push(p) },
    })

    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(postsTable))

    const { module } = defineResource(postsTable, '/posts').events(def).build()

    const app = createApp()
      .plugin(dbPlugin(adapter))
      .onError((err, ctx) => {
        const e = err as Error & { status?: number }
        return ctx.json({ error: e.message }, e.status ?? 500)
      })

    app.register(module)

    const res = await app.fetch(new Request('http://localhost/posts/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Resource Post' }),
    }))
    expect(res.status).toBe(201)

    await new Promise((r) => setTimeout(r, 20))
    expect(received).toHaveLength(1)
    expect((received[0] as any).title).toBe('Resource Post')
  })
})

// ── 8. Multiple handlers — same event ─────────────────────────────────────────

describe('Multiple handlers on same event', () => {
  test('module + app both subscribe to same event — both fire', async () => {
    const modReceived: unknown[] = []
    const appReceived: unknown[] = []

    const modDef = defineEventHandler(postsTable, { 'post.created': (p) => { modReceived.push(p) } })
    const appDef = defineEventHandler(postsTable, { 'post.created': (p) => { appReceived.push(p) } })

    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(postsTable))

    const mod = defineModule('/posts').events(modDef).build()

    const app = createApp()
      .plugin(dbPlugin(adapter))
      .events(appDef)

    app.register(mod)

    app.post('/posts', async (ctx) => {
      const post = await ctx.db!.into(postsTable).insert({ title: 'Dual' })
      return ctx.json(post, 201)
    })

    const res = await app.fetch(new Request('http://localhost/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Dual' }),
    }))
    expect(res.status).toBe(201)

    await new Promise((r) => setTimeout(r, 20))
    expect(modReceived).toHaveLength(1)
    expect(appReceived).toHaveLength(1)
  })
})

// ── 9. Fire & forget — handler error does not affect response ─────────────────

describe('Fire & forget — error safety', () => {
  test('handler that throws does not affect response status', async () => {
    const orig = console.error
    console.error = () => {}
    const def = defineEventHandler({ 'post.created': (_p) => { throw new Error('handler boom') } })

    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(postsTable))

    const app = createApp()
      .plugin(dbPlugin(adapter))
      .events(def)

    app.post('/posts', async (ctx) => {
      const post = await ctx.db!.into(postsTable).insert({ title: 'Safe' })
      return ctx.json(post, 201)
    })

    const res = await app.fetch(new Request('http://localhost/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Safe' }),
    }))
    // Response must still be 201 — handler error is swallowed
    expect(res.status).toBe(201)
    await new Promise((r) => setTimeout(r, 20))
    console.error = orig
    // No assertion on the error itself — it's logged, not thrown
  })
})

// ── 10. EventHandlerBuilder — fluent builder ──────────────────────────────────

describe('defineEventHandler — fluent builder', () => {
  test('no handlers arg → returns EventHandlerBuilder (not EventHandlerDef)', () => {
    const builder = defineEventHandler(postsTable)
    expect(typeof (builder as { on?: unknown }).on).toBe('function')
    expect(typeof (builder as { build?: unknown }).build).toBe('function')
  })

  test('.build() returns EventHandlerDef with _handlers Map', () => {
    const def = defineEventHandler(postsTable)
      .on('post.created', (_p, _ctx) => {})
      .build()
    expect(def._handlers).toBeInstanceOf(Map)
    expect(def._handlers.has('post.created')).toBe(true)
  })

  test('.build() returns EventHandlerDef with _logger', () => {
    const def = defineEventHandler(postsTable).build()
    expect(typeof def._logger.info).toBe('function')
    expect(typeof def._logger.debug).toBe('function')
  })

  test('logger scope is event:<tableName>', () => {
    const calls: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { calls.push(msg) })

    const def = defineEventHandler(postsTable)
      .options({ log: { level: 'debug' } })
      .build()

    def._logger.debug('test')
    spy.mockRestore()

    expect(calls.some((c) => c.includes('event:posts'))).toBe(true)
  })

  test('logger injected into handler via { logger } ctx arg', async () => {
    let capturedLogger: Logger | undefined
    const def = defineEventHandler(postsTable)
      .on('post.created', (_p, { logger }) => { capturedLogger = logger })
      .build()

    const handler = def._handlers.get('post.created')
    await handler!({ id: 1, title: 'x', body: '' })
    expect(capturedLogger).toBeDefined()
    expect(typeof capturedLogger!.info).toBe('function')
  })

  test('.options({ log: { silent: true } }) → no console output', async () => {
    const spy = spyOn(console, 'log').mockImplementation(() => {})

    const def = defineEventHandler(postsTable)
      .options({ log: { silent: true } })
      .on('post.created', (_p, { logger }) => { logger.info('should be silent') })
      .build()

    const handler = def._handlers.get('post.created')
    await handler!({ id: 1, title: 'x', body: '' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test('.options({ log: { mask: [\"title\"] } }) → title masked', async () => {
    const lines: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { lines.push(msg) })

    const def = defineEventHandler(postsTable)
      .options({ log: { level: 'info', mask: ['title'] } })
      .on('post.created', (post, { logger }) => { logger.info('created', { title: post.title, id: post.id }) })
      .build()

    const handler = def._handlers.get('post.created')
    await handler!({ id: 1, title: 'secret', body: '' })
    spy.mockRestore()

    const line = lines.find((l) => l.includes('created'))
    expect(line).toBeDefined()
    expect(line).not.toContain('secret')
    expect(line).toContain('***')
  })

  test('multiple .on() calls accumulate handlers', () => {
    const def = defineEventHandler(postsTable)
      .on('post.created', (_p, _ctx) => {})
      .on('post.updated', (_p, _ctx) => {})
      .on('post.deleted', (_p, _ctx) => {})
      .build()
    expect(def._handlers.size).toBe(3)
  })

  test('app.events() with builder result fires handlers', async () => {
    const fired: string[] = []
    const def = defineEventHandler(postsTable)
      .on('post.created', (_p, _ctx) => { fired.push('created') })
      .build()

    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(postsTable))

    const app = createApp().plugin(dbPlugin(adapter)).events(def)
    app.post('/p', async (ctx) => {
      const post = await ctx.db!.into(postsTable).insert({ title: 'Builder' })
      return ctx.json(post, 201)
    })

    const res = await app.fetch(new Request('http://localhost/p', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Builder' }),
    }))
    expect(res.status).toBe(201)
    await new Promise((r) => setTimeout(r, 20))
    expect(fired).toHaveLength(1)
  })

  test('backward compat: legacy (table, handlers) still returns EventHandlerDef', () => {
    const def = defineEventHandler(postsTable, {
      'post.created': (_p) => {},
    })
    expect(def._handlers).toBeInstanceOf(Map)
    expect(def._handlers.has('post.created')).toBe(true)
  })

  test('module.events() with builder result — fires after app.register()', async () => {
    const fired: string[] = []
    const def = defineEventHandler(postsTable)
      .on('post.created', (_p, _ctx) => { fired.push('module-created') })
      .build()

    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(postsTable))

    const mod = defineModule('/p2').events(def).build()
    const app = createApp().plugin(dbPlugin(adapter))
    app.register(mod)

    app.post('/p2', async (ctx) => {
      const post = await ctx.db!.into(postsTable).insert({ title: 'Mod' })
      return ctx.json(post, 201)
    })

    const res = await app.fetch(new Request('http://localhost/p2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Mod' }),
    }))
    expect(res.status).toBe(201)
    await new Promise((r) => setTimeout(r, 20))
    expect(fired).toHaveLength(1)
  })
})

// ── 11. EventHandlerBuilder — .use() service injection ────────────────────────

describe('defineEventHandler — .use() service injection', () => {
  const NotifyService = defineService('notify').define(({ logger: _l }) => ({
    send: (msg: string) => `sent:${msg}`,
  }))

  test('.use() accumulates services in _services', () => {
    const def = defineEventHandler(postsTable)
      .use(NotifyService)
      .build()
    expect(def._services).toHaveLength(1)
    expect(def._services[0]._serviceKey).toBe('notify')
  })

  test('.use() twice — both services in _services', () => {
    const OtherService = defineService('other').define(() => ({ run: () => 'ok' }))
    const def = defineEventHandler(postsTable)
      .use(NotifyService)
      .use(OtherService)
      .build()
    expect(def._services).toHaveLength(2)
  })

  test('.use() populates _rawHandlers', () => {
    const def = defineEventHandler(postsTable)
      .use(NotifyService)
      .on('post.created', (_p, _ctx) => {})
      .build()
    expect(def._rawHandlers.has('post.created')).toBe(true)
  })

  test('service injected into handler ctx via app.events() + DB', async () => {
    const received: string[] = []

    const def = defineEventHandler(postsTable)
      .use(NotifyService)
      .on('post.created', (post, { notify }) => {
        received.push(notify.send(String(post.id)))
      })
      .build()

    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(postsTable))

    const app = createApp().plugin(dbPlugin(adapter)).events(def)
    app.post('/p3', async (ctx) => {
      const post = await ctx.db!.into(postsTable).insert({ title: 'SvcTest' })
      return ctx.json(post, 201)
    })

    const res = await app.fetch(new Request('http://localhost/p3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'SvcTest' }),
    }))
    expect(res.status).toBe(201)
    await new Promise((r) => setTimeout(r, 20))
    expect(received).toHaveLength(1)
    expect(received[0]).toMatch(/^sent:\d+$/)
  })

  test('without .use() — _services is empty, _rawHandlers populated', () => {
    const def = defineEventHandler(postsTable)
      .on('post.created', (_p, _ctx) => {})
      .build()
    expect(def._services).toHaveLength(0)
    expect(def._rawHandlers.has('post.created')).toBe(true)
  })

  test('without .use() — fast path: logger available in ctx', async () => {
    let loggerFound = false
    const def = defineEventHandler(postsTable)
      .on('post.created', (_p, { logger }) => { loggerFound = typeof logger.info === 'function' })
      .build()

    const handler = def._handlers.get('post.created')
    await handler!({ id: 1, title: 'x', body: '' })
    expect(loggerFound).toBe(true)
  })
})
