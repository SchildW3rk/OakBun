import { describe, test, expect } from 'bun:test'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { HookExecutor } from '../../packages/core/src/hooks/executor'
import { VelnDB, BoundVelnDB } from '../../packages/core/src/db/index'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import type { InferRow } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'
import type { VelnAdapter } from '../../packages/core/src/adapter/types'

// ── Test schema ────────────────────────────────────────────────────────────

const usersTable = defineTable('users', {
  id:   column.integer().primaryKey(),
  name: column.text(),
  role: column.text().default('user'),
}).build()

type User = InferRow<typeof usersTable.schema>

// ── Setup helpers ──────────────────────────────────────────────────────────

function createSetup() {
  const adapter = new SQLiteAdapter()
  const exec    = new HookExecutor()
  const db      = new VelnDB(adapter, exec)
  const bound   = db.withCtx({})
  return { adapter, exec, db, bound }
}

async function seedUsers(bound: BoundVelnDB, adapter: SQLiteAdapter): Promise<User[]> {
  await adapter.execute(toCreateTableSql(usersTable))
  return Promise.all([
    bound.into(usersTable).insert({ name: 'Alice', role: 'user' }),
    bound.into(usersTable).insert({ name: 'Bob',   role: 'user' }),
    bound.into(usersTable).insert({ name: 'Carol', role: 'user' }),
  ])
}

// ── Happy Path ─────────────────────────────────────────────────────────────

describe('updateMany — happy path', () => {
  test('returns empty array when called with []', async () => {
    const { adapter, bound } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    const result = await bound.from(usersTable).updateMany([])
    expect(result).toEqual([])
    const typed: User[] = result
    expect(typed).toHaveLength(0)
  })

  test('updates 1 row and returns updated User', async () => {
    const { adapter, bound } = createSetup()
    const [alice] = await seedUsers(bound, adapter)

    const result = await bound.from(usersTable).updateMany([
      { id: alice!.id, name: 'Alice Updated' },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe(alice!.id)
    expect(result[0]!.name).toBe('Alice Updated')
    expect(result[0]!.role).toBe('user') // unchanged
  })

  test('updates 3 rows with different patches', async () => {
    const { adapter, bound } = createSetup()
    const [alice, bob, carol] = await seedUsers(bound, adapter)

    const result = await bound.from(usersTable).updateMany([
      { id: alice!.id, name: 'Alice New' },
      { id: bob!.id,   role: 'admin' },
      { id: carol!.id, name: 'Carol New', role: 'mod' },
    ])

    expect(result).toHaveLength(3)
    expect(result[0]!.name).toBe('Alice New')
    expect(result[0]!.role).toBe('user')   // unchanged
    expect(result[1]!.name).toBe('Bob')    // unchanged
    expect(result[1]!.role).toBe('admin')
    expect(result[2]!.name).toBe('Carol New')
    expect(result[2]!.role).toBe('mod')
  })

  test('wraps all updates in a single transaction', async () => {
    const sqliteAdapter = new SQLiteAdapter()
    await sqliteAdapter.execute(toCreateTableSql(usersTable))

    let transactionCallCount = 0
    const wrappedAdapter: VelnAdapter = {
      query:   (sql, params) => sqliteAdapter.query(sql, params),
      execute: (sql, params) => sqliteAdapter.execute(sql, params),
      transaction: async (fn) => {
        transactionCallCount++
        return sqliteAdapter.transaction(fn)
      },
      close: () => sqliteAdapter.close(),
    }

    const exec  = new HookExecutor()
    const bound = new BoundVelnDB(wrappedAdapter, exec, {})

    // Seed via the real adapter (outside the wrapped one)
    const exec2 = new HookExecutor()
    const realBound = new BoundVelnDB(sqliteAdapter, exec2, {})
    const [alice, bob, carol] = await Promise.all([
      realBound.into(usersTable).insert({ name: 'Alice', role: 'user' }),
      realBound.into(usersTable).insert({ name: 'Bob',   role: 'user' }),
      realBound.into(usersTable).insert({ name: 'Carol', role: 'user' }),
    ])

    await bound.from(usersTable).updateMany([
      { id: alice!.id, name: 'A' },
      { id: bob!.id,   name: 'B' },
      { id: carol!.id, name: 'C' },
    ])

    expect(transactionCallCount).toBe(1)
  })

  test('patch only updates specified fields — other fields unchanged', async () => {
    const { adapter, bound } = createSetup()
    const [alice] = await seedUsers(bound, adapter)

    const result = await bound.from(usersTable).updateMany([
      { id: alice!.id, name: 'New Name' },
      // role is intentionally omitted
    ])

    expect(result[0]!.name).toBe('New Name')
    expect(result[0]!.role).toBe('user') // not clobbered
  })

  test('beforeUpdate and afterUpdate hooks run per row', async () => {
    const { adapter, exec, db } = createSetup()
    const bound = db.withCtx({})
    const [alice, bob, carol] = await seedUsers(bound, adapter)

    const beforeCalls: number[] = []
    const afterCalls:  number[] = []

    exec.registerModuleHook<User, unknown>('users', {
      beforeUpdate: (_ctx, _current, patch) => {
        beforeCalls.push(beforeCalls.length + 1)
        return patch
      },
      afterUpdate: (_ctx, _result, _before) => {
        afterCalls.push(afterCalls.length + 1)
      },
    })

    const bound2 = db.withCtx({})
    await bound2.from(usersTable).updateMany([
      { id: alice!.id, name: 'A' },
      { id: bob!.id,   name: 'B' },
      { id: carol!.id, name: 'C' },
    ])

    expect(beforeCalls).toHaveLength(3)
    expect(afterCalls).toHaveLength(3)
  })
})

// ── Unhappy Path ───────────────────────────────────────────────────────────

describe('updateMany — unhappy path', () => {
  test('rolls back all rows if one update throws', async () => {
    const sqliteAdapter = new SQLiteAdapter()
    await sqliteAdapter.execute(toCreateTableSql(usersTable))

    const exec  = new HookExecutor()
    const bound = new BoundVelnDB(sqliteAdapter, exec, {})
    const [alice, bob, carol] = await Promise.all([
      bound.into(usersTable).insert({ name: 'Alice', role: 'user' }),
      bound.into(usersTable).insert({ name: 'Bob',   role: 'user' }),
      bound.into(usersTable).insert({ name: 'Carol', role: 'user' }),
    ])

    // Use a non-existent id for row 3 to force a "record not found" error
    await expect(
      bound.from(usersTable).updateMany([
        { id: alice!.id, name: 'Alice Updated' },
        { id: bob!.id,   name: 'Bob Updated' },
        { id: 99999,     name: 'Ghost' },         // does not exist
      ]),
    ).rejects.toThrow()

    // Alice and Bob must not have been updated — transaction was rolled back
    const aliceAfter = await bound.from(usersTable).where({ id: alice!.id }).first()
    const bobAfter   = await bound.from(usersTable).where({ id: bob!.id }).first()
    expect(aliceAfter!.name).toBe('Alice')
    expect(bobAfter!.name).toBe('Bob')
  })

  test('rolls back if beforeUpdate throws on row 2 — tx rolled back for all rows', async () => {
    const { adapter, exec, db } = createSetup()
    const bound = db.withCtx({})
    const [alice, bob] = await seedUsers(bound, adapter)

    let beforeCallCount = 0
    let afterCallCount  = 0

    exec.registerModuleHook<User, unknown>('users', {
      beforeUpdate: (_ctx, _current, patch) => {
        beforeCallCount++
        if (beforeCallCount === 2) throw new Error('beforeUpdate hook threw on row 2')
        return patch
      },
      afterUpdate: () => { afterCallCount++ },
    })

    const bound2 = db.withCtx({})
    await expect(
      bound2.from(usersTable).updateMany([
        { id: alice!.id, name: 'A' },
        { id: bob!.id,   name: 'B' },
      ]),
    ).rejects.toThrow('beforeUpdate hook threw on row 2')

    // Row 1 ran beforeUpdate + afterUpdate before row 2 threw — that's expected.
    // The important guarantee is that the transaction rolled back everything.
    expect(beforeCallCount).toBe(2)  // got to row 2 before throwing
    expect(afterCallCount).toBe(1)   // only row 1 completed

    // Both Alice and Bob must be unchanged — tx rolled back
    const aliceAfter = await bound.from(usersTable).where({ id: alice!.id }).first()
    const bobAfter   = await bound.from(usersTable).where({ id: bob!.id }).first()
    expect(aliceAfter!.name).toBe('Alice')
    expect(bobAfter!.name).toBe('Bob')
  })

  test('throws if a row is missing its primary key', async () => {
    const { adapter, bound } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    // TypeScript prevents this at compile time; we test the runtime guard
    await expect(
      // @ts-expect-error — intentionally passing a row without PK to test runtime guard
      bound.from(usersTable).updateMany([{ name: 'No ID here' }]),
    ).rejects.toThrow(/primary key/)
  })
})
