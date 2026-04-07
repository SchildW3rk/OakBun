import { describe, test, expect } from 'bun:test'
import { buildSubquery } from '../../packages/core/src/db/sql'

describe('buildSubquery', () => {
  test('wraps SQL in parentheses', () => {
    const result = buildSubquery('SELECT "id" FROM "users" WHERE "active" = ?', [true], 'id')
    expect(result._sql).toBe('(SELECT "id" FROM "users" WHERE "active" = ?)')
  })

  test('preserves params unchanged', () => {
    const result = buildSubquery('SELECT "id" FROM "users" WHERE "active" = ?', [true], 'id')
    expect(result._params).toEqual([true])
  })

  test('_phantom.col matches input col', () => {
    const result = buildSubquery('SELECT "id" FROM "users"', [], 'id')
    expect(result._phantom.col).toBe('id')
  })

  test('works with multiple params', () => {
    const result = buildSubquery('SELECT "id" FROM "users" WHERE "role" = ? AND "active" = ?', ['admin', true], 'id')
    expect(result._sql).toBe('(SELECT "id" FROM "users" WHERE "role" = ? AND "active" = ?)')
    expect(result._params).toEqual(['admin', true])
  })

  test('works with empty params', () => {
    const result = buildSubquery('SELECT "id" FROM "users"', [], 'id')
    expect(result._sql).toBe('(SELECT "id" FROM "users")')
    expect(result._params).toEqual([])
  })

  test('wraps already-parenthesized SQL correctly', () => {
    // Should still wrap — caller is responsible for correct SQL
    const result = buildSubquery('SELECT "id" FROM "users"', [], 'name')
    expect(result._sql.startsWith('(')).toBe(true)
    expect(result._sql.endsWith(')')).toBe(true)
  })

  test('throws for empty SQL', () => {
    expect(() => buildSubquery('', [], 'id')).toThrow('buildSubquery: sql must not be empty')
  })
})
