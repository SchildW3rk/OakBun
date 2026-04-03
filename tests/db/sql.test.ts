import { describe, test, expect } from 'bun:test'
import { buildWhere, buildInsert, buildUpdate, buildDelete, buildSelect } from '../../packages/core/src/db/sql'

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
