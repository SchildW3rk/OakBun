import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import type { Plugin } from '../../packages/core/src/app/plugin'
import type { BaseCtx } from '../../packages/core/src/app/types'

describe('app.close() — graceful shutdown', () => {
  test('teardown() called on all plugins', async () => {
    const order: string[] = []

    const p1: Plugin<BaseCtx, Record<never, never>> = {
      name: 'p1',
      request: (ctx) => ctx,
      teardown: async () => { order.push('p1') },
    }
    const p2: Plugin<BaseCtx, Record<never, never>> = {
      name: 'p2',
      request: (ctx) => ctx,
      teardown: async () => { order.push('p2') },
    }

    const app = createApp()
    app.plugin(p1 as Plugin<BaseCtx, object>)
    app.plugin(p2 as Plugin<BaseCtx, object>)

    await app.close()
    expect(order).toEqual(['p2', 'p1'])  // reverse order
  })

  test('plugins without teardown are skipped', async () => {
    const order: string[] = []

    const p1: Plugin<BaseCtx, Record<never, never>> = {
      name: 'p1',
      request: (ctx) => ctx,
      // no teardown
    }
    const p2: Plugin<BaseCtx, Record<never, never>> = {
      name: 'p2',
      request: (ctx) => ctx,
      teardown: async () => { order.push('p2') },
    }

    const app = createApp()
    app.plugin(p1 as Plugin<BaseCtx, object>)
    app.plugin(p2 as Plugin<BaseCtx, object>)

    await app.close()
    expect(order).toEqual(['p2'])
  })

  test('teardown error does not prevent other teardowns from running', async () => {
    const order: string[] = []

    const failing: Plugin<BaseCtx, Record<never, never>> = {
      name: 'failing',
      request: (ctx) => ctx,
      teardown: async () => { throw new Error('teardown failed') },
    }
    const healthy: Plugin<BaseCtx, Record<never, never>> = {
      name: 'healthy',
      request: (ctx) => ctx,
      teardown: async () => { order.push('healthy') },
    }

    const app = createApp()
    app.plugin(healthy as Plugin<BaseCtx, object>)
    app.plugin(failing as Plugin<BaseCtx, object>)

    // Should not throw
    await expect(app.close()).resolves.toBeUndefined()
    expect(order).toEqual(['healthy'])
  })

  test('app.close() with no plugins completes without error', async () => {
    const app = createApp()
    await expect(app.close()).resolves.toBeUndefined()
  })
})
