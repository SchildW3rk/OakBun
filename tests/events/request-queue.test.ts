import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { dbPlugin, loggerPlugin } from '../../packages/core/src/app/plugin'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'
import { RequestEventQueue, EventBus } from '../../packages/core/src/events/index'
import { createOnRequest } from '../../packages/core/src/app/types'

// Shared table with event mapping
const usersTable = defineTable('rq_users', {
  id:    column.integer().primaryKey(),
  name:  column.text(),
  email: column.text(),
})
  .emits({
    afterInsert: 'user.created',
    afterUpdate: 'user.updated',
    afterDelete: 'user.deleted',
  })
  .build()

describe('RequestEventQueue — per-request event buffering', () => {

  test('Non-TX insert: event fires after response, not during handler', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))
    const app = createApp().plugin(loggerPlugin())
    app.plugin(dbPlugin(adapter, app.hooks))

    const firedDuringHandler = { value: false }
    const firedAfterResponse = { value: false }

    app.on('user.created', () => {
      firedAfterResponse.value = true
    })

    app.post('/users', async (ctx) => {
      const body = await ctx.req.json() as { name: string; email: string }
      await ctx.db!.into(usersTable).insert(body)
      // At this point handler is still running — event must NOT have fired yet
      firedDuringHandler.value = firedAfterResponse.value
      return ctx.json({ ok: true }, 201)
    })

    const res = await app.fetch(new Request('http://localhost/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'alice@test.com' }),
    }))
    expect(res.status).toBe(201)

    // Event fires after fetch() returns (fire & forget async)
    await new Promise((r) => setTimeout(r, 30))

    expect(firedDuringHandler.value).toBe(false)  // NOT fired during handler
    expect(firedAfterResponse.value).toBe(true)   // fired after response
  })

  test('Multiple events in one request: all flushed in order', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))
    const app = createApp().plugin(loggerPlugin())
    app.plugin(dbPlugin(adapter, app.hooks))

    const events: string[] = []
    app.on('user.created', () => events.push('created'))
    app.on('user.updated', () => events.push('updated'))

    let insertedId = 0
    app.post('/batch', async (ctx) => {
      const user = await ctx.db!.into(usersTable).insert({ name: 'Bob', email: 'bob@test.com' })
      insertedId = user.id
      await ctx.db!.from(usersTable).where({ id: insertedId as any }).update({ name: 'Bob Updated' })
      return ctx.json({ ok: true })
    })

    await app.fetch(new Request('http://localhost/batch', { method: 'POST' }))
    await new Promise((r) => setTimeout(r, 30))

    // Both events fired, in order
    expect(events).toEqual(['created', 'updated'])
  })

  test('Handler throws: events NOT flushed', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))
    const app = createApp().plugin(loggerPlugin())
    app.plugin(dbPlugin(adapter, app.hooks))
    app.onError((_err, ctx) => ctx.json({ error: true }, 500))

    let eventFired = false
    app.on('user.created', () => { eventFired = true })

    app.post('/fail', async (ctx) => {
      await ctx.db!.into(usersTable).insert({ name: 'Fail', email: 'fail@test.com' })
      throw new Error('handler error after insert')
    })

    const res = await app.fetch(new Request('http://localhost/fail', { method: 'POST' }))
    expect(res.status).toBe(500)
    await new Promise((r) => setTimeout(r, 30))

    expect(eventFired).toBe(false)  // queue was discarded on error
  })

  test('Guard blocks: events NOT flushed', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))
    const app = createApp().plugin(loggerPlugin())
    app.plugin(dbPlugin(adapter, app.hooks))

    let eventFired = false
    app.on('user.created', () => { eventFired = true })

    const mod = defineModule('')
      .guard((_ctx) => new Response('Unauthorized', { status: 401 }))
      .post('/guarded', async (ctx) => {
        await ctx.db!.into(usersTable).insert({ name: 'Guarded', email: 'g@test.com' })
        return ctx.json({ ok: true })
      })
      .build()
    app.register(mod)

    const res = await app.fetch(new Request('http://localhost/guarded', { method: 'POST' }))
    expect(res.status).toBe(401)
    await new Promise((r) => setTimeout(r, 30))

    expect(eventFired).toBe(false)
  })

  test('onRequest returns early: events NOT flushed (no handler ran)', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))
    const app = createApp().plugin(loggerPlugin())
    app.plugin(dbPlugin(adapter, app.hooks))

    let eventFired = false
    app.on('user.created', () => { eventFired = true })

    // onRequest short-circuits with a Response — handler never runs, no DB ops, no events
    app.onRequest(createOnRequest((_ctx) => new Response('blocked', { status: 403 })))

    app.post('/blocked', async (ctx) => {
      await ctx.db!.into(usersTable).insert({ name: 'X', email: 'x@test.com' })
      return ctx.json({ ok: true })
    })

    const res = await app.fetch(new Request('http://localhost/blocked', { method: 'POST' }))
    expect(res.status).toBe(403)
    await new Promise((r) => setTimeout(r, 30))

    expect(eventFired).toBe(false)
  })

})

describe('RequestEventQueue — unit', () => {

  test('collect() buffers events', () => {
    const queue = new RequestEventQueue()
    queue.collect('a', { x: 1 })
    queue.collect('b', { x: 2 })
    expect(queue.size).toBe(2)
  })

  test('flush() emits to bus and clears buffer', async () => {
    const bus = new EventBus()
    const received: unknown[] = []
    bus.on('a', (p) => received.push(p))

    const queue = new RequestEventQueue()
    queue.collect('a', { x: 1 })
    queue.collect('a', { x: 2 })

    await queue.flush({}, bus)
    await new Promise((r) => setTimeout(r, 20))

    expect(received.length).toBe(2)
    expect(queue.size).toBe(0)
  })

  test('drain() returns events and clears buffer', () => {
    const queue = new RequestEventQueue()
    queue.collect('x', 1)
    queue.collect('y', 2)

    const drained = queue.drain()
    expect(drained).toEqual([{ name: 'x', payload: 1 }, { name: 'y', payload: 2 }])
    expect(queue.size).toBe(0)
  })

  test('TX path: events returned in TransactionResult, not fired during TX', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))
    const app = createApp().plugin(loggerPlugin())
    app.plugin(dbPlugin(adapter, app.hooks))

    let txCompleted = false
    let eventFiredBeforeTxComplete = false

    app.on('user.created', () => {
      if (!txCompleted) eventFiredBeforeTxComplete = true
    })

    app.post('/tx', async (ctx) => {
      const { result: _user, events } = await ctx.db!.transaction(async (tx) => {
        const u = await tx.into(usersTable).insert({ name: 'TX User', email: 'tx@test.com' })
        txCompleted = true
        return u
      })
      // TX events buffered in TransactionResult, not in request queue
      expect(events.length).toBe(1)
      expect(events[0]!.name).toBe('user.created')
      return ctx.json({ ok: true })
    })

    await app.fetch(new Request('http://localhost/tx', { method: 'POST' }))
    await new Promise((r) => setTimeout(r, 30))

    // TX events are not flushed automatically — caller controls when/if they flush
    expect(eventFiredBeforeTxComplete).toBe(false)
  })

})
