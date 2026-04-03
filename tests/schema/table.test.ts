import { describe, test, expect } from 'bun:test'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import type { InferTableEvents } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'

const users = defineTable('users', {
  id:        column.integer().primaryKey(),
  name:      column.text(),
  email:     column.text().unique(),
  role:      column.text().default('user'),
  bio:       column.text().nullable(),
  createdAt: column.timestamp().defaultFn(() => new Date()),
}).build()

describe('defineTable — structure', () => {
  // ── Happy path ────────────────────────────────────────────────

  test('table has correct name', () => {
    expect(users.name).toBe('users')
  })

  test('primaryKey is detected from schema', () => {
    expect(users.primaryKey).toBe('id')
  })

  test('schema columns are accessible', () => {
    expect(users.schema.id.def.primaryKey).toBe(true)
    expect(users.schema.email.def.unique).toBe(true)
    expect(users.schema.role.def.defaultValue).toBe('user')
    expect(users.schema.bio.def.nullable).toBe(true)
    expect(users.schema.createdAt.def.defaultFn).toBeFunction()
  })

  test('hooks array starts empty', () => {
    expect(users.hooks).toHaveLength(0)
  })

  test('hooks array is immutable between builds', () => {
    const t1 = defineTable('t1', { id: column.integer().primaryKey() }).build()
    const t2 = defineTable('t2', { id: column.integer().primaryKey() }).build()
    t1.hooks.push({})  // mutate t1
    expect(t2.hooks).toHaveLength(0)  // t2 unaffected
  })

  // ── Unhappy path ──────────────────────────────────────────────

  test('falls back to "id" when no PK defined', () => {
    const t = defineTable('no_pk', { name: column.text() }).build()
    expect(t.primaryKey).toBe('id')
  })
})

describe('defineTable — table-level hooks', () => {
  test('.hook() registers handlers', () => {
    const t = defineTable('t', { id: column.integer().primaryKey() })
      .hook({ beforeInsert: async (d) => d })
      .hook({ afterInsert: async () => {} })
      .build()
    expect(t.hooks).toHaveLength(2)
  })

  test('multiple .hook() calls stack in order', () => {
    const order: number[] = []
    const t = defineTable('t', { id: column.integer().primaryKey() })
      .hook({ beforeInsert: (d) => { order.push(1); return d } })
      .hook({ beforeInsert: (d) => { order.push(2); return d } })
      .hook({ beforeInsert: (d) => { order.push(3); return d } })
      .build()

    // Simulate running them in order
    for (const h of t.hooks) h.beforeInsert?.({})
    expect(order).toEqual([1, 2, 3])
  })
})

describe('toCreateTableSql', () => {
  // ── Happy path ────────────────────────────────────────────────

  test('generates CREATE TABLE IF NOT EXISTS', () => {
    const sql = toCreateTableSql(users)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS')
    expect(sql).toContain('"users"')
  })

  test('generates INTEGER PRIMARY KEY AUTOINCREMENT for integer PK', () => {
    const sql = toCreateTableSql(users)
    expect(sql).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT')
  })

  test('generates NOT NULL for non-nullable columns', () => {
    const sql = toCreateTableSql(users)
    expect(sql).toContain('"name" TEXT NOT NULL')
  })

  test('does NOT add NOT NULL for nullable columns', () => {
    const sql = toCreateTableSql(users)
    // bio is nullable — should not have NOT NULL
    expect(sql).toMatch(/"bio" TEXT(?! NOT NULL)/)
  })

  test('generates UNIQUE for unique columns', () => {
    const sql = toCreateTableSql(users)
    expect(sql).toContain('"email" TEXT NOT NULL UNIQUE')
  })

  test('generated SQL is executable on SQLite', async () => {
    const db = new SQLiteAdapter(':memory:')
    const sql = toCreateTableSql(users)
    await expect(db.execute(sql)).resolves.toBeDefined()
    await db.close()
  })

  // ── Unhappy path ──────────────────────────────────────────────

  test('does not crash on table with no columns (edge case)', () => {
    const t = defineTable('empty', {}).build()
    expect(() => toCreateTableSql(t)).not.toThrow()
  })
})

describe('defineTable — .emits()', () => {
  test('table.events ist {} wenn .emits() nicht aufgerufen', () => {
    const t = defineTable('t', { id: column.integer().primaryKey() }).build()
    expect(t.events).toEqual({})
  })

  test('.emits() speichert event map in table.events', () => {
    const t = defineTable('t', { id: column.integer().primaryKey() })
      .emits({ afterInsert: 't.created', afterUpdate: 't.updated', afterDelete: 't.deleted' })
      .build()
    expect(t.events.afterInsert).toBe('t.created')
    expect(t.events.afterUpdate).toBe('t.updated')
    expect(t.events.afterDelete).toBe('t.deleted')
  })

  test('partial emits — nur afterInsert, rest undefined', () => {
    const t = defineTable('t', { id: column.integer().primaryKey() })
      .emits({ afterInsert: 'only.insert' })
      .build()
    expect(t.events.afterInsert).toBe('only.insert')
    expect(t.events.afterUpdate).toBeUndefined()
    expect(t.events.afterDelete).toBeUndefined()
  })

  test('.emits() + .hook() zusammen funktionieren — Reihenfolge egal', () => {
    const hookFired: string[] = []
    const t = defineTable('t', { id: column.integer().primaryKey() })
      .hook({ beforeInsert: (d) => { hookFired.push('hook'); return d } })
      .emits({ afterInsert: 't.created' })
      .build()
    expect(t.hooks).toHaveLength(1)
    expect(t.events.afterInsert).toBe('t.created')
    // Run the hook to confirm it still works
    t.hooks[0]!.beforeInsert?.({})
    expect(hookFired).toEqual(['hook'])
  })

  test('InferTableEvents leitet afterInsert-Payload als T ab', () => {
    type User = { id: number; name: string }
    type M = { afterInsert: 'user.created' }
    type Events = InferTableEvents<User, M>

    // TypeScript compile-time check: Events['user.created'] should be User
    type Payload = Events['user.created']
    const check: Payload = { id: 1, name: 'Alice' }
    expect(check.id).toBe(1)
  })

  test('InferTableEvents leitet afterUpdate-Payload als { before: T; after: T } ab', () => {
    type User = { id: number; name: string }
    type M = { afterUpdate: 'user.updated' }
    type Events = InferTableEvents<User, M>

    // TypeScript compile-time check: Events['user.updated'] should be { before: User; after: User }
    type Payload = Events['user.updated']
    const check: Payload = { before: { id: 1, name: 'Old' }, after: { id: 1, name: 'New' } }
    expect(check.before.name).toBe('Old')
    expect(check.after.name).toBe('New')
  })
})
