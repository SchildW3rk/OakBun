import { describe, test, expect, beforeEach } from 'bun:test'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { HookExecutor } from '../../packages/core/src/hooks/executor'
import { VelnDB, BoundVelnDB } from '../../packages/core/src/db/index'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import type { InferRow } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'

// ── Test schema ────────────────────────────────────────────────────────────

const usersTable = defineTable('users', {
  id:        column.integer().primaryKey(),
  name:      column.text(),
  email:     column.text().unique(),
  role:      column.text().default('user'),
  createdAt: column.timestamp().defaultFn(() => new Date()),
}).build()

type User = InferRow<typeof usersTable.schema>

// ── Setup helpers ──────────────────────────────────────────────────────────

function createSetup() {
  const adapter = new SQLiteAdapter()
  const exec    = new HookExecutor()
  const db      = new VelnDB(adapter, exec)
  const ctx     = { user: { id: 'u-1', role: 'admin' } }
  const bound   = db.withCtx(ctx)
  return { adapter, exec, db, ctx, bound }
}

// ── VelnDB — insert ────────────────────────────────────────────────────────

describe('VelnDB — insert', () => {
  test('inserts and returns full row', async () => {
    const { adapter, bound } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    const user = await bound.into(usersTable).insert({ name: 'Alice', email: 'alice@test.com' })
    expect(user.id).toBeGreaterThan(0)
    expect(user.name).toBe('Alice')
    expect(user.email).toBe('alice@test.com')
    expect(user.role).toBe('user')
    expect(user.createdAt).toBeInstanceOf(Date)
  })

  test('beforeInsert kann data transformieren — transformiertes wird inserted', async () => {
    const { adapter, exec, db } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    exec.registerModuleHook<User, unknown>('users', {
      beforeInsert: (_ctx, data) => ({ ...data, name: data.name?.toUpperCase() }),
    })

    const bound = db.withCtx({})
    const user = await bound.into(usersTable).insert({ name: 'alice', email: 'a@test.com' })
    expect(user.name).toBe('ALICE')
  })

  test('defaultFn wird angewendet für nicht gesetzte Felder', async () => {
    const { adapter, bound } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    // createdAt is not set — defaultFn should apply
    const user = await bound.into(usersTable).insert({ name: 'Bob', email: 'bob@test.com' })
    expect(user.createdAt).toBeInstanceOf(Date)
  })

  test('afterInsert wird gefeuert mit result + originalInput', async () => {
    const { adapter, exec, db } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    let capturedResult: User | null = null
    let capturedInput: Partial<User> | null = null

    exec.registerModuleHook<User, unknown>('users', {
      afterInsert: (_ctx, result, input) => {
        capturedResult = result
        capturedInput = input
      },
    })

    const bound = db.withCtx({})
    const input = { name: 'Carol', email: 'carol@test.com' }
    await bound.into(usersTable).insert(input)

    expect(capturedResult).not.toBeNull()
    expect(capturedResult!.name).toBe('Carol')
    expect(capturedInput!.name).toBe('Carol')
  })

  test('beforeInsert wirft → kein INSERT, afterInsert nicht gefeuert', async () => {
    const { adapter, exec, db } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    let afterCalled = false
    exec.registerModuleHook<User, unknown>('users', {
      beforeInsert: () => { throw new Error('Forbidden') },
      afterInsert: () => { afterCalled = true },
    })

    const bound = db.withCtx({})
    await expect(
      bound.into(usersTable).insert({ name: 'X', email: 'x@test.com' })
    ).rejects.toThrow('Forbidden')

    // No rows inserted
    const rows = await bound.from(usersTable).select()
    expect(rows.length).toBe(0)
    expect(afterCalled).toBe(false)
  })
})

// ── VelnDB — select ────────────────────────────────────────────────────────

describe('VelnDB — select', () => {
  test('select() gibt [] wenn keine rows', async () => {
    const { adapter, bound } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    const rows = await bound.from(usersTable).select()
    expect(rows).toEqual([])
  })

  test('select() gibt alle rows zurück', async () => {
    const { adapter, bound } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    await bound.into(usersTable).insert({ name: 'Alice', email: 'alice@test.com' })
    await bound.into(usersTable).insert({ name: 'Bob', email: 'bob@test.com' })

    const rows = await bound.from(usersTable).select()
    expect(rows.length).toBe(2)
  })

  test('first() gibt null wenn nicht gefunden', async () => {
    const { adapter, bound } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    const result = await bound.from(usersTable).where({ name: 'Nobody' }).first()
    expect(result).toBeNull()
  })

  test('first() gibt row zurück', async () => {
    const { adapter, bound } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    await bound.into(usersTable).insert({ name: 'Alice', email: 'alice@test.com' })
    const result = await bound.from(usersTable).where({ name: 'Alice' }).first()
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Alice')
  })

  test('.where() filtert korrekt', async () => {
    const { adapter, bound } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    await bound.into(usersTable).insert({ name: 'Alice', email: 'alice@test.com' })
    await bound.into(usersTable).insert({ name: 'Bob', email: 'bob@test.com' })

    const rows = await bound.from(usersTable).where({ name: 'Alice' }).select()
    expect(rows.length).toBe(1)
    expect(rows[0].name).toBe('Alice')
  })

  test('.where() mit undefined Wert — ignoriert, kein Filter', async () => {
    const { adapter, bound } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    await bound.into(usersTable).insert({ name: 'Alice', email: 'alice@test.com' })
    await bound.into(usersTable).insert({ name: 'Bob', email: 'bob@test.com' })

    // undefined role means no filter on role — all rows returned
    const rows = await bound.from(usersTable).where({ role: undefined }).select()
    expect(rows.length).toBe(2)
  })
})

// ── VelnDB — update ────────────────────────────────────────────────────────

describe('VelnDB — update', () => {
  test('update() happy path — updated row zurückgegeben', async () => {
    const { adapter, bound } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    const user = await bound.into(usersTable).insert({ name: 'Alice', email: 'alice@test.com' })
    const updated = await bound.from(usersTable).where({ id: user.id }).update({ name: 'Alice Updated' })

    expect(updated.id).toBe(user.id)
    expect(updated.name).toBe('Alice Updated')
  })

  test('beforeUpdate kann patch transformieren', async () => {
    const { adapter, exec, db } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    exec.registerModuleHook<User, unknown>('users', {
      beforeUpdate: (_ctx, _current, patch) => ({ ...patch, name: patch.name?.toUpperCase() }),
    })

    const bound = db.withCtx({})
    const user = await bound.into(usersTable).insert({ name: 'Alice', email: 'alice@test.com' })
    const updated = await bound.from(usersTable).where({ id: user.id }).update({ name: 'alice updated' })

    expect(updated.name).toBe('ALICE UPDATED')
  })

  test('afterUpdate erhält before + after snapshot', async () => {
    const { adapter, exec, db } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    let capturedBefore: User | null = null
    let capturedResult: User | null = null

    exec.registerModuleHook<User, unknown>('users', {
      afterUpdate: (_ctx, result, before) => {
        capturedResult = result
        capturedBefore = before
      },
    })

    const bound = db.withCtx({})
    const user = await bound.into(usersTable).insert({ name: 'Alice', email: 'alice@test.com' })
    await bound.from(usersTable).where({ id: user.id }).update({ name: 'Alice Updated' })

    expect(capturedBefore!.name).toBe('Alice')
    expect(capturedResult!.name).toBe('Alice Updated')
  })

  test('beforeUpdate wirft → kein UPDATE', async () => {
    const { adapter, exec, db } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    exec.registerModuleHook<User, unknown>('users', {
      beforeUpdate: () => { throw new Error('Update forbidden') },
    })

    const bound = db.withCtx({})
    const user = await bound.into(usersTable).insert({ name: 'Alice', email: 'alice@test.com' })

    await expect(
      bound.from(usersTable).where({ id: user.id }).update({ name: 'Hacker' })
    ).rejects.toThrow('Update forbidden')

    // Name should be unchanged
    const current = await bound.from(usersTable).where({ id: user.id }).first()
    expect(current!.name).toBe('Alice')
  })

  test('update() ohne where wirft', async () => {
    const { adapter, bound } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    await expect(
      bound.from(usersTable).update({ name: 'Danger' })
    ).rejects.toThrow('update() requires .where() conditions')
  })
})

// ── VelnDB — delete ────────────────────────────────────────────────────────

describe('VelnDB — delete', () => {
  test('delete() happy path — deleted entity zurückgegeben', async () => {
    const { adapter, bound } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    const user = await bound.into(usersTable).insert({ name: 'Alice', email: 'alice@test.com' })
    const deleted = await bound.from(usersTable).where({ id: user.id }).delete()

    expect(deleted.id).toBe(user.id)
    expect(deleted.name).toBe('Alice')

    const rows = await bound.from(usersTable).select()
    expect(rows.length).toBe(0)
  })

  test('beforeDelete wird gefeuert', async () => {
    const { adapter, exec, db } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    let beforeCalled = false
    exec.registerModuleHook<User, unknown>('users', {
      beforeDelete: (_ctx, _current) => { beforeCalled = true },
    })

    const bound = db.withCtx({})
    const user = await bound.into(usersTable).insert({ name: 'Alice', email: 'alice@test.com' })
    await bound.from(usersTable).where({ id: user.id }).delete()

    expect(beforeCalled).toBe(true)
  })

  test('afterDelete erhält deleted entity', async () => {
    const { adapter, exec, db } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    let capturedDeleted: User | null = null
    exec.registerModuleHook<User, unknown>('users', {
      afterDelete: (_ctx, deleted) => { capturedDeleted = deleted },
    })

    const bound = db.withCtx({})
    const user = await bound.into(usersTable).insert({ name: 'Alice', email: 'alice@test.com' })
    await bound.from(usersTable).where({ id: user.id }).delete()

    expect(capturedDeleted).not.toBeNull()
    expect(capturedDeleted!.name).toBe('Alice')
  })

  test('beforeDelete wirft → kein DELETE', async () => {
    const { adapter, exec, db } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    exec.registerModuleHook<User, unknown>('users', {
      beforeDelete: () => { throw new Error('Delete forbidden') },
    })

    const bound = db.withCtx({})
    const user = await bound.into(usersTable).insert({ name: 'Alice', email: 'alice@test.com' })

    await expect(
      bound.from(usersTable).where({ id: user.id }).delete()
    ).rejects.toThrow('Delete forbidden')

    // Row should still exist
    const rows = await bound.from(usersTable).select()
    expect(rows.length).toBe(1)
  })

  test('delete() ohne where wirft', async () => {
    const { adapter, bound } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    await expect(
      bound.from(usersTable).delete()
    ).rejects.toThrow('delete() requires .where() conditions')
  })
})

// ── VelnDB — transaction ───────────────────────────────────────────────────

describe('VelnDB — transaction', () => {
  test('transaction commit — alle ops durch, result korrekt', async () => {
    const { adapter, bound } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    const { result } = await bound.transaction(async (tx) => {
      return tx.into(usersTable).insert({ name: 'TX User', email: 'tx@test.com' })
    })

    expect(result.name).toBe('TX User')

    // Committed — row should be visible outside tx
    const rows = await bound.from(usersTable).select()
    expect(rows.length).toBe(1)
  })

  test('transaction rollback — wirft, keine Daten committed', async () => {
    const { adapter, bound } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    await expect(
      bound.transaction(async (tx) => {
        await tx.into(usersTable).insert({ name: 'TX User', email: 'tx@test.com' })
        throw new Error('Rollback!')
      })
    ).rejects.toThrow('Rollback!')

    // Nothing committed
    const rows = await bound.from(usersTable).select()
    expect(rows.length).toBe(0)
  })

  test('transaction gibt { result, events: [] } zurück', async () => {
    const { adapter, bound } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    const txResult = await bound.transaction(async (tx) => {
      return tx.into(usersTable).insert({ name: 'TX User', email: 'tx@test.com' })
    })

    expect(txResult).toHaveProperty('result')
    expect(txResult).toHaveProperty('events')
    expect(txResult.events).toEqual([])
  })
})

// ── VelnDB — hook order ────────────────────────────────────────────────────

describe('VelnDB — hook order', () => {
  test('table-level hooks laufen vor module-level hooks', async () => {
    const order: string[] = []

    // Table with a table-level beforeInsert hook
    const orderedTable = defineTable('ordered', {
      id:   column.integer().primaryKey(),
      name: column.text(),
    })
      .hook({
        beforeInsert: (data) => {
          order.push('table')
          return data
        },
      })
      .build()

    type OrderedRow = InferRow<typeof orderedTable.schema>

    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(orderedTable))

    const exec = new HookExecutor()
    exec.registerModuleHook<OrderedRow, unknown>('ordered', {
      beforeInsert: (_ctx, data) => {
        order.push('module')
        return data
      },
    })

    const db    = new VelnDB(adapter, exec)
    const bound = db.withCtx({})

    await bound.into(orderedTable).insert({ name: 'Test' })

    expect(order).toEqual(['table', 'module'])
  })
})

// ── INSERT RETURNING * — single round-trip (no N+1) ───────────────────────────

describe('InsertBuilder — no N+1 (INSERT RETURNING *)', () => {
  test('insert() makes exactly 1 query call (INSERT RETURNING *, no follow-up SELECT)', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))

    // Count adapter.query() calls
    let queryCalls = 0
    const originalQuery = adapter.query.bind(adapter)
    ;(adapter as unknown as { query: typeof adapter.query }).query = async (sql, params) => {
      queryCalls++
      return originalQuery(sql, params)
    }

    const exec  = new HookExecutor()
    const db    = new VelnDB(adapter, exec)
    const bound = db.withCtx({})

    await bound.into(usersTable).insert({ name: 'Alice', email: 'alice@n1test.com' })

    expect(queryCalls).toBe(1)
  })

  test('inserted row is returned with all fields populated', async () => {
    const { bound, adapter } = createSetup()
    await adapter.execute(toCreateTableSql(usersTable))

    const user = await bound.into(usersTable).insert({ name: 'Bob', email: 'bob@n1test.com' })
    expect(user.id).toBeDefined()
    expect(user.name).toBe('Bob')
    expect(user.email).toBe('bob@n1test.com')
    expect(user.role).toBe('user')  // default value applied
  })
})
