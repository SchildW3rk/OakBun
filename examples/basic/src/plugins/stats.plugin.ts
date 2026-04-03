/**
 * statsPlugin — custom plugin demo using definePlugin()
 *
 * - Demonstrates definePlugin() with .requires() and .extend()
 * - Tracks request count in memory (per-process)
 * - Exposes ctx.stats.increment(), ctx.stats.getCount(), ctx.stats.all()
 *
 * Note: must be registered AFTER dbPlugin and loggerPlugin.
 */

import { definePlugin } from 'oakbun'

interface Stats {
  increment(route: string): void
  getCount(route: string): number
  all(): Record<string, number>
}

// Shared in-process counter — lives for the lifetime of the server
const _counters = new Map<string, number>()

export const statsPlugin = definePlugin<{ stats: Stats }>('stats')
  .requires(['db', 'logger'])
  .options({ log: { level: 'debug' } })
  .extend(() => ({
    stats: {
      increment(route: string) {
        _counters.set(route, (_counters.get(route) ?? 0) + 1)
      },
      getCount(route: string) {
        return _counters.get(route) ?? 0
      },
      all() {
        return Object.fromEntries(_counters)
      },
    },
  }))
