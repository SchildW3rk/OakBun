import { describe, test, expect } from 'bun:test'
import { MySQLAdapter } from '../../packages/core/src/adapter/mysql'
import type { MySQLConfig } from '../../packages/core/src/adapter/mysql'
import type { VelnAdapter } from '../../packages/core/src/adapter/types'

// ── Compile-time + instantiation tests (no real DB needed) ────────────────

describe('MySQLAdapter — instantiation', () => {
  test('instantiates with a url config', () => {
    const config: MySQLConfig = { url: 'mysql://root:secret@localhost:3306/test' }
    expect(() => new MySQLAdapter(config)).not.toThrow()
  })

  test('instantiates with individual connection fields', () => {
    const config: MySQLConfig = {
      hostname: 'localhost',
      port: 3306,
      database: 'test',
      username: 'root',
      password: 'secret',
    }
    expect(() => new MySQLAdapter(config)).not.toThrow()
  })

  test('accepts optional max and idleTimeout', () => {
    const config: MySQLConfig = {
      url: 'mysql://root:secret@localhost:3306/test',
      max: 5,
      idleTimeout: 60,
    }
    expect(() => new MySQLAdapter(config)).not.toThrow()
  })

  test('implements VelnAdapter interface (duck-type)', () => {
    const adapter = new MySQLAdapter({ url: 'mysql://root:secret@localhost:3306/test' })
    expect(typeof adapter.query).toBe('function')
    expect(typeof adapter.execute).toBe('function')
    expect(typeof adapter.transaction).toBe('function')
    expect(typeof adapter.close).toBe('function')
  })

  test('is assignable to VelnAdapter', () => {
    // Compile-time check — if this type-checks, the interface is satisfied.
    const adapter: VelnAdapter = new MySQLAdapter({ url: 'mysql://localhost/test' })
    expect(adapter).toBeDefined()
  })
})

describe('MySQLAdapter — close idempotency', () => {
  test('close() can be called multiple times without throwing', async () => {
    const adapter = new MySQLAdapter({ url: 'mysql://root:secret@localhost:3306/test' })
    // Bun.SQL defers connection — close() on a never-connected adapter must not reject
    await expect(adapter.close()).resolves.toBeUndefined()
    await expect(adapter.close()).resolves.toBeUndefined()
  })
})

// ── Tests that require a real MySQL server ─────────────────────────────────

describe('MySQLAdapter — query', () => {
  test.skip('returns rows from SELECT — requires mysql', async () => {
    // requires mysql
    const adapter = new MySQLAdapter({ url: process.env['MYSQL_URL'] ?? '' })
    const rows = await adapter.query('SELECT 1 AS n')
    expect(rows).toHaveLength(1)
    await adapter.close()
  })

  test.skip('binds params correctly — requires mysql', async () => {
    // requires mysql
    const adapter = new MySQLAdapter({ url: process.env['MYSQL_URL'] ?? '' })
    const rows = await adapter.query<{ n: number }>('SELECT ? AS n', [42])
    expect(rows[0]?.n).toBe(42)
    await adapter.close()
  })
})

describe('MySQLAdapter — execute', () => {
  test.skip('returns rowsAffected on INSERT — requires mysql', async () => {
    // requires mysql
  })
})

describe('MySQLAdapter — transaction', () => {
  test.skip('commits on success — requires mysql', async () => {
    // requires mysql
  })

  test.skip('rolls back on error — requires mysql', async () => {
    // requires mysql
  })
})

describe('MySQLAdapter — unhappy paths (no DB)', () => {
  test.skip('query() with empty SQL throws — requires mysql', async () => {
    // requires mysql
    const adapter = new MySQLAdapter({ url: process.env['MYSQL_URL'] ?? '' })
    await expect(adapter.query('')).rejects.toThrow()
    await adapter.close()
  })

  test.skip('execute() on invalid SQL throws — requires mysql', async () => {
    // requires mysql
    const adapter = new MySQLAdapter({ url: process.env['MYSQL_URL'] ?? '' })
    await expect(adapter.execute('SELEKT 1')).rejects.toThrow()
    await adapter.close()
  })
})
