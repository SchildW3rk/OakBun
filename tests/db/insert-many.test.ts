import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { HookExecutor } from '../../packages/core/src/hooks/executor'
import { OakBunDB, BoundOakBunDB, InsertBuilder } from '../../packages/core/src/db/index'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import type { InferRow, InferInsert } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'
import type { OakBunAdapter } from '../../packages/core/src/adapter/types'

// ── Test schema ────────────────────────────────────────────────────────────

const usersTable = defineTable('users', {
  id:        column.integer().primaryKey(),
  name:      column.text(),
  email:     column.text().unique(),
  createdAt: column.timestamp().defaultFn(() => new Date()),
}).build()

type User    = InferRow<typeof usersTable.schema>
type NewUser = InferInsert<typeof usersTable>

// ── Setup helpers ──────────────────────────────────────────────────────────

function createSetup() {
  const adapter = new SQLiteAdapter()
  const exec    = new HookExecutor()
  const db      = new OakBunDB(adapter, exec)
  const ctx     = {}
  const bound   = db.withCtx(ctx)
  return { adapter, exec, db, ctx, bound }
}

async function withTable(adapter: SQLiteAdapter): Promise<void> {
  await adapter.execute(toCreateTableSql(usersTable))
}

// ── Happy Path ─────────────────────────────────────────────────────────────

describe('insertMany — happy path', () => {
  test('returns empty array when called with []', async () => {
    const { adapter, bound } = createSetup()
    await withTable(adapter)

    const result = await bound.into(usersTable).insertMany([])
    expect(result).toEqual([])
    expect(result).toHaveLength(0)
    // Return type is User[] — TypeScript would catch this at compile time if wrong
    const typed: User[] = result
    expect(typed).toBeDefined()
  })

  test('inserts 1 row and returns correctly typed User[]', async () => {
    const { adapter, bound } = createSetup()
    await withTable(adapter)

    const result = await bound.into(usersTable).insertMany([
      { name: 'Alice', email: 'alice@example.com' },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBeGreaterThan(0)
    expect(result[0]!.name).toBe('Alice')
    expect(result[0]!.email).toBe('alice@example.com')
    expect(result[0]!.createdAt).toBeInstanceOf(Date)
  })

  test('inserts 3 rows in exactly 1 adapter.query call', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))

    let queryCallCount = 0
    const wrappedAdapter: OakBunAdapter = {
      query: async <T>(sql: string, params?: Parameters<OakBunAdapter['query']>[1]): Promise<T[]> => {
        queryCallCount++
        return adapter.query<T>(sql, params)
      },
      execute:     (sql, params) => adapter.execute(sql, params),
      transaction: (fn)         => adapter.transaction(fn),
      close:       ()           => adapter.close(),
    }

    const exec  = new HookExecutor()
    const bound = new BoundOakBunDB(wrappedAdapter, exec, {})

    await bound.into(usersTable).insertMany([
      { name: 'Alice', email: 'a@example.com' },
      { name: 'Bob',   email: 'b@example.com' },
      { name: 'Carol', email: 'c@example.com' },
    ])

    // Exactly 1 query call — single bulk INSERT
    expect(queryCallCount).toBe(1)
  })

  test('the single INSERT SQL contains 3 VALUES groups', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))

    const capturedSql: string[] = []
    const wrappedAdapter: OakBunAdapter = {
      query: async <T>(sql: string, params?: Parameters<OakBunAdapter['query']>[1]): Promise<T[]> => {
        capturedSql.push(sql)
        return adapter.query<T>(sql, params)
      },
      execute:     (sql, params) => adapter.execute(sql, params),
      transaction: (fn)         => adapter.transaction(fn),
      close:       ()           => adapter.close(),
    }

    const exec  = new HookExecutor()
    const bound = new BoundOakBunDB(wrappedAdapter, exec, {})

    await bound.into(usersTable).insertMany([
      { name: 'Alice', email: 'a@example.com' },
      { name: 'Bob',   email: 'b@example.com' },
      { name: 'Carol', email: 'c@example.com' },
    ])

    expect(capturedSql).toHaveLength(1)
    // Extract VALUES portion and count groups: (…), (…), (…)
    const valuesPart = capturedSql[0]!.split('VALUES')[1] ?? ''
    const groupCount = (valuesPart.match(/\(/g) ?? []).length
    expect(groupCount).toBe(3)
  })

  test('runBeforeInsert called once per row in order', async () => {
    const { adapter, exec, db } = createSetup()
    await withTable(adapter)

    const callArgs: string[] = []
    exec.registerModuleHook<User, unknown>('users', {
      beforeInsert: (_ctx, data) => {
        callArgs.push(data.name ?? '')
        return data
      },
    })

    const bound = db.withCtx({})
    await bound.into(usersTable).insertMany([
      { name: 'First',  email: 'first@example.com' },
      { name: 'Second', email: 'second@example.com' },
      { name: 'Third',  email: 'third@example.com' },
    ])

    expect(callArgs).toHaveLength(3)
    expect(callArgs[0]).toBe('First')
    expect(callArgs[1]).toBe('Second')
    expect(callArgs[2]).toBe('Third')
  })

  test('hook return value is used — not the original row', async () => {
    const { adapter, exec, db } = createSetup()
    await withTable(adapter)

    exec.registerModuleHook<User, unknown>('users', {
      beforeInsert: (_ctx, data) => ({ ...data, name: data.name?.toUpperCase() }),
    })

    const bound = db.withCtx({})
    const result = await bound.into(usersTable).insertMany([
      { name: 'alice', email: 'alice@example.com' },
      { name: 'bob',   email: 'bob@example.com' },
    ])

    expect(result[0]!.name).toBe('ALICE')
    expect(result[1]!.name).toBe('BOB')
  })

  test('defaults applied per row — each row gets its own Date instance', async () => {
    const { adapter, bound } = createSetup()
    await withTable(adapter)

    const result = await bound.into(usersTable).insertMany([
      { name: 'Alice', email: 'a@example.com' },
      { name: 'Bob',   email: 'b@example.com' },
    ])

    expect(result[0]!.createdAt).toBeInstanceOf(Date)
    expect(result[1]!.createdAt).toBeInstanceOf(Date)
    // Each row gets its own Date instance from the defaultFn
    expect(result[0]!.createdAt).not.toBe(result[1]!.createdAt)
  })

  test('timestamps deserialized from ISO string to Date', async () => {
    const { adapter, bound } = createSetup()
    await withTable(adapter)

    const result = await bound.into(usersTable).insertMany([
      { name: 'Alice', email: 'alice@example.com' },
    ])

    expect(result[0]!.createdAt).toBeInstanceOf(Date)
  })

  test('runAfterInsert called once per row with deserialized result', async () => {
    const { adapter, exec, db } = createSetup()
    await withTable(adapter)

    const afterResults: User[] = []
    exec.registerModuleHook<User, unknown>('users', {
      afterInsert: (_ctx, result) => {
        afterResults.push(result)
      },
    })

    const bound = db.withCtx({})
    await bound.into(usersTable).insertMany([
      { name: 'Alice', email: 'a@example.com' },
      { name: 'Bob',   email: 'b@example.com' },
    ])

    expect(afterResults).toHaveLength(2)
    // afterInsert receives deserialized result — createdAt must be Date, not string
    expect(afterResults[0]!.createdAt).toBeInstanceOf(Date)
    expect(afterResults[1]!.createdAt).toBeInstanceOf(Date)
    expect(afterResults[0]!.name).toBe('Alice')
    expect(afterResults[1]!.name).toBe('Bob')
  })
})

// ── Unhappy Path ───────────────────────────────────────────────────────────

describe('insertMany — unhappy path', () => {
  test('throws on MySQL dialect before any query', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))

    let queryCalled = false
    const wrappedAdapter: OakBunAdapter = {
      query: async <T>(sql: string, params?: Parameters<OakBunAdapter['query']>[1]): Promise<T[]> => {
        queryCalled = true
        return adapter.query<T>(sql, params)
      },
      execute:     (sql, params) => adapter.execute(sql, params),
      transaction: (fn)         => adapter.transaction(fn),
      close:       ()           => adapter.close(),
    }

    const exec    = new HookExecutor()
    // Pass dialect='mysql' to BoundOakBunDB
    const bound   = new BoundOakBunDB(wrappedAdapter, exec, {}, undefined, undefined, 'mysql')

    await expect(
      bound.into(usersTable).insertMany([{ name: 'Alice', email: 'a@example.com' }]),
    ).rejects.toThrow('MySQL')

    expect(queryCalled).toBe(false)
  })

  test('throws and does NOT call afterInsert if adapter.query fails', async () => {
    const exec = new HookExecutor()

    let afterInsertCalled = false
    exec.registerModuleHook<User, unknown>('users', {
      afterInsert: () => { afterInsertCalled = true },
    })

    const failingAdapter: OakBunAdapter = {
      query: async () => { throw new Error('DB connection lost') },
      execute:     async () => ({ rowsAffected: 0 }),
      transaction: async (fn) => fn(failingAdapter),
      close:       async () => {},
    }

    const bound = new BoundOakBunDB(failingAdapter, exec, {})

    await expect(
      bound.into(usersTable).insertMany([{ name: 'Alice', email: 'a@example.com' }]),
    ).rejects.toThrow('DB connection lost')

    expect(afterInsertCalled).toBe(false)
  })

  test('throws if runBeforeInsert throws on row 2 — adapter.query not called', async () => {
    const exec = new HookExecutor()

    let callCount = 0
    exec.registerModuleHook<User, unknown>('users', {
      beforeInsert: (_ctx, data) => {
        callCount++
        if (callCount === 2) throw new Error('hook failed on row 2')
        return data
      },
    })

    let queryCalled = false
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))

    const wrappedAdapter: OakBunAdapter = {
      query: async <T>(sql: string, params?: Parameters<OakBunAdapter['query']>[1]): Promise<T[]> => {
        queryCalled = true
        return adapter.query<T>(sql, params)
      },
      execute:     (sql, params) => adapter.execute(sql, params),
      transaction: (fn)         => adapter.transaction(fn),
      close:       ()           => adapter.close(),
    }

    const bound = new BoundOakBunDB(wrappedAdapter, exec, {})

    await expect(
      bound.into(usersTable).insertMany([
        { name: 'Alice', email: 'a@example.com' },
        { name: 'Bob',   email: 'b@example.com' },
        { name: 'Carol', email: 'c@example.com' },
      ]),
    ).rejects.toThrow('hook failed on row 2')

    // Serialization loop runs before the query — query must not have been called
    expect(queryCalled).toBe(false)
  })
})
