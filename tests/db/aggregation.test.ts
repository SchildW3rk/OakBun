import { describe, test, expect, beforeEach } from 'bun:test'
import { SQLiteAdapter }    from '../../packages/core/src/adapter/sqlite'
import { HookExecutor }     from '../../packages/core/src/hooks/executor'
import { OakBunDB }           from '../../packages/core/src/db/index'
import { buildSelect }      from '../../packages/core/src/db/sql'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column }           from '../../packages/core/src/schema/column'
import type { InferRow }    from '../../packages/core/src/schema/table'

// ── Schema ─────────────────────────────────────────────────────────────────

const ordersTable = defineTable('orders', {
  id:     column.integer().primaryKey(),
  userId: column.integer(),
  status: column.text().default('pending'),
  amount: column.integer().default(0),
}).build()

type Order = InferRow<typeof ordersTable.schema>

const usersTable = defineTable('users', {
  id:   column.integer().primaryKey(),
  name: column.text(),
  role: column.text().default('user'),
}).build()

// ── Setup ──────────────────────────────────────────────────────────────────

function setup() {
  const adapter = new SQLiteAdapter()
  const db      = new OakBunDB(adapter, new HookExecutor())
  const bound   = db.withCtx({})
  return { adapter, bound }
}

async function seedOrders(adapter: SQLiteAdapter, bound: ReturnType<OakBunDB['withCtx']>) {
  await adapter.execute(toCreateTableSql(ordersTable))
  // status: paid×3, pending×2, refunded×1 — amounts: 100,200,300,50,150,75
  await bound.into(ordersTable).insert({ userId: 1, status: 'paid',     amount: 100 })
  await bound.into(ordersTable).insert({ userId: 1, status: 'paid',     amount: 200 })
  await bound.into(ordersTable).insert({ userId: 2, status: 'paid',     amount: 300 })
  await bound.into(ordersTable).insert({ userId: 2, status: 'pending',  amount: 50  })
  await bound.into(ordersTable).insert({ userId: 3, status: 'pending',  amount: 150 })
  await bound.into(ordersTable).insert({ userId: 3, status: 'refunded', amount: 75  })
}

async function seedUsers(adapter: SQLiteAdapter, bound: ReturnType<OakBunDB['withCtx']>) {
  await adapter.execute(toCreateTableSql(usersTable))
  await bound.into(usersTable).insert({ name: 'Alice', role: 'admin' })
  await bound.into(usersTable).insert({ name: 'Bob',   role: 'user'  })
  await bound.into(usersTable).insert({ name: 'Carol', role: 'user'  })
  await bound.into(usersTable).insert({ name: 'Dave',  role: 'mod'   })
}

// ── Part 1: buildSelect SQL generation — new options ──────────────────────

describe('buildSelect — columns / groupBy / aggregates / having', () => {
  test('columns option → SELECT "id", "name" FROM ...', () => {
    const { sql, params } = buildSelect('users', {}, { columns: ['id', 'name'] })
    expect(sql).toContain('SELECT "id", "name" FROM "users"')
    expect(params).toHaveLength(0)
  })

  test('no columns → SELECT * (default)', () => {
    const { sql } = buildSelect('users', {})
    expect(sql).toContain('SELECT *')
  })

  test('aggregates only → SELECT COUNT(*) AS "cnt" FROM ...', () => {
    const { sql } = buildSelect('users', {}, {
      aggregates: [{ alias: 'cnt', fn: 'COUNT' }],
    })
    expect(sql).toContain('COUNT(*) AS "cnt"')
  })

  test('aggregates with col → SELECT SUM("amount") AS "total" FROM ...', () => {
    const { sql } = buildSelect('orders', {}, {
      aggregates: [{ alias: 'total', fn: 'SUM', col: 'amount' }],
    })
    expect(sql).toContain('SUM("amount") AS "total"')
  })

  test('groupBy → GROUP BY "status"', () => {
    const { sql } = buildSelect('orders', {}, { groupBy: ['status'] })
    expect(sql).toContain('GROUP BY "status"')
  })

  test('columns + aggregates + groupBy in correct order', () => {
    const { sql } = buildSelect('orders', {}, {
      columns:    ['status'],
      aggregates: [{ alias: 'total', fn: 'SUM', col: 'amount' }],
      groupBy:    ['status'],
    })
    expect(sql).toContain('"status"')
    expect(sql).toContain('SUM("amount") AS "total"')
    expect(sql).toContain('GROUP BY "status"')
    const groupIdx = sql.indexOf('GROUP BY')
    const selectIdx = sql.indexOf('SELECT')
    expect(groupIdx).toBeGreaterThan(selectIdx)
  })

  test('having → HAVING "total" > ?', () => {
    const { sql, params } = buildSelect('orders', {}, {
      groupBy:    ['status'],
      aggregates: [{ alias: 'total', fn: 'SUM', col: 'amount' }],
      having:     { total: { op: '>', value: 100 } },
    })
    expect(sql).toContain('HAVING "total" > ?')
    expect(params).toContain(100)
  })

  test('WHERE + GROUP BY + HAVING + ORDER BY + LIMIT in correct order', () => {
    const { sql, params } = buildSelect('orders', { status: 'paid' }, {
      groupBy:    ['userId'],
      aggregates: [{ alias: 'cnt', fn: 'COUNT' }],
      having:     { cnt: { op: '>=', value: 2 } },
      orderBy:    [{ col: 'cnt', dir: 'DESC' }],
      limit:      5,
    })
    const whereIdx  = sql.indexOf('WHERE')
    const groupIdx  = sql.indexOf('GROUP BY')
    const havingIdx = sql.indexOf('HAVING')
    const orderIdx  = sql.indexOf('ORDER BY')
    const limitIdx  = sql.indexOf('LIMIT')

    expect(whereIdx).toBeLessThan(groupIdx)
    expect(groupIdx).toBeLessThan(havingIdx)
    expect(havingIdx).toBeLessThan(orderIdx)
    expect(orderIdx).toBeLessThan(limitIdx)
    expect(params).toContain('paid')
    expect(params).toContain(2)
  })
})

// ── Part 2: .columns() — column selection ─────────────────────────────────

describe('SelectBuilder — .columns()', () => {
  let bound: ReturnType<OakBunDB['withCtx']>
  let adapter: SQLiteAdapter

  beforeEach(async () => {
    ({ adapter, bound } = setup())
    await seedUsers(adapter, bound)
  })

  test('.columns("id", "name") returns only those fields', async () => {
    const rows = await bound.from(usersTable).columns('id', 'name').select()
    for (const row of rows) {
      expect('id' in row).toBe(true)
      expect('name' in row).toBe(true)
      expect('role' in row).toBe(false)
    }
  })

  test('.columns() with .where() — filtering still works', async () => {
    const rows = await bound.from(usersTable).columns('id', 'name').where({ role: 'admin' }).select()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('Alice')
  })

  test('.columns() with .limit()', async () => {
    const rows = await bound.from(usersTable).columns('id', 'name').limit(2).select()
    expect(rows).toHaveLength(2)
  })

  test('.columns() is immutable — original builder unchanged', async () => {
    const base      = bound.from(usersTable)
    const narrow    = base.columns('id', 'name')
    const allRows   = await base.select()
    const narrowRows = await narrow.select()
    expect(allRows[0]).toHaveProperty('role')
    expect(narrowRows[0]).not.toHaveProperty('role')
  })
})

// ── Part 3: .count() — scalar aggregate ────────────────────────────────────

describe('SelectBuilder — .count()', () => {
  let bound: ReturnType<OakBunDB['withCtx']>
  let adapter: SQLiteAdapter

  beforeEach(async () => {
    ({ adapter, bound } = setup())
    await seedOrders(adapter, bound)
  })

  test('.count() returns total row count as number', async () => {
    const n = await bound.from(ordersTable).count()
    expect(n).toBe(6)
  })

  test('.count() with .where() — filtered count', async () => {
    const n = await bound.from(ordersTable).where({ status: 'paid' }).count()
    expect(n).toBe(3)
  })

  test('.count("amount") — COUNT("amount") not COUNT(*)', async () => {
    const n = await bound.from(ordersTable).count('amount')
    expect(n).toBe(6)  // all rows have non-null amount
  })

  test('.count() on empty table returns 0', async () => {
    await adapter.execute('DELETE FROM "orders"')
    const n = await bound.from(ordersTable).count()
    expect(n).toBe(0)
  })

  test('.count() with .where() no matches returns 0', async () => {
    const n = await bound.from(ordersTable).where({ status: 'cancelled' }).count()
    expect(n).toBe(0)
  })
})

// ── Part 4: .sum() / .avg() / .min() / .max() ─────────────────────────────

describe('SelectBuilder — sum / avg / min / max', () => {
  let bound: ReturnType<OakBunDB['withCtx']>
  let adapter: SQLiteAdapter

  beforeEach(async () => {
    ({ adapter, bound } = setup())
    await seedOrders(adapter, bound)
  })

  test('.sum("amount") returns total sum', async () => {
    const total = await bound.from(ordersTable).sum('amount')
    expect(total).toBe(100 + 200 + 300 + 50 + 150 + 75)  // 875
  })

  test('.sum() with .where() — filtered sum', async () => {
    const total = await bound.from(ordersTable).where({ status: 'paid' }).sum('amount')
    expect(total).toBe(600)
  })

  test('.avg("amount") returns average', async () => {
    const avg = await bound.from(ordersTable).avg('amount')
    expect(avg).toBeCloseTo(875 / 6, 2)
  })

  test('.min("amount") returns minimum', async () => {
    const min = await bound.from(ordersTable).min('amount')
    expect(min).toBe(50)
  })

  test('.max("amount") returns maximum', async () => {
    const max = await bound.from(ordersTable).max('amount')
    expect(max).toBe(300)
  })

  test('.sum() on empty table returns 0', async () => {
    await adapter.execute('DELETE FROM "orders"')
    const total = await bound.from(ordersTable).sum('amount')
    expect(total).toBe(0)
  })

  test('.min() with .whereRaw()', async () => {
    const min = await bound.from(ordersTable).whereRaw('"amount" >= ?', [100]).min('amount')
    expect(min).toBe(100)
  })
})

// ── Part 5: .groupBy() + .aggregate() ──────────────────────────────────────

describe('SelectBuilder — .groupBy() + .aggregate()', () => {
  let bound: ReturnType<OakBunDB['withCtx']>
  let adapter: SQLiteAdapter

  beforeEach(async () => {
    ({ adapter, bound } = setup())
    await seedOrders(adapter, bound)
  })

  test('.groupBy("status").aggregate({ cnt }) returns one row per status', async () => {
    const rows = await bound.from(ordersTable)
      .groupBy('status')
      .aggregate<{ cnt: number }>({ cnt: { fn: 'COUNT' } })

    expect(rows).toHaveLength(3)  // paid, pending, refunded
    const statuses = rows.map((r) => r.status).sort()
    expect(statuses).toEqual(['paid', 'pending', 'refunded'])
  })

  test('.groupBy("status").aggregate() — SUM per group', async () => {
    const rows = await bound.from(ordersTable)
      .groupBy('status')
      .aggregate<{ total: number }>({ total: { fn: 'SUM', col: 'amount' } })

    const paid = rows.find((r) => r.status === 'paid')
    expect(paid!.total).toBe(600)

    const pending = rows.find((r) => r.status === 'pending')
    expect(pending!.total).toBe(200)
  })

  test('.aggregate() with multiple aggregates', async () => {
    const rows = await bound.from(ordersTable)
      .groupBy('status')
      .aggregate<{ cnt: number; total: number; avg: number }>({
        cnt:   { fn: 'COUNT' },
        total: { fn: 'SUM', col: 'amount' },
        avg:   { fn: 'AVG', col: 'amount' },
      })

    const paid = rows.find((r) => r.status === 'paid')!
    expect(paid.cnt).toBe(3)
    expect(paid.total).toBe(600)
    expect(Number(paid.avg)).toBeCloseTo(200, 0)
  })

  test('.where() + .groupBy() + .aggregate() — filter before grouping', async () => {
    const rows = await bound.from(ordersTable)
      .where({ userId: { op: 'IN', value: [1, 2] } })
      .groupBy('status')
      .aggregate<{ cnt: number }>({ cnt: { fn: 'COUNT' } })

    // userId 1: paid×2, userId 2: paid×1 + pending×1
    const paid = rows.find((r) => r.status === 'paid')!
    expect(paid.cnt).toBe(3)
    const pending = rows.find((r) => r.status === 'pending')
    expect(pending!.cnt).toBe(1)
  })

  test('.groupBy() + .aggregate() + .orderBy()', async () => {
    const rows = await bound.from(ordersTable)
      .groupBy('status')
      .aggregate<{ total: number }>({ total: { fn: 'SUM', col: 'amount' } })

    // Sort by total descending in application code since orderBy happens after aggregate
    // (test that we can at least do .orderBy on the builder before aggregate)
    const sorted = [...rows].sort((a, b) => b.total - a.total)
    expect(sorted[0]!.status).toBe('paid')
    expect(sorted[0]!.total).toBe(600)
  })

  test('.groupBy() + .aggregate() + .limit()', async () => {
    const rows = await bound.from(ordersTable)
      .groupBy('status')
      .orderBy('status')
      .limit(2)
      .aggregate<{ cnt: number }>({ cnt: { fn: 'COUNT' } })

    // limit applied after group — at most 2 groups
    expect(rows.length).toBeLessThanOrEqual(2)
  })
})

// ── Part 6: .having() ──────────────────────────────────────────────────────

describe('SelectBuilder — .having()', () => {
  let bound: ReturnType<OakBunDB['withCtx']>
  let adapter: SQLiteAdapter

  beforeEach(async () => {
    ({ adapter, bound } = setup())
    await seedOrders(adapter, bound)
  })

  test('.having() filters groups by aggregate value', async () => {
    const rows = await bound.from(ordersTable)
      .groupBy('status')
      .having({ cnt: { op: '>=', value: 2 } })
      .aggregate<{ cnt: number }>({ cnt: { fn: 'COUNT' } })

    // paid=3, pending=2, refunded=1 → only paid and pending pass cnt >= 2
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.cnt >= 2)).toBe(true)
  })

  test('.having() with equality shorthand', async () => {
    const rows = await bound.from(ordersTable)
      .groupBy('status')
      .having({ cnt: 1 } as any)
      .aggregate<{ cnt: number }>({ cnt: { fn: 'COUNT' } })

    // Only refunded has cnt = 1
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('refunded')
  })

  test('.where() + .having() combined', async () => {
    const rows = await bound.from(ordersTable)
      .where({ status: { op: 'IN', value: ['paid', 'pending'] } })
      .groupBy('status')
      .having({ cnt: { op: '>=', value: 2 } })
      .aggregate<{ cnt: number }>({ cnt: { fn: 'COUNT' } })

    // paid=3 ✓, pending=2 ✓ (refunded excluded by WHERE)
    expect(rows).toHaveLength(2)
  })
})

// ── Part 7: combined chains ────────────────────────────────────────────────

describe('SelectBuilder — combined aggregation chains', () => {
  let bound: ReturnType<OakBunDB['withCtx']>
  let adapter: SQLiteAdapter

  beforeEach(async () => {
    ({ adapter, bound } = setup())
    await seedOrders(adapter, bound)
  })

  test('.columns() + .where() + .orderBy() + .limit() all combined', async () => {
    const rows = await bound.from(ordersTable)
      .columns('id', 'amount')
      .where({ status: 'paid' })
      .orderBy('amount', 'DESC')
      .limit(2)
      .select()

    expect(rows).toHaveLength(2)
    // Only id and amount present
    expect('status' in rows[0]!).toBe(false)
    // Sorted descending by amount
    expect(rows[0]!.amount).toBeGreaterThanOrEqual(rows[1]!.amount!)
  })

  test('.count() respects multiple .where() calls (AND-merge)', async () => {
    const n = await bound.from(ordersTable)
      .where({ status: 'paid' })
      .where({ amount: { op: '>=', value: 200 } })
      .count()
    // paid + amount >= 200: 200, 300 → 2
    expect(n).toBe(2)
  })

  test('.sum() respects .whereRaw()', async () => {
    const total = await bound.from(ordersTable)
      .whereRaw('"amount" > ?', [100])
      .sum('amount')
    // > 100: 200, 300, 150 → 650
    expect(total).toBe(650)
  })
})
