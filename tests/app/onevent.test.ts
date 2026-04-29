import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { HookExecutor } from '../../packages/core/src/hooks/executor'
import { EventBus, RequestEventQueue } from '../../packages/core/src/events/index'
import { defineTable } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { OakBunDB } from '../../packages/core/src/db/index'
import { toCreateTableSql } from '../../packages/core/src/schema/table'

// ── onEvent() — typed Table overload ─────────────────────────

describe('onEvent() — typed Table overload', () => {
  test('onEvent fires when DB insert triggers afterInsert queue + flush', async () => {
    const postsTable = defineTable('posts_oe1', {
      id:    column.integer().primaryKey(),
      title: column.text(),
    })
      .emits({ afterInsert: 'post.created' })
      .build()

    const app = createApp()
    const eventBus = (app as any).eventBus as EventBus
    const executor = new HookExecutor()

    // Subscribe using onEvent typed overload
    const received: unknown[] = []
    app.onEvent(postsTable, 'post.created', (payload) => {
      received.push(payload)
    })

    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(postsTable))
    const db = new OakBunDB(adapter, executor)

    // Create a queue, bind it to the DB context, run insert, then flush
    const queue = new RequestEventQueue()
    const bound = db.withCtx({}, queue)
    const post = await bound.into(postsTable).insert({ title: 'Hello World' })
    expect(post.title).toBe('Hello World')

    // Before flush — nothing fired yet
    expect(received.length).toBe(0)

    // Flush — events fire now
    await queue.flush({}, eventBus)
    await new Promise((r) => setTimeout(r, 20))

    expect(received.length).toBe(1)
    expect((received[0] as any).title).toBe('Hello World')
  })

  test('onEvent afterUpdate — payload is { before, after }', async () => {
    const usersTable2 = defineTable('users_oe2', {
      id:   column.integer().primaryKey(),
      name: column.text(),
    })
      .emits({ afterUpdate: 'user.updated' })
      .build()

    const app = createApp()
    const eventBus = (app as any).eventBus as EventBus
    const executor = new HookExecutor()

    const received: Array<{ before: unknown; after: unknown }> = []
    app.onEvent(usersTable2, 'user.updated', (payload) => {
      received.push(payload as { before: unknown; after: unknown })
    })

    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable2))
    const db = new OakBunDB(adapter, executor)
    const queue = new RequestEventQueue()
    const bound = db.withCtx({}, queue)

    const user = await bound.into(usersTable2).insert({ name: 'Alice' })
    await bound.from(usersTable2).where({ id: user.id as any }).update({ name: 'Alice Updated' })

    // Only the update event was configured
    await queue.flush({}, eventBus)
    await new Promise((r) => setTimeout(r, 20))

    expect(received.length).toBe(1)
    expect((received[0].before as any).name).toBe('Alice')
    expect((received[0].after as any).name).toBe('Alice Updated')
  })

  test('on() string fallback still works', async () => {
    const app = createApp()
    const eventBus = (app as any).eventBus as EventBus

    const received: unknown[] = []
    app.on('custom.event', (payload) => {
      received.push(payload)
    })

    // Fire directly on the bus — still works unchanged
    eventBus._emit('custom.event', { data: 42 }, {})

    await new Promise((r) => setTimeout(r, 20))
    expect(received.length).toBe(1)
    expect((received[0] as any).data).toBe(42)
  })

  test('onEvent and on() coexist in same app', async () => {
    const itemsTable = defineTable('items_oe4', {
      id:   column.integer().primaryKey(),
      name: column.text(),
    })
      .emits({ afterInsert: 'item.created' })
      .build()

    const app = createApp()
    const eventBus = (app as any).eventBus as EventBus
    const executor = new HookExecutor()

    const typedReceived: unknown[] = []
    const stringReceived: unknown[] = []

    app.onEvent(itemsTable, 'item.created', (payload) => {
      typedReceived.push(payload)
    })

    app.on('app.ready', (payload) => {
      stringReceived.push(payload)
    })

    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))
    const db = new OakBunDB(adapter, executor)
    const queue = new RequestEventQueue()
    const bound = db.withCtx({}, queue)

    await bound.into(itemsTable).insert({ name: 'Widget' })
    eventBus._emit('app.ready', { version: '4a' }, {})

    await queue.flush({}, eventBus)
    await new Promise((r) => setTimeout(r, 20))

    expect(typedReceived.length).toBe(1)
    expect((typedReceived[0] as any).name).toBe('Widget')

    expect(stringReceived.length).toBe(1)
    expect((stringReceived[0] as any).version).toBe('4a')
  })
})
