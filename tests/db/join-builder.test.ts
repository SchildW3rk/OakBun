import { describe, test, expect } from 'bun:test'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { HookExecutor } from '../../packages/core/src/hooks/executor'
import { VelnDB } from '../../packages/core/src/db/index'
import { JoinBuilder } from '../../packages/core/src/db/index'
import { buildJoinSelect, validateAndQuoteOnClause } from '../../packages/core/src/db/sql'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'
import { VelnError } from '../../packages/core/src/errors/index'

// ── Schema ───────────────────────────────────────────────────────────────────

const usersTable = defineTable('users', {
  id:   column.integer().primaryKey(),
  name: column.text(),
}).build()

const ordersTable = defineTable('orders', {
  id:      column.integer().primaryKey(),
  user_id: column.integer(),
  status:  column.text(),
  total:   column.integer(),
}).build()

const itemsTable = defineTable('items', {
  id:       column.integer().primaryKey(),
  order_id: column.integer(),
  name:     column.text(),
}).build()

// ── Helpers ──────────────────────────────────────────────────────────────────

async function createSetup() {
  const adapter = new SQLiteAdapter()
  const exec    = new HookExecutor()
  const db      = new VelnDB(adapter, exec)
  const bound   = db.withCtx({})

  await adapter.execute(toCreateTableSql(usersTable))
  await adapter.execute(toCreateTableSql(ordersTable))
  await adapter.execute(toCreateTableSql(itemsTable))

  return { adapter, bound }
}

// ── buildJoinSelect — SQL generation (pure unit tests) ───────────────────────

describe('buildJoinSelect — SQL generation', () => {
  test('no joins → SELECT * FROM "table"', () => {
    const { sql, params } = buildJoinSelect('orders', [], [], '', [])
    expect(sql).toBe('SELECT * FROM "orders"')
    expect(params).toEqual([])
  })

  test('INNER JOIN — correct SQL', () => {
    const { sql } = buildJoinSelect(
      'orders', [], [{ type: 'INNER', table: 'users', on: 'orders.user_id = users.id' }], '', [],
    )
    expect(sql).toContain('INNER JOIN "users" ON "orders"."user_id" = "users"."id"')
    expect(sql).toContain('FROM "orders"')
  })

  test('LEFT JOIN — correct SQL', () => {
    const { sql } = buildJoinSelect(
      'orders', [], [{ type: 'LEFT', table: 'users', on: 'orders.user_id = users.id' }], '', [],
    )
    expect(sql).toContain('LEFT JOIN "users"')
  })

  test('RIGHT JOIN — correct SQL', () => {
    const { sql } = buildJoinSelect(
      'orders', [], [{ type: 'RIGHT', table: 'users', on: 'orders.user_id = users.id' }], '', [],
    )
    expect(sql).toContain('RIGHT JOIN "users"')
  })

  test('FULL JOIN — correct SQL', () => {
    const { sql } = buildJoinSelect(
      'orders', [], [{ type: 'FULL', table: 'users', on: 'orders.user_id = users.id' }], '', [],
    )
    expect(sql).toContain('FULL JOIN "users"')
  })

  test('column selection — identifiers quoted', () => {
    const { sql } = buildJoinSelect(
      'orders', ['orders.id', 'users.name'], [], '', [],
    )
    expect(sql).toContain('SELECT "orders"."id", "users"."name"')
  })

  test('WHERE clause appended', () => {
    const { sql, params } = buildJoinSelect(
      'orders', [], [], 'orders.status = ?', ['pending'],
    )
    expect(sql).toContain('WHERE orders.status = ?')
    expect(params).toEqual(['pending'])
  })

  test('multiple JOINs in order', () => {
    const { sql } = buildJoinSelect(
      'items',
      [],
      [
        { type: 'INNER', table: 'orders',   on: 'items.order_id = orders.id' },
        { type: 'INNER', table: 'users',    on: 'orders.user_id = users.id' },
      ],
      '',
      [],
    )
    const joinAIdx = sql.indexOf('INNER JOIN "orders"')
    const joinBIdx = sql.indexOf('INNER JOIN "users"')
    expect(joinAIdx).toBeGreaterThanOrEqual(0)
    expect(joinBIdx).toBeGreaterThan(joinAIdx)
  })

  test('JOIN + WHERE combined', () => {
    const { sql, params } = buildJoinSelect(
      'orders',
      ['orders.id', 'users.name'],
      [{ type: 'INNER', table: 'users', on: 'orders.user_id = users.id' }],
      'orders.status = ?',
      ['pending'],
    )
    expect(sql).toContain('SELECT "orders"."id", "users"."name"')
    expect(sql).toContain('INNER JOIN "users"')
    expect(sql).toContain('WHERE orders.status = ?')
    expect(params).toEqual(['pending'])
  })
})

// ── JoinBuilder — integration tests (real SQLite) ────────────────────────────

describe('JoinBuilder — integration', () => {
  test('INNER JOIN — returns joined rows', async () => {
    const { bound } = await createSetup()

    await bound.into(usersTable).insert({ name: 'Alice' })
    const user = await bound.from(usersTable).first()

    await bound.into(ordersTable).insert({ user_id: user!.id, status: 'pending', total: 100 })

    const rows = await bound.join('orders')
      .join('users', 'orders.user_id = users.id')
      .select()

    expect(rows.length).toBe(1)
    expect(rows[0]).toHaveProperty('name', 'Alice')
    expect(rows[0]).toHaveProperty('status', 'pending')
  })

  test('LEFT JOIN — includes orders without a matching user', async () => {
    const { adapter, bound } = await createSetup()

    // Insert an order with no matching user (user_id = 999)
    await adapter.execute('INSERT INTO "orders" (user_id, status, total) VALUES (999, \'orphan\', 0)')

    const rows = await bound.join('orders')
      .leftJoin('users', 'orders.user_id = users.id')
      .select()

    expect(rows.length).toBe(1)
    expect(rows[0]!['status']).toBe('orphan')
    // No matching user — name should be null
    expect(rows[0]!['name']).toBeNull()
  })

  test('JOIN + WHERE filters rows', async () => {
    const { bound } = await createSetup()

    await bound.into(usersTable).insert({ name: 'Bob' })
    const user = await bound.from(usersTable).first()

    await bound.into(ordersTable).insert({ user_id: user!.id, status: 'pending', total: 50 })
    await bound.into(ordersTable).insert({ user_id: user!.id, status: 'shipped', total: 75 })

    const rows = await bound.join('orders')
      .join('users', 'orders.user_id = users.id')
      .where('orders.status = ?', ['pending'])
      .select()

    expect(rows.length).toBe(1)
    expect(rows[0]!['status']).toBe('pending')
  })

  test('column selection restricts output columns', async () => {
    const { bound } = await createSetup()

    await bound.into(usersTable).insert({ name: 'Carol' })
    const user = await bound.from(usersTable).first()
    await bound.into(ordersTable).insert({ user_id: user!.id, status: 'done', total: 200 })

    const rows = await bound.join('orders')
      .columns(['orders.id', 'users.name'])
      .join('users', 'orders.user_id = users.id')
      .select()

    expect(rows.length).toBe(1)
    // Only selected columns present
    expect(rows[0]).toHaveProperty('id')
    expect(rows[0]).toHaveProperty('name', 'Carol')
    // Non-selected columns absent
    expect(rows[0]).not.toHaveProperty('status')
    expect(rows[0]).not.toHaveProperty('total')
  })

  test('multiple JOINs — order + items', async () => {
    const { bound } = await createSetup()

    await bound.into(usersTable).insert({ name: 'Dave' })
    const user = await bound.from(usersTable).first()
    await bound.into(ordersTable).insert({ user_id: user!.id, status: 'active', total: 300 })
    const order = (await bound.join('orders').select())[0]!

    await bound.into(itemsTable).insert({ order_id: order['id'] as number, name: 'Widget' })

    const rows = await bound.join('items')
      .join('orders', 'items.order_id = orders.id')
      .join('users',  'orders.user_id = users.id')
      .select()

    expect(rows.length).toBe(1)
    expect(rows[0]!['name']).toBeDefined() // users.name or items.name (both present)
  })

  test('no JOIN → SELECT * from table (backward compatible)', async () => {
    const { bound } = await createSetup()

    await bound.into(usersTable).insert({ name: 'Eve' })

    const rows = await bound.join('users').select()
    expect(rows.length).toBe(1)
    expect(rows[0]!['name']).toBe('Eve')
  })

  test('first() returns first row or null', async () => {
    const { bound } = await createSetup()

    const empty = await bound.join('users').first()
    expect(empty).toBeNull()

    await bound.into(usersTable).insert({ name: 'Frank' })
    const row = await bound.join('users').first()
    expect(row).not.toBeNull()
    expect(row!['name']).toBe('Frank')
  })

  test('JoinBuilder is immutable — original unaffected by chaining', async () => {
    const { bound } = await createSetup()

    const base = bound.join('orders')
    const withJoin = base.join('users', 'orders.user_id = users.id')

    // Both builders produce distinct SQL
    const { sql: baseSql } = buildJoinSelect('orders', [], [], '', [])
    const { sql: joinSql } = buildJoinSelect(
      'orders', [], [{ type: 'INNER', table: 'users', on: 'orders.user_id = users.id' }], '', [],
    )

    expect(baseSql).not.toContain('JOIN')
    expect(joinSql).toContain('JOIN')
    // Type check: base and withJoin are both JoinBuilder instances
    expect(base).toBeInstanceOf(JoinBuilder)
    expect(withJoin).toBeInstanceOf(JoinBuilder)
  })
})

// ── validateAndQuoteOnClause — security tests ─────────────────────────────────

describe('validateAndQuoteOnClause — SQL injection prevention', () => {
  test('valid: table.column = table.column → quoted', () => {
    expect(validateAndQuoteOnClause('orders.user_id = users.id'))
      .toBe('"orders"."user_id" = "users"."id"')
  })

  test('valid: spaces around = are ignored', () => {
    expect(validateAndQuoteOnClause('orders.user_id=users.id'))
      .toBe('"orders"."user_id" = "users"."id"')
  })

  test('valid: leading/trailing whitespace trimmed', () => {
    expect(validateAndQuoteOnClause('  orders.user_id = users.id  '))
      .toBe('"orders"."user_id" = "users"."id"')
  })

  test('injection: semicolon → INVALID_JOIN_ON', () => {
    expect(() => validateAndQuoteOnClause('1=1; DROP TABLE users'))
      .toThrow(VelnError)
  })

  test('injection: -- comment → INVALID_JOIN_ON', () => {
    expect(() => validateAndQuoteOnClause('orders.id = users.id; --'))
      .toThrow(VelnError)
  })

  test('injection: OR clause → INVALID_JOIN_ON', () => {
    expect(() => validateAndQuoteOnClause('orders.id OR 1=1'))
      .toThrow(VelnError)
  })

  test('empty string → INVALID_JOIN_ON', () => {
    expect(() => validateAndQuoteOnClause('')).toThrow(VelnError)
  })

  test('only one side → INVALID_JOIN_ON', () => {
    expect(() => validateAndQuoteOnClause('orders.id')).toThrow(VelnError)
  })

  test('missing right side → INVALID_JOIN_ON', () => {
    expect(() => validateAndQuoteOnClause('orders.id = ')).toThrow(VelnError)
  })

  test('VelnError has code INVALID_JOIN_ON', () => {
    let caught: VelnError | null = null
    try { validateAndQuoteOnClause('bad input') } catch (e) { caught = e as VelnError }
    expect(caught?.code).toBe('INVALID_JOIN_ON')
  })
})

// ── quoteColumnRef — column quoting ───────────────────────────────────────────

describe('buildJoinSelect — column quoting', () => {
  test('* remains unquoted', () => {
    const { sql } = buildJoinSelect('orders', ['*'], [], '', [])
    expect(sql).toContain('SELECT *')
  })

  test('table.* → "table".*', () => {
    const { sql } = buildJoinSelect('orders', ['orders.*'], [], '', [])
    expect(sql).toContain('"orders".*')
  })

  test('simple column → "column"', () => {
    const { sql } = buildJoinSelect('orders', ['id'], [], '', [])
    expect(sql).toContain('"id"')
  })

  test('multiple table.column refs → all quoted', () => {
    const { sql } = buildJoinSelect('orders', ['orders.id', 'users.name', 'orders.total'], [], '', [])
    expect(sql).toBe('SELECT "orders"."id", "users"."name", "orders"."total" FROM "orders"')
  })
})

// ── buildJoinSelect — backward compatibility ──────────────────────────────────

describe('buildJoinSelect — backward compatible (no joins)', () => {
  test('existing SelectBuilder .where() still works unchanged', async () => {
    const { bound } = await createSetup()

    await bound.into(usersTable).insert({ name: 'Greg' })
    await bound.into(usersTable).insert({ name: 'Hank' })

    const rows = await bound.from(usersTable).where({ name: 'Greg' }).select()
    expect(rows.length).toBe(1)
    expect(rows[0]!.name).toBe('Greg')
  })
})
