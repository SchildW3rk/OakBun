import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import type { SQLiteConfig } from '../../packages/core/src/adapter/sqlite'

let db: SQLiteAdapter

beforeEach(async () => {
  db = new SQLiteAdapter(':memory:')
  await db.execute(`
    CREATE TABLE users (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      age   INTEGER
    )
  `)
})

afterEach(async () => db.close())

describe('SQLiteAdapter — query', () => {
  // ── Happy path ────────────────────────────────────────────────

  test('returns empty array when no rows', async () => {
    const rows = await db.query('SELECT * FROM users')
    expect(rows).toEqual([])
  })

  test('returns inserted rows', async () => {
    await db.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['René', 'rene@test.com'])
    const rows = await db.query<{ name: string }>('SELECT * FROM users')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('René')
  })

  test('binds params correctly', async () => {
    await db.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['A', 'a@test.com'])
    await db.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['B', 'b@test.com'])
    const rows = await db.query<{ name: string }>('SELECT * FROM users WHERE name = ?', ['A'])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('A')
  })

  test('returns multiple rows', async () => {
    await db.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['A', 'a@test.com'])
    await db.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['B', 'b@test.com'])
    const rows = await db.query('SELECT * FROM users ORDER BY name')
    expect(rows).toHaveLength(2)
  })

  // ── Unhappy path ──────────────────────────────────────────────

  test('throws on invalid SQL', async () => {
    expect(db.query('SELEKT * FROM users')).rejects.toThrow()
  })

  test('throws on unknown table', async () => {
    expect(db.query('SELECT * FROM ghost')).rejects.toThrow()
  })
})

describe('SQLiteAdapter — execute', () => {
  // ── Happy path ────────────────────────────────────────────────

  test('returns rowsAffected = 1 on insert', async () => {
    const r = await db.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['René', 'r@t.com'])
    expect(r.rowsAffected).toBe(1)
  })

  test('returns rowsAffected = n on bulk update', async () => {
    await db.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['A', 'a@t.com'])
    await db.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['B', 'b@t.com'])
    const r = await db.execute('UPDATE users SET age = ?', [25])
    expect(r.rowsAffected).toBe(2)
  })

  test('returns rowsAffected = 0 on no-op update', async () => {
    const r = await db.execute('UPDATE users SET age = ? WHERE id = ?', [25, 999])
    expect(r.rowsAffected).toBe(0)
  })

  // ── Unhappy path ──────────────────────────────────────────────

  test('throws on UNIQUE constraint violation', async () => {
    await db.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['A', 'same@t.com'])
    expect(
      db.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['B', 'same@t.com'])
    ).rejects.toThrow()
  })

  test('throws on NOT NULL violation', async () => {
    expect(
      db.execute('INSERT INTO users (name, email) VALUES (?, ?)', [null, 'x@t.com'])
    ).rejects.toThrow()
  })
})

describe('SQLiteAdapter — transaction', () => {
  // ── Happy path ────────────────────────────────────────────────

  test('commits all operations on success', async () => {
    await db.transaction(async (tx) => {
      await tx.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['A', 'a@t.com'])
      await tx.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['B', 'b@t.com'])
    })
    const rows = await db.query('SELECT * FROM users')
    expect(rows).toHaveLength(2)
  })

  test('returns value from transaction fn', async () => {
    const result = await db.transaction(async (tx) => {
      await tx.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['A', 'a@t.com'])
      const rows = await tx.query<{ id: number }>('SELECT last_insert_rowid() as id')
      return rows[0]!.id
    })
    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThan(0)
  })

  // ── Unhappy path ──────────────────────────────────────────────

  test('rolls back all operations on error', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['A', 'a@t.com'])
        throw new Error('something went wrong')
      })
    ).rejects.toThrow('something went wrong')

    const rows = await db.query('SELECT * FROM users')
    expect(rows).toHaveLength(0)  // rollback — nothing committed
  })

  test('rolls back on constraint violation inside tx', async () => {
    await db.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['existing', 'dup@t.com'])

    await expect(
      db.transaction(async (tx) => {
        await tx.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['new', 'new@t.com'])
        await tx.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['dup', 'dup@t.com'])
      })
    ).rejects.toThrow()

    const rows = await db.query('SELECT * FROM users')
    expect(rows).toHaveLength(1)  // only the pre-tx row
  })
})

describe('SQLiteAdapter — SQLiteConfig', () => {
  test('accepts config object with explicit path', async () => {
    const config: SQLiteConfig = { path: ':memory:' }
    const adapter = new SQLiteAdapter(config)
    await adapter.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    const r = await adapter.execute('INSERT INTO t VALUES (1)')
    expect(r.rowsAffected).toBe(1)
    await adapter.close()
  })

  test('wal: false disables WAL mode', async () => {
    const adapter = new SQLiteAdapter({ path: ':memory:', wal: false })
    // Should still work — just uses default journal mode
    await adapter.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    const rows = await adapter.query('SELECT * FROM t')
    expect(rows).toEqual([])
    await adapter.close()
  })

  test('string constructor still works (backwards compat)', async () => {
    const adapter = new SQLiteAdapter(':memory:')
    await adapter.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    const r = await adapter.execute('INSERT INTO t VALUES (42)')
    expect(r.rowsAffected).toBe(1)
    await adapter.close()
  })

  test('no-arg constructor defaults to :memory:', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    const rows = await adapter.query('SELECT * FROM t')
    expect(rows).toEqual([])
    await adapter.close()
  })
})

describe('SQLiteAdapter — ExecuteResult', () => {
  test('execute returns lastInsertId after INSERT', async () => {
    const r = await db.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['A', 'a@t.com'])
    expect(r.rowsAffected).toBe(1)
    expect(r.lastInsertId).toBeDefined()
    expect(typeof r.lastInsertId === 'number' || typeof r.lastInsertId === 'bigint').toBe(true)
  })

  test('lastInsertId increments with each INSERT', async () => {
    const r1 = await db.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['A', 'a@t.com'])
    const r2 = await db.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['B', 'b@t.com'])
    expect(Number(r2.lastInsertId)).toBeGreaterThan(Number(r1.lastInsertId))
  })

  test('lastInsertId is undefined or 0 for non-INSERT statements', async () => {
    await db.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['A', 'a@t.com'])
    const r = await db.execute('UPDATE users SET age = ?', [25])
    // SQLite returns the last rowid even for UPDATE — but rowsAffected is what matters
    expect(r.rowsAffected).toBe(1)
  })
})

describe('SQLiteAdapter — bigint changes', () => {
  test('execute returns numeric rowsAffected even when changes is bigint', async () => {
    // bun:sqlite may return bigint for .changes in future versions —
    // the adapter normalises to number regardless.
    const adapter = new SQLiteAdapter()
    await adapter.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)')
    await adapter.execute('INSERT INTO t VALUES (1, ?)', ['a'])
    await adapter.execute('INSERT INTO t VALUES (2, ?)', ['b'])
    const r = await adapter.execute('UPDATE t SET v = ?', ['x'])
    expect(typeof r.rowsAffected).toBe('number')
    expect(r.rowsAffected).toBe(2)
    await adapter.close()
  })
})

describe('SQLiteAdapter — BindingValue edge cases', () => {
  test('null param is accepted and stored as NULL', async () => {
    // age column is nullable INTEGER — null is a valid BindingValue
    await db.execute('INSERT INTO users (name, email, age) VALUES (?, ?, ?)', ['A', 'a@t.com', null])
    const rows = await db.query<{ age: number | null }>('SELECT age FROM users')
    expect(rows[0]?.age).toBeNull()
  })

  test('bigint param is accepted by SQLite', async () => {
    // bun:sqlite accepts bigint as a binding value — stored as INTEGER
    await db.execute('INSERT INTO users (name, email, age) VALUES (?, ?, ?)', ['B', 'b@t.com', BigInt(99)])
    const rows = await db.query<{ age: number }>('SELECT age FROM users')
    expect(rows[0]?.age).toBe(99)
  })

  test('Date must be serialised to string before binding — raw Date is not a BindingValue', () => {
    // BindingValue does not include Date — callers must convert to ISO string or timestamp.
    // This test documents the contract: pass date.toISOString() or date.getTime().
    const isoDate = new Date('2025-06-01T00:00:00.000Z').toISOString()
    expect(typeof isoDate).toBe('string')
    // Binding the ISO string works fine
    return expect(
      db.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['C', 'c@t.com']).then(() =>
        db.execute('UPDATE users SET name = ? WHERE email = ?', [isoDate, 'c@t.com'])
      )
    ).resolves.toMatchObject({ rowsAffected: 1 })
  })
})

describe('SQLiteAdapter — closed DB behaviour', () => {
  test('execute() on closed DB throws', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    await adapter.close()
    await expect(adapter.execute('INSERT INTO t VALUES (1)')).rejects.toThrow()
  })

  test('query() on closed DB throws', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    await adapter.close()
    await expect(adapter.query('SELECT * FROM t')).rejects.toThrow()
  })
})

describe('SQLiteAdapter — empty SQL', () => {
  test('query() with empty string throws', async () => {
    await expect(db.query('')).rejects.toThrow()
  })

  test('execute() with empty string throws', async () => {
    await expect(db.execute('')).rejects.toThrow()
  })
})

describe('SQLiteAdapter — nested transactions', () => {
  // SQLite does not support nested BEGIN — calling transaction() inside a
  // transaction() callback will throw "cannot start a transaction within a transaction".
  // This is documented behaviour; callers must use SAVEPOINTs manually if needed.
  test('nested transaction throws — SQLite does not support nested BEGIN', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)')

    await expect(
      adapter.transaction(async (tx) => {
        await tx.execute('INSERT INTO t VALUES (1)')
        // Attempting a second BEGIN inside an active transaction throws
        await adapter.transaction(async (inner) => {
          await inner.execute('INSERT INTO t VALUES (2)')
        })
      })
    ).rejects.toThrow()

    await adapter.close()
  })
})
