import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import type { EventBusAdapter } from '../../packages/core/src/events/index'

// ── Custom EventBusAdapter ───────────────────────────────────────────────────
//
// Verifies that createApp({ eventBus: customAdapter }) routes event delivery
// through the injected adapter instead of the default InMemoryEventBus.

describe('createApp({ eventBus }) — custom adapter injection', () => {
  test('on() and emit() are called on the injected adapter', async () => {
    const onCalls:   Array<{ event: string; handler: (payload: unknown) => void }> = []
    const emitCalls: Array<{ event: string; payload: unknown }>                    = []

    const customAdapter: EventBusAdapter = {
      on(event, handler) {
        onCalls.push({ event, handler })
      },
      async emit(event, payload) {
        emitCalls.push({ event, payload })
        // Also call registered handlers so app.on() subscribers fire
        for (const entry of onCalls) {
          if (entry.event === event) entry.handler(payload)
        }
      },
    }

    const app = createApp({ eventBus: customAdapter })

    // Register a subscriber via app.on() — this calls adapter.on()
    const received: unknown[] = []
    app.on('order.created', (payload) => { received.push(payload) })

    // Trigger an event via ctx.emit() from a route handler
    app.post('/orders', (ctx) => {
      ctx.emit('order.created', { id: 42 })
      return ctx.json({ ok: true })
    })

    const res = await app.fetch(
      new Request('http://localhost/orders', { method: 'POST' }),
    )
    expect(res.status).toBe(200)

    // on() must have been called with the event name
    const onCall = onCalls.find((c) => c.event === 'order.created')
    expect(onCall).toBeDefined()
    expect(onCall?.event).toBe('order.created')

    // emit() must have been called after the response
    expect(emitCalls.some((c) => c.event === 'order.created')).toBe(true)
    const emitCall = emitCalls.find((c) => c.event === 'order.created')
    expect(emitCall?.payload).toEqual({ id: 42 })

    // Subscriber received the payload
    expect(received).toEqual([{ id: 42 }])
  })

  test('default (no eventBus option) uses InMemoryEventBus', async () => {
    // Verifies that the default path still works — no regression
    const app = createApp()

    const received: unknown[] = []
    app.on('ping', (payload) => { received.push(payload) })
    app.post('/ping', (ctx) => {
      ctx.emit('ping', { ts: 1 })
      return ctx.json({ ok: true })
    })

    const res = await app.fetch(
      new Request('http://localhost/ping', { method: 'POST' }),
    )
    expect(res.status).toBe(200)

    // Give the fire-and-forget async handlers a tick to run
    await new Promise((r) => setTimeout(r, 10))
    expect(received).toEqual([{ ts: 1 }])
  })
})
