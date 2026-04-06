import { describe, test, expect } from 'bun:test'
import { buildWhere, buildInsert, buildInsertMany, buildUpdate, buildDelete, buildSelect } from '../../packages/core/src/db/sql'

// ── buildWhere ─────────────────────────────────────────────────────────────

describe('buildWhere', () => {
  test('single condition → "key = ?"', () => {
    const { sql, params } = buildWhere({ name: 'Alice' })
    expect(sql).toBe('"name" = ?')
    expect(params).toEqual(['Alice'])
  })

  test('multiple conditions → "k1 = ? AND k2 = ?"', () => {
    const { sql, params } = buildWhere({ name: 'Alice', role: 'admin' })
    expect(sql).toBe('"name" = ? AND "role" = ?')
    expect(params).toEqual(['Alice', 'admin'])
  })

  test('undefined values ignored', () => {
    const { sql, params } = buildWhere({ name: 'Alice', role: undefined })
    expect(sql).toBe('"name" = ?')
    expect(params).toEqual(['Alice'])
  })

  test('all undefined → empty sql + empty params', () => {
    const { sql, params } = buildWhere({ name: undefined, role: undefined })
    expect(sql).toBe('')
    expect(params).toEqual([])
  })

  test('empty object → empty sql + empty params', () => {
    const { sql, params } = buildWhere({})
    expect(sql).toBe('')
    expect(params).toEqual([])
  })

  test('null value → included (null is valid binding)', () => {
    const { sql, params } = buildWhere({ deletedAt: null })
    expect(sql).toBe('"deletedAt" = ?')
    expect(params).toEqual([null])
  })
})

// ── buildInsert ────────────────────────────────────────────────────────────

describe('buildInsert', () => {
  test('all fields → correct SQL + params in order (with RETURNING *)', () => {
    const { sql, params } = buildInsert('users', { name: 'Alice', email: 'alice@test.com', role: 'user' })
    expect(sql).toBe('INSERT INTO "users" ("name", "email", "role") VALUES (?, ?, ?) RETURNING *')
    expect(params).toEqual(['Alice', 'alice@test.com', 'user'])
  })

  test('single field (with RETURNING *)', () => {
    const { sql, params } = buildInsert('users', { name: 'Alice' })
    expect(sql).toBe('INSERT INTO "users" ("name") VALUES (?) RETURNING *')
    expect(params).toEqual(['Alice'])
  })

  test('field names are quoted', () => {
    const { sql } = buildInsert('my_table', { my_col: 'val' })
    expect(sql).toContain('"my_col"')
    expect(sql).toContain('"my_table"')
  })

  test('returning: false — no RETURNING clause (MySQL compatibility)', () => {
    const { sql } = buildInsert('users', { name: 'Alice' }, false)
    expect(sql).toBe('INSERT INTO "users" ("name") VALUES (?)')
    expect(sql).not.toContain('RETURNING')
  })

  test('returning: true (explicit) — appends RETURNING *', () => {
    const { sql } = buildInsert('users', { name: 'Alice' }, true)
    expect(sql).toContain('RETURNING *')
  })
})

// ── buildInsertMany ────────────────────────────────────────────────────────

describe('buildInsertMany', () => {
  // ── Happy Path ──────────────────────────────────────────────────────────

  test('1 row — correct SQL + params', () => {
    const { sql, params } = buildInsertMany('users', [{ name: 'Alice', email: 'alice@example.com' }])
    expect(sql).toBe('INSERT INTO "users" ("name", "email") VALUES (?, ?) RETURNING *')
    expect(params).toEqual(['Alice', 'alice@example.com'])
  })

  test('3 rows — VALUES clause has 3 groups, params are flat and in order', () => {
    const { sql, params } = buildInsertMany('users', [
      { name: 'Alice', email: 'a@example.com' },
      { name: 'Bob',   email: 'b@example.com' },
      { name: 'Carol', email: 'c@example.com' },
    ])
    expect(sql).toBe(
      'INSERT INTO "users" ("name", "email") VALUES (?, ?), (?, ?), (?, ?) RETURNING *',
    )
    expect(params).toEqual(['Alice', 'a@example.com', 'Bob', 'b@example.com', 'Carol', 'c@example.com'])
  })

  test('column order follows rows[0] key order', () => {
    const { sql } = buildInsertMany('users', [{ email: 'x@example.com', name: 'X' }])
    // email comes before name — not alphabetical, follows insertion order
    expect(sql).toContain('"email", "name"')
  })

  test('returning: false — no RETURNING clause', () => {
    const { sql } = buildInsertMany('users', [{ name: 'Alice' }], false)
    expect(sql).toBe('INSERT INTO "users" ("name") VALUES (?)')
    expect(sql).not.toContain('RETURNING')
  })

  test('null values are kept in params', () => {
    const { sql, params } = buildInsertMany('users', [{ name: 'Alice', deletedAt: null }])
    expect(sql).toContain('VALUES (?, ?)')
    expect(params).toContain(null)
  })

  test('numeric and boolean values are valid params', () => {
    const { params } = buildInsertMany('scores', [{ count: 0, active: false }])
    expect(params).toEqual([0, false])
  })

  // ── Unhappy Path ────────────────────────────────────────────────────────

  test('throws when rows is empty', () => {
    expect(() => buildInsertMany('users', [])).toThrow('insertMany')
  })

  test('throws when a row contains undefined value', () => {
    expect(() =>
      buildInsertMany('users', [{ name: undefined as unknown as string }]),
    ).toThrow(/"name"/)
  })
})

// ── buildUpdate ────────────────────────────────────────────────────────────

describe('buildUpdate', () => {
  test('single field update', () => {
    const { sql, params } = buildUpdate('users', { name: 'Bob' }, 'id', 1)
    expect(sql).toBe('UPDATE "users" SET "name" = ? WHERE "id" = ?')
    expect(params).toEqual(['Bob', 1])
  })

  test('multiple fields', () => {
    const { sql, params } = buildUpdate('users', { name: 'Bob', role: 'admin' }, 'id', 1)
    expect(sql).toBe('UPDATE "users" SET "name" = ?, "role" = ? WHERE "id" = ?')
    expect(params).toEqual(['Bob', 'admin', 1])
  })

  test('field names quoted, WHERE pk correct', () => {
    const { sql } = buildUpdate('my_table', { title: 'x' }, 'uuid', 'abc-123')
    expect(sql).toBe('UPDATE "my_table" SET "title" = ? WHERE "uuid" = ?')
  })

  test('pk param is last in params array', () => {
    const { params } = buildUpdate('users', { name: 'Bob', email: 'b@test.com' }, 'id', 99)
    expect(params[params.length - 1]).toBe(99)
  })
})

// ── buildDelete ────────────────────────────────────────────────────────────

describe('buildDelete', () => {
  test('generates correct SQL', () => {
    const { sql, params } = buildDelete('users', 'id', 1)
    expect(sql).toBe('DELETE FROM "users" WHERE "id" = ?')
    expect(params).toEqual([1])
  })

  test('pk value in params', () => {
    const { params } = buildDelete('documents', 'uuid', 'abc-123')
    expect(params).toEqual(['abc-123'])
  })
})

// ── buildSelect ────────────────────────────────────────────────────────────

describe('buildSelect', () => {
  test('no conditions → SELECT * FROM "table" (no WHERE)', () => {
    const { sql, params } = buildSelect('users', {})
    expect(sql).toBe('SELECT * FROM "users"')
    expect(params).toEqual([])
  })

  test('with conditions → WHERE clause', () => {
    const { sql, params } = buildSelect('users', { name: 'Alice' })
    expect(sql).toBe('SELECT * FROM "users" WHERE "name" = ?')
    expect(params).toEqual(['Alice'])
  })

  test('undefined conditions ignored', () => {
    const { sql, params } = buildSelect('users', { name: 'Alice', role: undefined })
    expect(sql).toBe('SELECT * FROM "users" WHERE "name" = ?')
    expect(params).toEqual(['Alice'])
  })

  test('all undefined conditions → no WHERE', () => {
    const { sql, params } = buildSelect('users', { name: undefined })
    expect(sql).toBe('SELECT * FROM "users"')
    expect(params).toEqual([])
  })

  test('multiple conditions in WHERE', () => {
    const { sql, params } = buildSelect('users', { name: 'Alice', role: 'admin' })
    expect(sql).toBe('SELECT * FROM "users" WHERE "name" = ? AND "role" = ?')
    expect(params).toEqual(['Alice', 'admin'])
  })
})
