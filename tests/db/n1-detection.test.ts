import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test'
import { SQLiteAdapter }    from '../../packages/core/src/adapter/sqlite'
import { HookExecutor }     from '../../packages/core/src/hooks/executor'
import { OakBunDB }           from '../../packages/core/src/db/index'
import type { QueryLog }    from '../../packages/core/src/db/index'
import { createApp }        from '../../packages/core/src/app/index'
import { dbPlugin }         from '../../packages/core/src/app/plugin'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column }           from '../../packages/core/src/schema/column'

// ── Schema ─────────────────────────────────────────────────────────────────

const itemsTable = defineTable('items', {
  id:   column.integer().primaryKey(),
  name: column.text(),
}).build()

// ── Setup helpers ──────────────────────────────────────────────────────────

function makeQueryLog(overrides?: Partial<QueryLog>): QueryLog {
  return { queries: 0, totalMs: 0, entries: [], threshold: 10, logQueries: false, ...overrides }
}

function makeAdapter() {
  return new SQLiteAdapter()
}

async function seedItems(adapter: SQLiteAdapter) {
  await adapter.execute(toCreateTableSql(itemsTable))
  for (let i = 1; i <= 5; i++) {
    await adapter.execute(`INSERT INTO "items" ("name") VALUES (?)`, [`item-${i}`])
  }
}

// ── Part 1: QueryLog unit tests ─────────────────────────────────────────────

describe('QueryLog — unit level via BoundOakBunDB', () => {
  test('queries below threshold — no warning conditions', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const db = new OakBunDB(adapter, new HookExecutor())
    const log = makeQueryLog({ threshold: 10 })
    const bound = db.withCtx({}, undefined, log)

    // 3 queries — well below threshold of 10
    await bound.from(itemsTable).select()
    await bound.from(itemsTable).select()
    await bound.from(itemsTable).select()

    expect(log.queries).toBe(3)
    expect(log.queries).toBeLessThanOrEqual(log.threshold)
  })

  test('queries above threshold — detectable', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const db = new OakBunDB(adapter, new HookExecutor())
    const log = makeQueryLog({ threshold: 10 })
    const bound = db.withCtx({}, undefined, log)

    // 11 queries — exceeds threshold of 10
    for (let i = 0; i < 11; i++) {
      await bound.from(itemsTable).select()
    }

    expect(log.queries).toBe(11)
    expect(log.queries).toBeGreaterThan(log.threshold)
  })

  test('custom threshold: n1Threshold: 3 — triggers at 4 queries', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const db = new OakBunDB(adapter, new HookExecutor())
    const log = makeQueryLog({ threshold: 3 })
    const bound = db.withCtx({}, undefined, log)

    for (let i = 0; i < 4; i++) {
      await bound.from(itemsTable).select()
    }

    expect(log.queries).toBe(4)
    expect(log.queries).toBeGreaterThan(log.threshold)
  })

  test('logQueries: true — entries contain SQL and timing', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const db = new OakBunDB(adapter, new HookExecutor())
    const log = makeQueryLog({ threshold: 2, logQueries: true })
    const bound = db.withCtx({}, undefined, log)

    await bound.from(itemsTable).select()
    await bound.from(itemsTable).select()
    await bound.from(itemsTable).select()

    expect(log.entries).toHaveLength(3)
    for (const entry of log.entries) {
      expect(typeof entry.sql).toBe('string')
      expect(entry.sql.length).toBeGreaterThan(0)
      expect(entry.durationMs).toBeGreaterThanOrEqual(0)
      expect(['query', 'execute']).toContain(entry.type)
    }
  })

  test('logQueries: false — entries array stays empty', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const db = new OakBunDB(adapter, new HookExecutor())
    const log = makeQueryLog({ threshold: 2, logQueries: false })
    const bound = db.withCtx({}, undefined, log)

    for (let i = 0; i < 5; i++) {
      await bound.from(itemsTable).select()
    }

    expect(log.entries).toHaveLength(0)  // not captured
    expect(log.queries).toBe(5)           // counter still works
  })

  test('totalMs accumulates per query', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const db = new OakBunDB(adapter, new HookExecutor())
    const log = makeQueryLog()
    const bound = db.withCtx({}, undefined, log)

    await bound.from(itemsTable).select()
    await bound.from(itemsTable).select()

    expect(log.totalMs).toBeGreaterThanOrEqual(0)
    expect(isFinite(log.totalMs)).toBe(true)
  })

  test('QueryLog resets per BoundOakBunDB instance (per request)', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const db = new OakBunDB(adapter, new HookExecutor())

    // Simulate request 1
    const log1 = makeQueryLog()
    const bound1 = db.withCtx({}, undefined, log1)
    for (let i = 0; i < 5; i++) await bound1.from(itemsTable).select()

    // Simulate request 2 — fresh QueryLog
    const log2 = makeQueryLog()
    const bound2 = db.withCtx({}, undefined, log2)
    await bound2.from(itemsTable).select()

    expect(log1.queries).toBe(5)
    expect(log2.queries).toBe(1)  // not contaminated by request 1
  })
})

// ── Part 2: N+1 warning via createApp + fetch ──────────────────────────────

describe('N+1 detection — createApp integration', () => {
  test('log.enabled: false — no QueryLog created, no warning', async () => {
    const adapter = makeAdapter()
    await seedItems(adapter)

    const warnSpy = spyOn(console, 'warn')

    const app = createApp({ db: { log: { enabled: false } } })
    app.plugin(dbPlugin(adapter))
    app.get('/items', async (ctx) => {
      const rows = await ctx.db.from(itemsTable).select()
      return ctx.json({ count: rows.length })
    })

    await app.fetch(new Request('http://localhost/items'))

    // No warn calls for n+1 (may have other warns from plugin setup — check specific message)
    const n1Warnings = warnSpy.mock.calls.filter(
      (args) => String(args[0]).includes('[db:n+1]'),
    )
    expect(n1Warnings).toHaveLength(0)

    warnSpy.mockRestore()
  })

  test('log.enabled: true, 1 query — no warning (below default threshold of 10)', async () => {
    const adapter = makeAdapter()
    await seedItems(adapter)

    const warnSpy = spyOn(console, 'warn')

    const app = createApp({ db: { log: { enabled: true, n1Threshold: 10 } } })
    app.plugin(dbPlugin(adapter))
    app.get('/items', async (ctx) => {
      const rows = await ctx.db.from(itemsTable).select()
      return ctx.json({ count: rows.length })
    })

    await app.fetch(new Request('http://localhost/items'))

    const n1Warnings = warnSpy.mock.calls.filter(
      (args) => String(args[0]).includes('[db:n+1]'),
    )
    expect(n1Warnings).toHaveLength(0)

    warnSpy.mockRestore()
  })

  test('log.enabled: true, 11 queries — warning logged', async () => {
    const adapter = makeAdapter()
    await seedItems(adapter)

    const warnSpy = spyOn(console, 'warn')

    const app = createApp({ db: { log: { enabled: true, n1Threshold: 10 } } })
    app.plugin(dbPlugin(adapter))
    app.get('/items', async (ctx) => {
      // Execute 11 queries
      for (let i = 0; i < 11; i++) {
        await ctx.db.from(itemsTable).select()
      }
      return ctx.json({ ok: true })
    })

    await app.fetch(new Request('http://localhost/items'))

    const n1Warnings = warnSpy.mock.calls.filter(
      (args) => String(args[0]).includes('[db:n+1]'),
    )
    expect(n1Warnings).toHaveLength(1)
    expect(String(n1Warnings[0]![0])).toContain('11 queries')
    expect(String(n1Warnings[0]![0])).toContain('threshold: 10')
    expect(String(n1Warnings[0]![0])).toContain('GET /items')

    warnSpy.mockRestore()
  })

  test('n1Threshold: 3 — warning at 4 queries', async () => {
    const adapter = makeAdapter()
    await seedItems(adapter)

    const warnSpy = spyOn(console, 'warn')

    const app = createApp({ db: { log: { enabled: true, n1Threshold: 3 } } })
    app.plugin(dbPlugin(adapter))
    app.get('/data', async (ctx) => {
      for (let i = 0; i < 4; i++) {
        await ctx.db.from(itemsTable).select()
      }
      return ctx.json({ ok: true })
    })

    await app.fetch(new Request('http://localhost/data'))

    const n1Warnings = warnSpy.mock.calls.filter(
      (args) => String(args[0]).includes('[db:n+1]'),
    )
    expect(n1Warnings).toHaveLength(1)
    expect(String(n1Warnings[0]![0])).toContain('threshold: 3')

    warnSpy.mockRestore()
  })

  test('logQueries: true — SQL entries in warning output', async () => {
    const adapter = makeAdapter()
    await seedItems(adapter)

    const warnLines: string[] = []
    const warnSpy = spyOn(console, 'warn').mockImplementation((...args) => {
      warnLines.push(String(args[0]))
    })

    const app = createApp({ db: { log: { enabled: true, n1Threshold: 2, logQueries: true } } })
    app.plugin(dbPlugin(adapter))
    app.get('/items', async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.from(itemsTable).select()
      }
      return ctx.json({ ok: true })
    })

    await app.fetch(new Request('http://localhost/items'))

    // N+1 warning present
    const n1Lines = warnLines.filter((l) => l.includes('[db:n+1]'))
    expect(n1Lines).toHaveLength(1)

    // SQL entry lines present (indented with 2 spaces)
    const sqlLines = warnLines.filter((l) => l.startsWith('  ') && l.includes('SELECT'))
    expect(sqlLines.length).toBeGreaterThanOrEqual(3)

    warnSpy.mockRestore()
  })

  test('logQueries: false — no SQL entry lines in output', async () => {
    const adapter = makeAdapter()
    await seedItems(adapter)

    const warnLines: string[] = []
    const warnSpy = spyOn(console, 'warn').mockImplementation((...args) => {
      warnLines.push(String(args[0]))
    })

    const app = createApp({ db: { log: { enabled: true, n1Threshold: 2, logQueries: false } } })
    app.plugin(dbPlugin(adapter))
    app.get('/items', async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.from(itemsTable).select()
      }
      return ctx.json({ ok: true })
    })

    await app.fetch(new Request('http://localhost/items'))

    // N+1 warning present
    const n1Lines = warnLines.filter((l) => l.includes('[db:n+1]'))
    expect(n1Lines).toHaveLength(1)

    // No SQL entry lines
    const sqlLines = warnLines.filter((l) => l.startsWith('  ') && l.includes('SELECT'))
    expect(sqlLines).toHaveLength(0)

    warnSpy.mockRestore()
  })

  test('query count resets between requests', async () => {
    const adapter = makeAdapter()
    await seedItems(adapter)

    const n1Counts: number[] = []
    const warnSpy = spyOn(console, 'warn').mockImplementation((...args) => {
      const msg = String(args[0])
      if (msg.includes('[db:n+1]')) {
        const match = /(\d+) queries/.exec(msg)
        if (match) n1Counts.push(Number(match[1]))
      }
    })

    const app = createApp({ db: { log: { enabled: true, n1Threshold: 2 } } })
    app.plugin(dbPlugin(adapter))
    app.get('/items', async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.from(itemsTable).select()
      }
      return ctx.json({ ok: true })
    })

    // Two separate requests — each should trigger its own warning with count 3
    await app.fetch(new Request('http://localhost/items'))
    await app.fetch(new Request('http://localhost/items'))

    expect(n1Counts).toHaveLength(2)
    // Each request independently counted 3 queries — not 3+3=6
    expect(n1Counts[0]).toBe(3)
    expect(n1Counts[1]).toBe(3)

    warnSpy.mockRestore()
  })
})
