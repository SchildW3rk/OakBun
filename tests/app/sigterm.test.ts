import { describe, test, expect, afterEach } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'

// ── Signal handler tests ───────────────────────────────────────────────────────
//
// These tests simulate signals via process.emit() without actually exiting.
// We intercept process.exit() to prevent the process from dying during tests.
// All listeners added during tests are cleaned up in afterEach.

const PORT_BASE = 43_000

let testPort = PORT_BASE
let capturedListeners: Array<{ signal: string; fn: (...args: unknown[]) => void }> = []

afterEach(() => {
  // Clean up all signal listeners registered during tests
  for (const { signal, fn } of capturedListeners) {
    process.removeListener(signal, fn)
  }
  capturedListeners = []
})

// Helper: intercepts process.on() for SIGTERM/SIGINT during the test, then restores
function withSignalInterception(fn: () => void): void {
  const original = process.on.bind(process)
  // Track listeners so we can remove them after the test
  process.on = (event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'SIGTERM' || event === 'SIGINT') {
      capturedListeners.push({ signal: event, fn: listener })
    }
    return original(event, listener)
  }
  fn()
  process.on = original
}

describe('app.listen() — signal handlers', () => {
  test('SIGTERM triggers app.close() — idempotent (called only once)', async () => {
    let closeCalls = 0
    const app = createApp()
    app.get('/ok', (ctx) => ctx.json({ ok: true }))

    // Patch close() to count calls without actually running teardown
    const originalClose = app.close.bind(app)
    app.close = async () => {
      closeCalls++
      return originalClose()
    }

    // Intercept process.exit() to prevent process termination
    const originalExit = process.exit.bind(process)
    let exitCalled = false
    process.exit = ((_code?: number) => { exitCalled = true }) as typeof process.exit

    let server: ReturnType<typeof import('bun').serve> | undefined
    withSignalInterception(() => {
      server = app.listen(testPort++)
    })

    // Emit SIGTERM twice — should call close() only once
    await process.emit('SIGTERM')
    await process.emit('SIGTERM')

    // Wait briefly for async shutdown handler
    await new Promise((r) => setTimeout(r, 20))

    server?.stop(true)
    process.exit = originalExit

    expect(closeCalls).toBe(1)
    expect(exitCalled).toBe(true)
  })

  test('SIGINT triggers app.close()', async () => {
    let closeCalls = 0
    const app = createApp()
    app.get('/ok', (ctx) => ctx.json({ ok: true }))

    const originalClose = app.close.bind(app)
    app.close = async () => {
      closeCalls++
      return originalClose()
    }

    const originalExit = process.exit.bind(process)
    process.exit = ((_code?: number) => {}) as typeof process.exit

    let server: ReturnType<typeof import('bun').serve> | undefined
    withSignalInterception(() => {
      server = app.listen(testPort++)
    })

    await process.emit('SIGINT')
    await new Promise((r) => setTimeout(r, 20))

    server?.stop(true)
    process.exit = originalExit

    expect(closeCalls).toBe(1)
  })

  test('autoHandleSignals: false → no handlers registered', async () => {
    const app = createApp()
    app.get('/ok', (ctx) => ctx.json({ ok: true }))

    const listenersBefore = {
      sigterm: process.listenerCount('SIGTERM'),
      sigint:  process.listenerCount('SIGINT'),
    }

    const server = app.listen(testPort++, undefined, { autoHandleSignals: false })
    server.stop(true)

    const listenersAfter = {
      sigterm: process.listenerCount('SIGTERM'),
      sigint:  process.listenerCount('SIGINT'),
    }

    // No new listeners should have been added
    expect(listenersAfter.sigterm).toBe(listenersBefore.sigterm)
    expect(listenersAfter.sigint).toBe(listenersBefore.sigint)
  })

  test('double SIGTERM → close() called only once (idempotent)', async () => {
    let closeCalls = 0
    const app = createApp()
    app.get('/ok', (ctx) => ctx.json({ ok: true }))

    const originalClose = app.close.bind(app)
    app.close = async () => {
      closeCalls++
      return originalClose()
    }

    const originalExit = process.exit.bind(process)
    process.exit = ((_code?: number) => {}) as typeof process.exit

    let server: ReturnType<typeof import('bun').serve> | undefined
    withSignalInterception(() => {
      server = app.listen(testPort++)
    })

    // Fire 5 SIGTERMs
    for (let i = 0; i < 5; i++) {
      await process.emit('SIGTERM')
    }
    await new Promise((r) => setTimeout(r, 30))

    server?.stop(true)
    process.exit = originalExit

    expect(closeCalls).toBe(1)
  })
})
