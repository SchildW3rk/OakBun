import { describe, test, expect } from 'bun:test'
import { createApp, dbPlugin, EventBus, eventBusPlugin } from '../../packages/core/src/index'
import { SQLiteAdapter, toCreateTableSql, defineTable, column } from '../../packages/core/src/index'

// ── Minimal test table ────────────────────────────────────────────────────────

const usersTable = defineTable('emit_users', {
  id:   column.integer().primaryKey(),
  name: column.text(),
}).build()

// ── 1. ctx.emit() lands in RequestEventQueue and is received ──────────────────

describe('ctx.emit() — event lands in queue', () => {
  test('emitted event is received by app.on subscriber after response', async () => {
    const received: unknown[] = []

    const app = createApp()
    app.on('user.created', (payload) => { received.push(payload) })

    app.get('/test', (ctx) => {
      ctx.emit('user.created', { id: 1, name: 'Alice' } as never)
      return ctx.json({ ok: true })
    })

    const res = await app.fetch(new Request('http://localhost/test'))
    expect(res.status).toBe(200)

    await new Promise((r) => setTimeout(r, 20))
    expect(received).toHaveLength(1)
    expect((received[0] as { name: string }).name).toBe('Alice')
  })

  test('queue is flushed after response — handler runs first', async () => {
    const order: string[] = []

    const app = createApp()
    app.on('order.check', () => { order.push('event') })

    app.get('/seq', (ctx) => {
      ctx.emit('order.check', undefined as never)
      order.push('handler')
      return ctx.json({ ok: true })
    })

    await app.fetch(new Request('http://localhost/seq'))
    await new Promise((r) => setTimeout(r, 20))

    expect(order[0]).toBe('handler')
    expect(order[1]).toBe('event')
  })
})

// ── 2. ctx.emit() is always present on BaseCtx ────────────────────────────────

describe('ctx.emit() — always present on ctx', () => {
  test('emit is a function on BaseCtx without any plugins', async () => {
    let emitType = ''

    const app = createApp()
    app.get('/emit-check', (ctx) => {
      emitType = typeof ctx.emit
      return ctx.json({ ok: true })
    })

    await app.fetch(new Request('http://localhost/emit-check'))
    expect(emitType).toBe('function')
  })

  test('calling emit with no subscribers does not throw', async () => {
    const app = createApp()
    app.get('/no-sub', (ctx) => {
      ctx.emit('user.created', { id: 1, name: 'X' } as never)
      return ctx.json({ ok: true })
    })

    const res = await app.fetch(new Request('http://localhost/no-sub'))
    expect(res.status).toBe(200)
  })
})

// ── 3. Queue is discarded on handler error ────────────────────────────────────

describe('ctx.emit() — queue discarded on handler error', () => {
  test('event is NOT fired when handler throws', async () => {
    const received: unknown[] = []

    const app = createApp()
    app.on('should.not.fire', (p) => { received.push(p) })
    app.get('/err', (ctx) => {
      ctx.emit('should.not.fire', undefined as never)
      throw new Error('boom')
    })

    await app.fetch(new Request('http://localhost/err'))
    await new Promise((r) => setTimeout(r, 20))

    expect(received).toHaveLength(0)
  })
})

// ── 4. Multiple emits per request ─────────────────────────────────────────────

describe('ctx.emit() — multiple emits accumulate', () => {
  test('two emits produce two events', async () => {
    const received: string[] = []

    const app = createApp()
    app.on('ping', (p) => { received.push((p as { msg: string }).msg) })

    app.get('/multi', (ctx) => {
      ctx.emit('ping', { msg: 'first' } as never)
      ctx.emit('ping', { msg: 'second' } as never)
      return ctx.json({ ok: true })
    })

    await app.fetch(new Request('http://localhost/multi'))
    await new Promise((r) => setTimeout(r, 20))

    expect(received).toHaveLength(2)
    expect(received).toContain('first')
    expect(received).toContain('second')
  })
})

// ── 5. Error in subscriber — response unaffected ──────────────────────────────

describe('ctx.emit() — subscriber error does not affect response', () => {
  test('throwing subscriber does not break the response', async () => {
    const originalError = console.error
    console.error = () => {}
    const app = createApp()
    app.on('bad.event', () => { throw new Error('subscriber fail') })
    app.get('/bad-sub', (ctx) => {
      ctx.emit('bad.event', undefined as never)
      return ctx.json({ ok: true }, 200)
    })

    const res = await app.fetch(new Request('http://localhost/bad-sub'))
    await new Promise((r) => setTimeout(r, 20))
    console.error = originalError
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

// ── 6. ctx.emit() coexists with table auto-events ─────────────────────────────

describe('ctx.emit() — coexists with table auto-events', () => {
  test('manual ctx.emit fires alongside DB events', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))

    const fired: string[] = []

    const app = createApp().plugin(dbPlugin(adapter))
    app.on('manual.event', () => { fired.push('manual') })

    app.post('/emit-db', async (ctx) => {
      await ctx.db!.into(usersTable).insert({ name: 'test' })
      ctx.emit('manual.event', undefined as never)
      return ctx.json({ ok: true }, 201)
    })

    const res = await app.fetch(new Request('http://localhost/emit-db', { method: 'POST' }))
    expect(res.status).toBe(201)
    await new Promise((r) => setTimeout(r, 20))
    expect(fired).toContain('manual')
  })
})

// ── 7. ctx.emit() via eventBusPlugin bus ─────────────────────────────────────
// eventBusPlugin adds ctx.events — the external bus. ctx.emit uses the internal
// app eventBus. They are separate. This test confirms ctx.emit does NOT fire
// on the external plugin bus.

describe('ctx.emit() — uses internal app EventBus, not plugin bus', () => {
  test('emit goes to app.on(), not to eventBusPlugin bus', async () => {
    const externalFired: string[] = []
    const internalFired: string[] = []

    const bus = new EventBus()
    bus.on('my.event', () => { externalFired.push('external') })

    const app = createApp().plugin(eventBusPlugin(bus))
    app.on('my.event', () => { internalFired.push('internal') })

    app.get('/split', (ctx) => {
      ctx.emit('my.event', undefined as never)
      return ctx.json({ ok: true })
    })

    await app.fetch(new Request('http://localhost/split'))
    await new Promise((r) => setTimeout(r, 20))

    expect(internalFired).toContain('internal')
    expect(externalFired).toHaveLength(0)
  })
})
