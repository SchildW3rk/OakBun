import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { HookExecutor } from '../../packages/core/src/hooks/executor'
import { defineTable } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'
import { EventBus, RequestEventQueue } from '../../packages/core/src/events/index'

type Doc = { id: number; title: string; owner: string; updatedAt?: Date }

const docs = defineTable('documents', {
  id:        column.integer().primaryKey(),
  title:     column.text(),
  owner:     column.text(),
  updatedAt: column.timestamp().nullable(),
}).build()

const mockCtx = { user: { id: 'u-1', role: 'admin' } }

let exec: HookExecutor

beforeEach(() => {
  exec = new HookExecutor()
})

describe('HookExecutor — beforeInsert', () => {
  // ── Happy path ────────────────────────────────────────────────

  test('returns data unchanged when no hooks registered', async () => {
    const data = { title: 'Hello' }
    const result = await exec.runBeforeInsert(docs, mockCtx, data)
    expect(result).toEqual(data)
  })

  test('table-level hook can transform data', async () => {
    const stamped = defineTable('documents', docs.schema)
      .hook({
        beforeInsert: (data) => ({ ...data, updatedAt: new Date('2025-01-01') })
      })
      .build()

    const result = await exec.runBeforeInsert(stamped, mockCtx, { title: 'X' })
    expect(result.updatedAt).toEqual(new Date('2025-01-01'))
  })

  test('module-level hook can transform data (has ctx)', async () => {
    exec.registerModuleHook<Doc, typeof mockCtx>('documents', {
      beforeInsert: (ctx, data) => ({ ...data, owner: ctx.user.id })
    })

    const result = await exec.runBeforeInsert(docs, mockCtx, { title: 'X' })
    expect(result.owner).toBe('u-1')
  })

  test('table-level runs BEFORE module-level', async () => {
    const order: string[] = []

    const t = defineTable('documents', docs.schema)
      .hook({ beforeInsert: (d) => { order.push('table'); return d } })
      .build()

    exec.registerModuleHook('documents', {
      beforeInsert: (_, d) => { order.push('module'); return d }
    })

    await exec.runBeforeInsert(t, mockCtx, { title: 'X' })
    expect(order).toEqual(['table', 'module'])
  })

  test('multiple module hooks run in registration order', async () => {
    const order: number[] = []
    exec.registerModuleHook('documents', { beforeInsert: (_, d) => { order.push(1); return d } })
    exec.registerModuleHook('documents', { beforeInsert: (_, d) => { order.push(2); return d } })
    exec.registerModuleHook('documents', { beforeInsert: (_, d) => { order.push(3); return d } })

    await exec.runBeforeInsert(docs, mockCtx, {})
    expect(order).toEqual([1, 2, 3])
  })

  test('async hooks are awaited in sequence', async () => {
    const order: number[] = []
    exec.registerModuleHook('documents', {
      beforeInsert: async (_, d) => {
        await new Promise(r => setTimeout(r, 10))
        order.push(1)
        return d
      }
    })
    exec.registerModuleHook('documents', {
      beforeInsert: async (_, d) => {
        order.push(2)
        return d
      }
    })

    await exec.runBeforeInsert(docs, mockCtx, {})
    expect(order).toEqual([1, 2])
  })

  // ── Unhappy path ──────────────────────────────────────────────

  test('throwing in table-level hook cancels operation', async () => {
    const t = defineTable('documents', docs.schema)
      .hook({ beforeInsert: () => { throw new Error('table hook blocked') } })
      .build()

    await expect(exec.runBeforeInsert(t, mockCtx, {})).rejects.toThrow('table hook blocked')
  })

  test('throwing in module-level hook cancels operation', async () => {
    exec.registerModuleHook('documents', {
      beforeInsert: () => { throw new Error('module hook blocked') }
    })
    await expect(exec.runBeforeInsert(docs, mockCtx, {})).rejects.toThrow('module hook blocked')
  })

  test('hooks for different tables do not interfere', async () => {
    const other = defineTable('other', { id: column.integer().primaryKey() }).build()
    exec.registerModuleHook('documents', {
      beforeInsert: (_, d) => ({ ...d, owner: 'injected' })
    })

    const result = await exec.runBeforeInsert(other, mockCtx, { id: 1 })
    expect((result as any).owner).toBeUndefined()
  })
})

describe('HookExecutor — beforeUpdate', () => {
  // ── Happy path ────────────────────────────────────────────────

  test('patch returned unchanged when no hooks', async () => {
    const current: Doc = { id: 1, title: 'Old', owner: 'u-1' }
    const patch = { title: 'New' }
    const result = await exec.runBeforeUpdate(docs, mockCtx, current, patch)
    expect(result).toEqual(patch)
  })

  test('module-level hook can enrich patch with current state', async () => {
    exec.registerModuleHook<Doc, typeof mockCtx>('documents', {
      beforeUpdate: (ctx, current, patch) => ({
        ...patch,
        updatedAt: new Date('2025-06-01'),
      })
    })

    const current: Doc = { id: 1, title: 'Old', owner: 'u-1' }
    const result = await exec.runBeforeUpdate(docs, mockCtx, current, { title: 'New' })
    expect(result.updatedAt).toEqual(new Date('2025-06-01'))
  })

  // ── Unhappy path ──────────────────────────────────────────────

  test('throwing in beforeUpdate cancels update', async () => {
    exec.registerModuleHook<Doc, typeof mockCtx>('documents', {
      beforeUpdate: (ctx, current) => {
        if (current.owner !== ctx.user.id) throw new Error('Not owner')
      }
    })

    const notMine: Doc = { id: 1, title: 'X', owner: 'u-other' }
    await expect(
      exec.runBeforeUpdate(docs, mockCtx, notMine, { title: 'Y' })
    ).rejects.toThrow('Not owner')
  })
})

describe('HookExecutor — beforeDelete', () => {
  // ── Happy path ────────────────────────────────────────────────

  test('runs without error when no hooks', async () => {
    const current: Doc = { id: 1, title: 'X', owner: 'u-1' }
    await expect(exec.runBeforeDelete(docs, mockCtx, current)).resolves.toBeUndefined()
  })

  // ── Unhappy path ──────────────────────────────────────────────

  test('throwing in beforeDelete cancels delete', async () => {
    exec.registerModuleHook<Doc, typeof mockCtx>('documents', {
      beforeDelete: (ctx, current) => {
        if (current.owner !== ctx.user.id) throw new Error('Cannot delete')
      }
    })

    const notMine: Doc = { id: 1, title: 'X', owner: 'u-other' }
    await expect(exec.runBeforeDelete(docs, mockCtx, notMine)).rejects.toThrow('Cannot delete')
  })
})

describe('HookExecutor — after hooks (side effects)', () => {
  // ── Happy path ────────────────────────────────────────────────

  test('afterInsert receives result and original input', async () => {
    let captured: { result: any; input: any } | null = null

    exec.registerModuleHook<Doc>('documents', {
      afterInsert: async (_, result, input) => {
        captured = { result, input }
      }
    })

    const result: Doc = { id: 1, title: 'Hello', owner: 'u-1' }
    const input = { title: 'Hello' }
    await exec.runAfterInsert(docs, mockCtx, result, input)

    expect(captured).not.toBeNull()
    expect(captured!.result.id).toBe(1)
    expect(captured!.input).toEqual(input)
  })

  test('afterUpdate receives result AND before snapshot', async () => {
    let snapshot: { after: any; before: any } | null = null

    exec.registerModuleHook<Doc>('documents', {
      afterUpdate: async (_, result, before) => {
        snapshot = { after: result, before }
      }
    })

    const before: Doc = { id: 1, title: 'Old', owner: 'u-1' }
    const after:  Doc  = { id: 1, title: 'New', owner: 'u-1' }
    await exec.runAfterUpdate(docs, mockCtx, after, before)

    expect(snapshot!.before.title).toBe('Old')
    expect(snapshot!.after.title).toBe('New')
  })

  test('afterDelete receives deleted entity', async () => {
    let deleted: Doc | null = null

    exec.registerModuleHook<Doc>('documents', {
      afterDelete: async (_, entity) => { deleted = entity }
    })

    const entity: Doc = { id: 5, title: 'Gone', owner: 'u-1' }
    await exec.runAfterDelete(docs, mockCtx, entity)
    expect(deleted).toEqual(entity)
  })

  test('multiple afterInsert hooks all run — none overwrites another', async () => {
    const fired: string[] = []
    exec.registerModuleHook('documents', { afterInsert: async () => { fired.push('audit') } })
    exec.registerModuleHook('documents', { afterInsert: async () => { fired.push('cache') } })
    exec.registerModuleHook('documents', { afterInsert: async () => { fired.push('event') } })

    await exec.runAfterInsert(docs, mockCtx, { id: 1, title: 'X', owner: 'u' }, {})
    expect(fired).toEqual(['audit', 'cache', 'event'])  // all fired, in order
  })

  // ── Unhappy path ──────────────────────────────────────────────

  test('afterInsert error propagates (caller decides how to handle)', async () => {
    exec.registerModuleHook('documents', {
      afterInsert: async () => { throw new Error('audit failed') }
    })

    await expect(
      exec.runAfterInsert(docs, mockCtx, { id: 1, title: 'X', owner: 'u' }, {})
    ).rejects.toThrow('audit failed')
  })
})

describe('HookExecutor — automatisches Event-Firing via RequestEventQueue', () => {
  const tableWithEvents = defineTable('documents', {
    id:        column.integer().primaryKey(),
    title:     column.text(),
    owner:     column.text(),
    updatedAt: column.timestamp().nullable(),
  })
    .emits({
      afterInsert: 'doc.created',
      afterUpdate: 'doc.updated',
      afterDelete: 'doc.deleted',
    })
    .build()

  const tableWithoutEvents = defineTable('documents', {
    id:        column.integer().primaryKey(),
    title:     column.text(),
    owner:     column.text(),
    updatedAt: column.timestamp().nullable(),
  }).build()

  test('afterInsert collects event in queue — flush emits to bus', async () => {
    const bus = new EventBus()
    const emitted: { event: string; payload: unknown }[] = []
    bus.on('doc.created', (payload) => emitted.push({ event: 'doc.created', payload }))

    const queue = new RequestEventQueue()
    const result: Doc = { id: 1, title: 'Hello', owner: 'u-1' }
    await exec.runAfterInsert(tableWithEvents, mockCtx, result, {}, queue)

    // Before flush — nothing fired yet
    expect(emitted).toHaveLength(0)
    expect(queue.size).toBe(1)

    await queue.flush(mockCtx, bus)
    await new Promise((r) => setTimeout(r, 10))

    expect(emitted).toHaveLength(1)
    expect(emitted[0]!.event).toBe('doc.created')
    expect(emitted[0]!.payload).toBe(result)
  })

  test('afterUpdate collects { before, after } in queue — flush emits to bus', async () => {
    const bus = new EventBus()
    const emitted: { event: string; payload: unknown }[] = []
    bus.on('doc.updated', (payload) => emitted.push({ event: 'doc.updated', payload }))

    const queue = new RequestEventQueue()
    const before: Doc = { id: 1, title: 'Old', owner: 'u-1' }
    const after:  Doc = { id: 1, title: 'New', owner: 'u-1' }
    await exec.runAfterUpdate(tableWithEvents, mockCtx, after, before, queue)

    expect(emitted).toHaveLength(0)

    await queue.flush(mockCtx, bus)
    await new Promise((r) => setTimeout(r, 10))

    expect(emitted).toHaveLength(1)
    expect(emitted[0]!.event).toBe('doc.updated')
    expect((emitted[0]!.payload as any).before).toBe(before)
    expect((emitted[0]!.payload as any).after).toBe(after)
  })

  test('afterDelete collects deleted entity in queue — flush emits to bus', async () => {
    const bus = new EventBus()
    const emitted: { event: string; payload: unknown }[] = []
    bus.on('doc.deleted', (payload) => emitted.push({ event: 'doc.deleted', payload }))

    const queue = new RequestEventQueue()
    const deleted: Doc = { id: 5, title: 'Gone', owner: 'u-1' }
    await exec.runAfterDelete(tableWithEvents, mockCtx, deleted, queue)

    expect(emitted).toHaveLength(0)

    await queue.flush(mockCtx, bus)
    await new Promise((r) => setTimeout(r, 10))

    expect(emitted).toHaveLength(1)
    expect(emitted[0]!.event).toBe('doc.deleted')
    expect(emitted[0]!.payload).toBe(deleted)
  })

  test('kein queue übergeben → kein Fehler (optional, event dropped)', async () => {
    const result: Doc = { id: 1, title: 'Hello', owner: 'u-1' }
    // No queue passed — event is silently dropped, no throw
    await expect(
      exec.runAfterInsert(tableWithEvents, mockCtx, result, {})
    ).resolves.toBeUndefined()
  })

  test('table ohne .emits() → queue bleibt leer', async () => {
    const queue = new RequestEventQueue()
    const result: Doc = { id: 1, title: 'Hello', owner: 'u-1' }
    await exec.runAfterInsert(tableWithoutEvents, mockCtx, result, {}, queue)
    expect(queue.size).toBe(0)
  })
})
