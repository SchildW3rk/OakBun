import { describe, test, expect, beforeEach } from 'bun:test'
import { SQLiteAdapter }       from '../../packages/core/src/adapter/sqlite'
import { HookExecutor }        from '../../packages/core/src/hooks/executor'
import { OakBunDB }              from '../../packages/core/src/db/index'
import { buildSelect, buildJoinSelect } from '../../packages/core/src/db/sql'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import type { InferRow }       from '../../packages/core/src/schema/table'
import { column }              from '../../packages/core/src/schema/column'

// ── Schema ─────────────────────────────────────────────────────────────────

const usersTable = defineTable('users', {
  id:        column.integer().primaryKey(),
  name:      column.text(),
  role:      column.text().default('user'),
  createdAt: column.timestamp().defaultFn(() => new Date()),
}).build()

type User = InferRow<typeof usersTable.schema>

// ── Setup ──────────────────────────────────────────────────────────────────

function setup() {
  const adapter = new SQLiteAdapter()
  const exec    = new HookExecutor()
  const db      = new OakBunDB(adapter, exec)
  const bound   = db.withCtx({})
  return { adapter, bound }
}

async function seedUsers(adapter: SQLiteAdapter, bound: ReturnType<OakBunDB['withCtx']>): Promise<void> {
  await adapter.execute(toCreateTableSql(usersTable))
  for (const name of ['Alice', 'Bob', 'Carol', 'Dave', 'Eve']) {
    await bound.into(usersTable).insert({ name, role: 'user' })
  }
}

// ── Part 1: buildSelect SQL generation (unit tests, no DB) ─────────────────

describe('buildSelect — LIMIT/OFFSET/ORDER BY SQL generation', () => {
  test('.limit(10) → SQL contains LIMIT 10', () => {
    const { sql, params } = buildSelect('items', {}, { limit: 10 })
    expect(sql).toContain('LIMIT 10')
    // LIMIT value is inlined as a literal integer — not a bind param
    expect(params).not.toContain(10)
  })

  test('.offset(20) → SQL contains LIMIT -1 OFFSET 20 (SQLite requires LIMIT before OFFSET)', () => {
    const { sql, params } = buildSelect('items', {}, { offset: 20 })
    expect(sql).toContain('LIMIT -1')
    expect(sql).toContain('OFFSET 20')
    expect(params).toHaveLength(0)
  })

  test('.limit(10).offset(20) → LIMIT 10 OFFSET 20 in correct order', () => {
    const { sql } = buildSelect('items', {}, { limit: 10, offset: 20 })
    const limitIdx  = sql.indexOf('LIMIT 10')
    const offsetIdx = sql.indexOf('OFFSET 20')
    expect(limitIdx).toBeGreaterThan(-1)
    expect(offsetIdx).toBeGreaterThan(limitIdx)
  })

  test('.orderBy("createdAt", "DESC") → ORDER BY "createdAt" DESC', () => {
    const { sql } = buildSelect('items', {}, { orderBy: [{ col: 'createdAt', dir: 'DESC' }] })
    expect(sql).toContain('ORDER BY "createdAt" DESC')
  })

  test('ORDER BY appears before LIMIT and OFFSET', () => {
    const { sql } = buildSelect('items', {}, {
      orderBy: [{ col: 'name', dir: 'ASC' }],
      limit:   5,
      offset:  0,
    })
    const orderIdx  = sql.indexOf('ORDER BY')
    const limitIdx  = sql.indexOf('LIMIT 5')
    const offsetIdx = sql.indexOf('OFFSET 0')
    expect(orderIdx).toBeGreaterThan(-1)
    expect(limitIdx).toBeGreaterThan(orderIdx)
    expect(offsetIdx).toBeGreaterThan(limitIdx)
  })

  test('WHERE → ORDER BY → LIMIT → OFFSET — all combined, WHERE param bound correctly', () => {
    const { sql, params } = buildSelect(
      'users',
      { role: 'admin' },
      { orderBy: [{ col: 'name', dir: 'ASC' }], limit: 10, offset: 30 },
    )
    expect(sql).toContain('WHERE "role" = ?')
    expect(sql).toContain('ORDER BY "name" ASC')
    expect(sql).toContain('LIMIT 10')
    expect(sql).toContain('OFFSET 30')
    // Only WHERE param is bound — LIMIT/OFFSET are literals
    expect(params).toEqual(['admin'])
  })

  test('multiple orderBy columns', () => {
    const { sql } = buildSelect('items', {}, {
      orderBy: [{ col: 'role', dir: 'ASC' }, { col: 'name', dir: 'DESC' }],
    })
    expect(sql).toContain('ORDER BY "role" ASC, "name" DESC')
  })

  test('no options → no LIMIT/OFFSET/ORDER BY in SQL', () => {
    const { sql, params } = buildSelect('users', {})
    expect(sql).not.toContain('LIMIT')
    expect(sql).not.toContain('OFFSET')
    expect(sql).not.toContain('ORDER BY')
    expect(params).toHaveLength(0)
  })

  test('LIMIT/OFFSET are inlined as clamped integers — floats and negatives are sanitized', () => {
    // Floats → truncated to integer
    const { sql: s1 } = buildSelect('items', {}, { limit: 9.9 })
    expect(s1).toContain('LIMIT 9')

    // Negatives → clamped to 0
    const { sql: s2 } = buildSelect('items', {}, { offset: -5 })
    expect(s2).toContain('OFFSET 0')
  })
})

// ── Part 2: SelectBuilder fluent API ──────────────────────────────────────

describe('SelectBuilder — .limit() / .offset() / .orderBy() / .page()', () => {
  let bound: ReturnType<OakBunDB['withCtx']>
  let adapter: SQLiteAdapter

  beforeEach(async () => {
    ({ adapter, bound } = setup())
    await seedUsers(adapter, bound)
  })

  test('.limit(3) returns at most 3 rows', async () => {
    const rows = await bound.from(usersTable).limit(3).select()
    expect(rows).toHaveLength(3)
  })

  test('.offset(2) skips the first 2 rows', async () => {
    const all    = await bound.from(usersTable).select()
    const offset = await bound.from(usersTable).offset(2).select()
    expect(offset).toHaveLength(all.length - 2)
    expect(offset[0]!.name).toBe(all[2]!.name)
  })

  test('.limit(2).offset(2) returns the third and fourth row', async () => {
    const all   = await bound.from(usersTable).orderBy('id').select()
    const paged = await bound.from(usersTable).orderBy('id').limit(2).offset(2).select()
    expect(paged).toHaveLength(2)
    expect(paged[0]!.name).toBe(all[2]!.name)
    expect(paged[1]!.name).toBe(all[3]!.name)
  })

  test('.page(1, 2) → first 2 rows', async () => {
    const all  = await bound.from(usersTable).orderBy('id').select()
    const page = await bound.from(usersTable).orderBy('id').page(1, 2).select()
    expect(page).toHaveLength(2)
    expect(page[0]!.name).toBe(all[0]!.name)
  })

  test('.page(2, 2) → rows 3 and 4', async () => {
    const all  = await bound.from(usersTable).orderBy('id').select()
    const page = await bound.from(usersTable).orderBy('id').page(2, 2).select()
    expect(page).toHaveLength(2)
    expect(page[0]!.name).toBe(all[2]!.name)
    expect(page[1]!.name).toBe(all[3]!.name)
  })

  test('.page(1, 10) with 5 rows → returns all 5', async () => {
    const page = await bound.from(usersTable).page(1, 10).select()
    expect(page).toHaveLength(5)
  })

  test('.orderBy("name", "ASC") returns rows in ascending alphabetical order', async () => {
    const rows = await bound.from(usersTable).orderBy('name', 'ASC').select()
    const names = rows.map((r) => r.name)
    expect(names).toEqual([...names].sort())
  })

  test('.orderBy("name", "DESC") returns rows in descending alphabetical order', async () => {
    const rows = await bound.from(usersTable).orderBy('name', 'DESC').select()
    const names = rows.map((r) => r.name)
    expect(names).toEqual([...names].sort().reverse())
  })

  test('.orderBy("name") defaults to ASC', async () => {
    const asc  = await bound.from(usersTable).orderBy('name').select()
    const desc = await bound.from(usersTable).orderBy('name', 'DESC').select()
    expect(asc[0]!.name).not.toBe(desc[0]!.name)
    expect(asc.map((r) => r.name)).toEqual([...asc.map((r) => r.name)].sort())
  })

  test('.where().orderBy().limit() — all three combined', async () => {
    // Seed an admin user
    await bound.into(usersTable).insert({ name: 'Zara', role: 'admin' })

    const rows = await bound.from(usersTable)
      .where({ role: 'user' })
      .orderBy('name', 'ASC')
      .limit(2)
      .select()

    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.role === 'user')).toBe(true)
    expect(rows[0]!.name <= rows[1]!.name).toBe(true)
  })

  test('builder is immutable — .limit() does not mutate original', async () => {
    const base    = bound.from(usersTable)
    const limited = base.limit(2)
    const all     = await base.select()
    const few     = await limited.select()
    expect(all.length).toBeGreaterThan(few.length)
  })
})

// ── Part 3: JoinBuilder pagination ────────────────────────────────────────

describe('JoinBuilder — .limit() / .offset() / .orderBy() / .page()', () => {
  const ordersTable = defineTable('orders', {
    id:     column.integer().primaryKey(),
    userId: column.integer(),
    total:  column.integer(),
  }).build()

  let bound: ReturnType<OakBunDB['withCtx']>
  let adapter: SQLiteAdapter

  beforeEach(async () => {
    ({ adapter, bound } = setup())
    await adapter.execute(toCreateTableSql(usersTable))
    await adapter.execute(toCreateTableSql(ordersTable))

    await bound.into(usersTable).insert({ name: 'Alice', role: 'user' })
    await bound.into(usersTable).insert({ name: 'Bob',   role: 'user' })

    for (let i = 1; i <= 5; i++) {
      await bound.into(ordersTable).insert({ userId: 1, total: i * 10 })
    }
  })

  test('JoinBuilder .limit(2) → at most 2 rows', async () => {
    const rows = await bound.join('orders')
      .leftJoin('users', 'orders.userId = users.id')
      .limit(2)
      .select()
    expect(rows).toHaveLength(2)
  })

  test('JoinBuilder .offset(3) → skips first 3 rows', async () => {
    const all    = await bound.join('orders').select()
    const offset = await bound.join('orders').offset(3).select()
    expect(offset).toHaveLength(all.length - 3)
  })

  test('JoinBuilder .orderBy("total", "DESC") → descending order', async () => {
    const rows = await bound.join('orders').orderBy('total', 'DESC').select()
    const totals = rows.map((r) => r.total as number)
    for (let i = 0; i < totals.length - 1; i++) {
      expect(totals[i]!).toBeGreaterThanOrEqual(totals[i + 1]!)
    }
  })

  test('JoinBuilder .page(2, 2) → offset 2, limit 2', async () => {
    const all   = await bound.join('orders').orderBy('id').select()
    const paged = await bound.join('orders').orderBy('id').page(2, 2).select()
    expect(paged).toHaveLength(2)
    expect(paged[0]!.id).toBe(all[2]!.id)
  })

  test('JoinBuilder .limit()/.offset() inlined as integer literals', () => {
    const { sql, params } = buildJoinSelect('orders', [], [], '', [], { limit: 77, offset: 33 })
    expect(sql).toContain('LIMIT 77')
    expect(sql).toContain('OFFSET 33')
    // No WHERE params and no LIMIT/OFFSET bind params
    expect(params).toHaveLength(0)
  })
})
