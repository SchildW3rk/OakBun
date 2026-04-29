/**
 * cleanupCron — deletes draft posts older than 30 days.
 *
 * Demonstrates:
 *   - defineCron() fluent API with @daily shortcut
 *   - .options({ runOnStart, log }) — fires immediately on server start, logs at info level
 *   - ctx.db builder API (SelectBuilder + BoundOakBunDB)
 *   - logger as 2nd handler argument
 */

import { defineCron } from 'oakbun'
import { postsTable } from '../schema/posts'

export const cleanupCron = defineCron('cleanup.old-drafts', '@daily')
  .options({ runOnStart: true, log: { level: 'info' } })
  .handler(async (ctx, logger) => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const staleDrafts = await ctx.db
      .from(postsTable)
      .where({ published: false })
      .select()

    const toDelete = staleDrafts.filter((p) => p.createdAt < cutoff)

    for (const post of toDelete) {
      await ctx.db.from(postsTable).where({ id: post.id }).delete()
    }

    if (toDelete.length > 0) {
      logger.info(`deleted ${toDelete.length} stale draft(s)`, { cutoff: cutoff.toDateString() })
    }
  })
