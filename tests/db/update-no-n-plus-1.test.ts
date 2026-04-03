import { describe, test, expect } from 'bun:test'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { HookExecutor } from '../../packages/core/src/hooks/executor'
import { VelnDB } from '../../packages/core/src/db/index'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import type { InferRow } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'
import type { VelnAdapter, BindingValue, ExecuteResult } from '../../packages/core/src/adapter/types'

const itemsTable = defineTable('items', {
  id:    column.integer().primaryKey(),
  name:  column.text(),
  value: column.integer().default(0),
}).build()

type Item = InferRow<typeof itemsTable.schema>

// ── Mock adapter that counts calls ────────────────────────────────────────────

class CountingAdapter implements VelnAdapter {
  private readonly inner: SQLiteAdapter
  public queryCalls   = 0
  public executeCalls = 0

  constructor(inner: SQLiteAdapter) {
    this.inner = inner
  }

  async query<T>(sql: string, params?: BindingValue[]): Promise<T[]> {
    this.queryCalls++
    return this.inner.query<T>(sql, params)
  }

  async execute(sql: string, params?: BindingValue[]): Promise<ExecuteResult> {
    this.executeCalls++
    return this.inner.execute(sql, params)
  }

  async transaction<T>(fn: (adapter: VelnAdapter) => Promise<T>): Promise<T> {
    return this.inner.transaction((txAdapter) => fn(new CountingAdapter(txAdapter as SQLiteAdapter)))
  }
}

describe('update() — no N+1 query', () => {
  test('update() calls adapter.execute once and adapter.query once after optimization', async () => {
    const sqlite  = new SQLiteAdapter()
    const counter = new CountingAdapter(sqlite)
    const exec    = new HookExecutor()
    const db      = new VelnDB(counter, exec)
    const bound   = db.withCtx({})

    await sqlite.execute(toCreateTableSql(itemsTable))
    const item = await bound.into(itemsTable).insert({ name: 'Widget', value: 10 })

    // Reset counts after insert
    counter.queryCalls   = 0
    counter.executeCalls = 0

    const updated = await bound.from(itemsTable).where({ id: item.id }).update({ name: 'Updated Widget' })

    // Should be: 1 query (SELECT for current row) + 1 execute (UPDATE)
    // Previously was: 1 query + 1 execute + 1 query (second SELECT) = 2 queries
    expect(counter.executeCalls).toBe(1)  // only the UPDATE
    expect(counter.queryCalls).toBe(1)    // only the initial SELECT to load current row
    expect(updated.name).toBe('Updated Widget')
    expect(updated.value).toBe(10)        // unchanged field preserved correctly
    expect(updated.id).toBe(item.id)
  })

  test('update() returns correct merged row — existing fields preserved', async () => {
    const sqlite  = new SQLiteAdapter()
    const exec    = new HookExecutor()
    const db      = new VelnDB(sqlite, exec)
    const bound   = db.withCtx({})

    await sqlite.execute(toCreateTableSql(itemsTable))
    const item = await bound.into(itemsTable).insert({ name: 'Alpha', value: 42 })

    const updated = await bound.from(itemsTable).where({ id: item.id }).update({ value: 99 })

    expect(updated.id).toBe(item.id)
    expect(updated.name).toBe('Alpha')   // unchanged
    expect(updated.value).toBe(99)       // patched
  })

  test('update() with no matching row → throws Record not found', async () => {
    const sqlite = new SQLiteAdapter()
    const exec   = new HookExecutor()
    const db     = new VelnDB(sqlite, exec)
    const bound  = db.withCtx({})

    await sqlite.execute(toCreateTableSql(itemsTable))

    await expect(
      bound.from(itemsTable).where({ id: 9999 }).update({ name: 'Ghost' })
    ).rejects.toThrow('Record not found for update')
  })

  test('update() with beforeUpdate hook that transforms patch — result uses transformed values', async () => {
    const sqlite = new SQLiteAdapter()
    const exec   = new HookExecutor()
    exec.registerModuleHook<Item, unknown>('items', {
      beforeUpdate: (_ctx, _current, patch) => ({ ...patch, name: patch.name?.toUpperCase() }),
    })

    const db    = new VelnDB(sqlite, exec)
    const bound = db.withCtx({})

    await sqlite.execute(toCreateTableSql(itemsTable))
    const item = await bound.into(itemsTable).insert({ name: 'original', value: 1 })

    const updated = await bound.from(itemsTable).where({ id: item.id }).update({ name: 'updated' })
    expect(updated.name).toBe('UPDATED')  // hook transformed the patch
  })
})
