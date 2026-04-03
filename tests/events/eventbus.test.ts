import { describe, test, expect, mock } from 'bun:test'
import { EventBus } from '../../packages/core/src/events/index'
import type { PendingEvent } from '../../packages/core/src/db/index'

describe('EventBus — on/_emit', () => {
  test('on() registers subscriber', () => {
    const bus = new EventBus()
    const handler = mock(() => {})
    bus.on('test', handler)
    bus._emit('test', {}, {})
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('_emit() calls subscriber with payload and ctx', async () => {
    const bus = new EventBus()
    const received: { payload: unknown; ctx: unknown }[] = []
    bus.on('data', (payload, ctx) => {
      received.push({ payload, ctx })
    })

    const payload = { id: 42 }
    const ctx = { user: 'test' }
    bus._emit('data', payload, ctx)

    // give microtasks a chance to run
    await new Promise((r) => setTimeout(r, 10))
    expect(received).toHaveLength(1)
    expect(received[0]!.payload).toBe(payload)
    expect(received[0]!.ctx).toBe(ctx)
  })

  test('_emit() is fire & forget — does not throw when handler throws', () => {
    const bus = new EventBus()
    const orig = console.error
    console.error = () => {}
    bus.on('boom', () => { throw new Error('kaboom') })

    // Should not throw
    expect(() => bus._emit('boom', null, null)).not.toThrow()
    console.error = orig
  })

  test('_emit() logs error when handler throws (mock console.error)', async () => {
    const bus = new EventBus()
    const originalError = console.error
    const errors: unknown[] = []
    console.error = (...args: unknown[]) => errors.push(args)

    bus.on('failing', async () => { throw new Error('async fail') })
    bus._emit('failing', null, null)

    await new Promise((r) => setTimeout(r, 10))
    console.error = originalError

    expect(errors.length).toBeGreaterThan(0)
    const msg = (errors[0] as unknown[])[0] as string
    expect(msg).toContain('[EventBus]')
    expect(msg).toContain('"failing"')
  })

  test('multiple subscribers on same event — all called in order', async () => {
    const bus = new EventBus()
    const calls: number[] = []
    bus.on('multi', () => calls.push(1))
    bus.on('multi', () => calls.push(2))
    bus.on('multi', () => calls.push(3))

    bus._emit('multi', null, null)
    await new Promise((r) => setTimeout(r, 10))

    expect(calls).toEqual([1, 2, 3])
  })

  test('_emit() for unknown event — no error', () => {
    const bus = new EventBus()
    expect(() => bus._emit('nonexistent', null, null)).not.toThrow()
  })
})

describe('EventBus — flush', () => {
  test('flush() calls _emit for each PendingEvent', async () => {
    const bus = new EventBus()
    const received: { name: string; payload: unknown }[] = []

    bus.on('a', (payload) => received.push({ name: 'a', payload }))
    bus.on('b', (payload) => received.push({ name: 'b', payload }))

    const events: PendingEvent[] = [
      { name: 'a', payload: { x: 1 } },
      { name: 'b', payload: { y: 2 } },
    ]

    await bus.flush(events, {})
    await new Promise((r) => setTimeout(r, 10))

    expect(received).toHaveLength(2)
    expect(received[0]!.name).toBe('a')
    expect(received[1]!.name).toBe('b')
  })

  test('flush() empty array — no handlers called', async () => {
    const bus = new EventBus()
    let called = false
    bus.on('x', () => { called = true })

    await bus.flush([], {})
    await new Promise((r) => setTimeout(r, 10))

    expect(called).toBe(false)
  })

  test('flush() passes ctx to each handler', async () => {
    const bus = new EventBus()
    const receivedCtxs: unknown[] = []

    bus.on('evt', (_payload, ctx) => { receivedCtxs.push(ctx) })

    const ctx = { userId: 'u-1' }
    const events: PendingEvent[] = [
      { name: 'evt', payload: 1 },
      { name: 'evt', payload: 2 },
    ]

    await bus.flush(events, ctx)
    await new Promise((r) => setTimeout(r, 10))

    expect(receivedCtxs).toHaveLength(2)
    expect(receivedCtxs[0]).toBe(ctx)
    expect(receivedCtxs[1]).toBe(ctx)
  })
})

describe('EventBus — _emit (internal API)', () => {
  test('_emit() ruft subscriber auf', async () => {
    const bus = new EventBus()
    let called = false
    bus.on('x', () => { called = true })
    bus._emit('x', null, null)
    await new Promise((r) => setTimeout(r, 10))
    expect(called).toBe(true)
  })

  test('_emit() ist fire & forget — wirft nicht', () => {
    const bus = new EventBus()
    const orig = console.error
    console.error = () => {}
    bus.on('err', () => { throw new Error('fail') })
    expect(() => bus._emit('err', null, null)).not.toThrow()
    console.error = orig
  })

  test('_emit() für unbekanntes event — kein Fehler', () => {
    const bus = new EventBus()
    expect(() => bus._emit('unknown.event', null, null)).not.toThrow()
  })

  test('subscriber-Fehler wird geloggt, nicht geworfen', async () => {
    const bus = new EventBus()
    const orig = console.error
    const logged: unknown[] = []
    console.error = (...args: unknown[]) => logged.push(args)

    bus.on('bad', async () => { throw new Error('async-error') })
    bus._emit('bad', null, null)

    await new Promise((r) => setTimeout(r, 20))
    console.error = orig

    expect(logged.length).toBeGreaterThan(0)
  })
})

describe('EventBus — VelnEvents typed overload', () => {
  test('on() mit bekanntem event-string funktioniert runtime korrekt', async () => {
    const bus = new EventBus()
    const received: unknown[] = []
    // String overload — runtime behavior is identical
    bus.on('some.event', (payload) => received.push(payload))
    bus._emit('some.event', { data: 42 }, {})

    await new Promise((r) => setTimeout(r, 10))
    expect(received).toHaveLength(1)
    expect((received[0] as any).data).toBe(42)
  })
})
