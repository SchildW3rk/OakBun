import { describe, test, expect } from 'bun:test'
import { resolveAdapter, isVelnAdapter } from '../../packages/core/src/adapter/resolve'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'

// ── isVelnAdapter ─────────────────────────────────────────────────────────────

describe('isVelnAdapter', () => {
  test('SQLiteAdapter instance → true', () => {
    const adapter = new SQLiteAdapter({ path: ':memory:' })
    expect(isVelnAdapter(adapter)).toBe(true)
  })

  test('plain object without query/execute → false', () => {
    expect(isVelnAdapter({ foo: 'bar' })).toBe(false)
  })

  test('null → false', () => {
    expect(isVelnAdapter(null)).toBe(false)
  })

  test('object with query + execute functions → true', () => {
    const fake = { query: () => {}, execute: () => {} }
    expect(isVelnAdapter(fake)).toBe(true)
  })
})

// ── resolveAdapter ────────────────────────────────────────────────────────────

describe('resolveAdapter', () => {
  test('passes through an existing VelnAdapter', () => {
    const adapter = new SQLiteAdapter({ path: ':memory:' })
    expect(resolveAdapter(adapter)).toBe(adapter)
  })

  test('{ adapter: "sqlite" } creates SQLiteAdapter', () => {
    const adapter = resolveAdapter({ adapter: 'sqlite', path: ':memory:' })
    expect(typeof adapter.query).toBe('function')
    expect(typeof adapter.execute).toBe('function')
  })

  test('{ adapter: "sqlite" } without path uses default', () => {
    // Does not throw — creates an adapter with default path
    const adapter = resolveAdapter({ adapter: 'sqlite' })
    expect(typeof adapter.query).toBe('function')
  })

  test('unknown adapter type throws', () => {
    expect(() =>
      resolveAdapter({ adapter: 'turso' } as any)
    ).toThrow(/unknown adapter type/)
  })
})

// ── createMigrator with AdapterConfig ─────────────────────────────────────────

describe('createMigrator with AdapterConfig', () => {
  test('accepts AdapterConfig and returns Migrator', async () => {
    const { createMigrator } = await import('../../packages/core/src/db/migrations/index')
    const migrator = createMigrator(
      { adapter: 'sqlite', path: ':memory:' },
      { migrationsDir: '/nonexistent' },
    )
    expect(typeof migrator.run).toBe('function')
    expect(typeof migrator.status).toBe('function')
    expect(typeof migrator.rollback).toBe('function')
  })

  test('accepts VelnAdapter instance directly', async () => {
    const { createMigrator } = await import('../../packages/core/src/db/migrations/index')
    const adapter = new SQLiteAdapter({ path: ':memory:' })
    const migrator = createMigrator(adapter, { migrationsDir: '/nonexistent' })
    expect(typeof migrator.run).toBe('function')
  })
})
