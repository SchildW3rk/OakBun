import { describe, test, expect } from 'bun:test'
import { PostgresAdapter } from '../../packages/core/src/adapter/postgres'
import type { PostgresConfig } from '../../packages/core/src/adapter/postgres'
import type { OakBunAdapter } from '../../packages/core/src/adapter/types'

// ── Compile-time + instantiation tests (no real DB needed) ────────────────

describe('PostgresAdapter — instantiation', () => {
  test('instantiates with a config object', () => {
    const config: PostgresConfig = { url: 'postgres://user:pass@localhost:5432/test' }
    // We only verify the constructor runs without throwing a JS error.
    // Bun.SQL defers the actual connection until the first query.
    expect(() => new PostgresAdapter(config)).not.toThrow()
  })

  test('accepts optional max and idleTimeout', () => {
    const config: PostgresConfig = {
      url: 'postgres://user:pass@localhost:5432/test',
      max: 5,
      idleTimeout: 60,
    }
    expect(() => new PostgresAdapter(config)).not.toThrow()
  })

  test('implements OakBunAdapter interface (duck-type)', () => {
    const adapter = new PostgresAdapter({ url: 'postgres://user:pass@localhost:5432/test' })
    // All four methods must exist and be functions
    expect(typeof adapter.query).toBe('function')
    expect(typeof adapter.execute).toBe('function')
    expect(typeof adapter.transaction).toBe('function')
    expect(typeof adapter.close).toBe('function')
  })

  test('is assignable to OakBunAdapter', () => {
    // This test is compile-time only — if it type-checks, the assignment is valid.
    const adapter: OakBunAdapter = new PostgresAdapter({ url: 'postgres://localhost/test' })
    expect(adapter).toBeDefined()
  })
})

describe('PostgresAdapter — close idempotency', () => {
  test('close() can be called multiple times without throwing', async () => {
    const adapter = new PostgresAdapter({ url: 'postgres://user:pass@localhost:5432/test' })
    // Bun.SQL defers connection — close() on a never-connected adapter must not reject
    await expect(adapter.close()).resolves.toBeUndefined()
    await expect(adapter.close()).resolves.toBeUndefined()
  })
})

// ── Tests that require a real Postgres server ──────────────────────────────

describe('PostgresAdapter — query', () => {
  test.skip('returns rows from SELECT — requires postgres', async () => {
    // requires postgres
    const adapter = new PostgresAdapter({ url: process.env['DATABASE_URL'] ?? '' })
    const rows = await adapter.query('SELECT 1 AS n')
    expect(rows).toHaveLength(1)
    await adapter.close()
  })

  test.skip('binds params correctly — requires postgres', async () => {
    // requires postgres
    const adapter = new PostgresAdapter({ url: process.env['DATABASE_URL'] ?? '' })
    const rows = await adapter.query<{ n: number }>('SELECT $1::int AS n', [42])
    expect(rows[0]?.n).toBe(42)
    await adapter.close()
  })
})

describe('PostgresAdapter — execute', () => {
  test.skip('returns rowsAffected on INSERT — requires postgres', async () => {
    // requires postgres
  })
})

describe('PostgresAdapter — transaction', () => {
  test.skip('commits on success — requires postgres', async () => {
    // requires postgres
  })

  test.skip('rolls back on error — requires postgres', async () => {
    // requires postgres
  })
})

describe('PostgresAdapter — unhappy paths (no DB)', () => {
  test.skip('query() with empty SQL throws — requires postgres', async () => {
    // requires postgres
    const adapter = new PostgresAdapter({ url: process.env['DATABASE_URL'] ?? '' })
    await expect(adapter.query('')).rejects.toThrow()
    await adapter.close()
  })

  test.skip('execute() on invalid SQL throws — requires postgres', async () => {
    // requires postgres
    const adapter = new PostgresAdapter({ url: process.env['DATABASE_URL'] ?? '' })
    await expect(adapter.execute('SELEKT 1')).rejects.toThrow()
    await adapter.close()
  })
})
