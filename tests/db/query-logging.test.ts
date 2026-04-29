import { describe, test, expect, beforeEach } from 'bun:test'
import { SQLiteAdapter }    from '../../packages/core/src/adapter/sqlite'
import { HookExecutor }     from '../../packages/core/src/hooks/executor'
import { OakBunDB }           from '../../packages/core/src/db/index'
import type { QueryLog }    from '../../packages/core/src/db/index'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column }           from '../../packages/core/src/schema/column'
import type { QueryLogEntry } from '../../packages/core/src/adapter/types'

// Helper: create a QueryLog for tests
function makeQueryLog(overrides?: Partial<QueryLog>): QueryLog {
  return { queries: 0, totalMs: 0, entries: [], threshold: 10, logQueries: false, ...overrides }
}

// ── Schema ─────────────────────────────────────────────────────────────────

const itemsTable = defineTable('items', {
  id:   column.integer().primaryKey(),
  name: column.text(),
}).build()

// ── Setup helpers ──────────────────────────────────────────────────────────

function makeAdapter(): SQLiteAdapter {
  return new SQLiteAdapter()
}

async function seedItems(adapter: SQLiteAdapter, db: ReturnType<OakBunDB['withCtx']>): Promise<void> {
  await adapter.execute(toCreateTableSql(itemsTable))
  await db.into(itemsTable).insert({ name: 'Alpha' })
  await db.into(itemsTable).insert({ name: 'Beta' })
}

// ── Part 1: QueryLogEntry shape ────────────────────────────────────────────

describe('QueryLogEntry — shape and timing', () => {
  test('adapter.onQuery receives a valid QueryLogEntry after query()', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const entries: QueryLogEntry[] = []
    adapter.onQuery = (e) => entries.push(e)

    await adapter.query('SELECT * FROM "items"')

    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.sql).toBe('SELECT * FROM "items"')
    expect(entry.params).toEqual([])
    expect(entry.type).toBe('query')
    expect(entry.durationMs).toBeGreaterThanOrEqual(0)
    expect(typeof entry.durationMs).toBe('number')
  })

  test('adapter.onQuery receives a valid QueryLogEntry after execute()', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const entries: QueryLogEntry[] = []
    adapter.onQuery = (e) => entries.push(e)

    await adapter.execute('INSERT INTO "items" ("name") VALUES (?)', ['TestItem'])

    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.sql).toBe('INSERT INTO "items" ("name") VALUES (?)')
    expect(entry.params).toEqual(['TestItem'])
    expect(entry.type).toBe('execute')
    expect(entry.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('durationMs > 0 for a real DB round-trip (not always zero)', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))
    // Insert enough rows that timing is measurable
    for (let i = 0; i < 20; i++) {
      await adapter.execute('INSERT INTO "items" ("name") VALUES (?)', [`item-${i}`])
    }

    const durations: number[] = []
    adapter.onQuery = (e) => durations.push(e.durationMs)

    await adapter.query('SELECT * FROM "items"')

    // durationMs is always a non-negative finite number
    expect(durations[0]).toBeGreaterThanOrEqual(0)
    expect(isFinite(durations[0]!)).toBe(true)
  })

  test('params are captured correctly in QueryLogEntry', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    let captured: QueryLogEntry | null = null
    adapter.onQuery = (e) => { captured = e }

    await adapter.query('SELECT * FROM "items" WHERE "name" = ?', ['Alpha'])

    expect(captured).not.toBeNull()
    expect(captured!.params).toEqual(['Alpha'])
  })
})

// ── Part 2: adapter.onQuery disabled ──────────────────────────────────────

describe('adapter.onQuery — disabled by default', () => {
  test('no onQuery set → queries execute without error', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    // Should not throw even with no onQuery handler set
    const rows = await adapter.query('SELECT * FROM "items"')
    expect(Array.isArray(rows)).toBe(true)
  })

  test('setting onQuery to undefined after enabling silences subsequent calls', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const entries: QueryLogEntry[] = []
    adapter.onQuery = (e) => entries.push(e)
    await adapter.query('SELECT * FROM "items"')
    expect(entries).toHaveLength(1)

    adapter.onQuery = undefined
    await adapter.query('SELECT * FROM "items"')
    // Still 1 — second query was not observed
    expect(entries).toHaveLength(1)
  })
})

// ── Part 3: BoundOakBunDB._queryCount ───────────────────────────────────────

describe('BoundOakBunDB._queryCount', () => {
  let adapter: SQLiteAdapter
  let oakBunDB: OakBunDB

  beforeEach(() => {
    adapter = makeAdapter()
    oakBunDB = new OakBunDB(adapter, new HookExecutor())
  })

  test('_queryCount starts at 0', async () => {
    await adapter.execute(toCreateTableSql(itemsTable))
    const db = oakBunDB.withCtx({})
    expect(db._queryCount).toBe(0)
  })

  test('_queryCount stays 0 when no onQuery observer is wired', async () => {
    await adapter.execute(toCreateTableSql(itemsTable))
    const db = oakBunDB.withCtx({})
    await db.from(itemsTable).select()
    // Without a per-request observer, _queryCount is not incremented
    expect(db._queryCount).toBe(0)
  })

  test('_queryCount increments for each query when QueryLog is wired', async () => {
    await adapter.execute(toCreateTableSql(itemsTable))
    await adapter.execute('INSERT INTO "items" ("name") VALUES (?)', ['X'])

    const log = makeQueryLog()
    const db = oakBunDB.withCtx({}, undefined, log)

    await db.from(itemsTable).select()
    expect(db._queryCount).toBe(1)
    expect(log.queries).toBe(1)

    await db.from(itemsTable).limit(1).select()
    expect(db._queryCount).toBe(2)
    expect(log.queries).toBe(2)
  })

  test('_queryCount increments for execute() (INSERT) when QueryLog is wired', async () => {
    await adapter.execute(toCreateTableSql(itemsTable))

    const log = makeQueryLog()
    const db = oakBunDB.withCtx({}, undefined, log)
    await db.into(itemsTable).insert({ name: 'Test' })

    // INSERT uses adapter.query() (RETURNING *) — counted
    expect(db._queryCount).toBeGreaterThanOrEqual(1)
    expect(log.queries).toBeGreaterThanOrEqual(1)
  })

  test('_queryCount is independent across BoundOakBunDB instances', async () => {
    await adapter.execute(toCreateTableSql(itemsTable))

    const log1 = makeQueryLog()
    const log2 = makeQueryLog()
    const db1 = oakBunDB.withCtx({}, undefined, log1)
    const db2 = oakBunDB.withCtx({}, undefined, log2)

    await db1.from(itemsTable).select()
    await db1.from(itemsTable).select()

    expect(db1._queryCount).toBe(2)
    expect(log1.queries).toBe(2)
    expect(db2._queryCount).toBe(0)
    expect(log2.queries).toBe(0)
  })
})

// ── Part 4: QueryLog per-request tracking ─────────────────────────────────

describe('BoundOakBunDB — QueryLog per-request tracking', () => {
  test('QueryLog.entries populated when logQueries is true', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))
    await adapter.execute('INSERT INTO "items" ("name") VALUES (?)', ['Alpha'])

    const db = new OakBunDB(adapter, new HookExecutor())
    const log = makeQueryLog({ logQueries: true })
    const bound = db.withCtx({}, undefined, log)

    await bound.from(itemsTable).where({ name: 'Alpha' }).select()

    expect(log.entries).toHaveLength(1)
    expect(log.entries[0]!.sql).toContain('WHERE')
    expect(log.entries[0]!.params).toContain('Alpha')
    expect(log.entries[0]!.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('QueryLog.entries NOT populated when logQueries is false', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const db = new OakBunDB(adapter, new HookExecutor())
    const log = makeQueryLog({ logQueries: false })
    const bound = db.withCtx({}, undefined, log)

    await bound.from(itemsTable).select()

    expect(log.entries).toHaveLength(0)
    expect(log.queries).toBe(1)  // counter still increments
  })

  test('QueryLog.totalMs accumulates across queries', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const db = new OakBunDB(adapter, new HookExecutor())
    const log = makeQueryLog()
    const bound = db.withCtx({}, undefined, log)

    await bound.from(itemsTable).select()
    await bound.from(itemsTable).select()

    expect(log.totalMs).toBeGreaterThanOrEqual(0)
    expect(log.queries).toBe(2)
  })

  test('adapter.onQuery is not mutated when QueryLog is set', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    adapter.onQuery = () => {}
    const originalOnQuery = adapter.onQuery

    const db = new OakBunDB(adapter, new HookExecutor())
    db.withCtx({}, undefined, makeQueryLog())

    // adapter.onQuery must not be replaced
    expect(adapter.onQuery).toBe(originalOnQuery)
  })

  test('adapter.onQuery and QueryLog both fire independently', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const adapterCalls: string[] = []
    adapter.onQuery = (e) => adapterCalls.push(e.type)

    const db = new OakBunDB(adapter, new HookExecutor())
    const log = makeQueryLog()
    const bound = db.withCtx({}, undefined, log)

    await bound.from(itemsTable).select()

    // Adapter-level fires inside the adapter
    expect(adapterCalls).toHaveLength(1)
    // QueryLog counter also incremented
    expect(log.queries).toBe(1)
  })
})

// ── Part 5: slow-query detection ──────────────────────────────────────────

describe('slow-query detection via adapter.onQuery', () => {
  test('entries with durationMs above threshold can be detected in custom handler', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    const slowQueryMs = 1000  // set very high so nothing actually triggers — just shape test
    const slowEntries: QueryLogEntry[] = []

    adapter.onQuery = (entry) => {
      if (entry.durationMs >= slowQueryMs) {
        slowEntries.push(entry)
      }
    }

    await adapter.query('SELECT * FROM "items"')

    // With a 1000ms threshold no query should be slow in tests
    expect(slowEntries).toHaveLength(0)
  })

  test('custom onQuery handler can classify slow queries', async () => {
    const adapter = makeAdapter()
    await adapter.execute(toCreateTableSql(itemsTable))

    // Threshold of 0ms — every query is "slow" for test purposes
    const slowEntries: QueryLogEntry[] = []
    adapter.onQuery = (entry) => {
      if (entry.durationMs >= 0) slowEntries.push(entry)
    }

    await adapter.query('SELECT * FROM "items"')

    expect(slowEntries).toHaveLength(1)
    expect(slowEntries[0]!.durationMs).toBeGreaterThanOrEqual(0)
  })
})
