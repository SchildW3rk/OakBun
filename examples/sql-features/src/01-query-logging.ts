/**
 * SQL-A — Query Logging + Slow-Query Detection
 *
 * dbPlugin nimmt eine optionale log-Config:
 *   enabled:      aktiviert Per-Request QueryLog
 *   n1Threshold:  Warnung wenn Query-Count > Schwellenwert
 *   logQueries:   SQL-Entries im Warning ausgeben
 *
 * Jede Abfrage emittiert intern ein QueryLogEntry { sql, params, durationMs, type }.
 * Das N+1-Warning landet in console.warn('[db:n+1] ...').
 */

import {createApp, dbPlugin, SQLiteAdapter} from 'oakbun'
import { usersTable }          from './schema'

const adapter = new SQLiteAdapter()
const app = createApp({
  db: {
    log: {
      enabled:     true,
      n1Threshold: 5,      // warnt ab 6 Queries pro Request
      logQueries:  true,   // gibt jedes SQL im Warning aus
    },
  },
}).plugin(dbPlugin(adapter))

// Dieser Handler führt absichtlich viele Queries aus → löst N+1-Warning aus
app.get('/users-n1', async (ctx) => {
  const users = await ctx.db.from(usersTable).select()

  // Anti-Pattern: ein Query pro User → N+1
  const details = []
  for (const user of users) {
    const detail = await ctx.db.from(usersTable)
      .where({ id: user.id })
      .first()
    details.push(detail)
  }

  return ctx.json({ count: details.length })
})

// Guter Handler: ein einzelner Query → kein Warning
app.get('/users', async (ctx) => {
  const users = await ctx.db.from(usersTable).select()
  return ctx.json(users)
})

export { app }
