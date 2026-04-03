import { describe, test, expect } from 'bun:test'
import { convertWhere } from '../src/where.js'
import type { Where } from 'better-auth'

describe('convertWhere', () => {
  test('empty array returns empty sql and params', () => {
    const result = convertWhere([])
    expect(result.sql).toBe('')
    expect(result.params).toEqual([])
  })

  test('eq operator (default)', () => {
    const where: Where[] = [{ field: 'email', operator: 'eq', value: 'user@test.com' }]
    const result = convertWhere(where)
    expect(result.sql).toBe('"email" = ?')
    expect(result.params).toEqual(['user@test.com'])
  })

  test('eq is the default operator when omitted', () => {
    const where: Where[] = [{ field: 'email', value: 'user@test.com' }]
    const result = convertWhere(where)
    expect(result.sql).toBe('"email" = ?')
    expect(result.params).toEqual(['user@test.com'])
  })

  test('ne operator', () => {
    const where: Where[] = [{ field: 'status', operator: 'ne', value: 'inactive' }]
    const result = convertWhere(where)
    expect(result.sql).toBe('"status" != ?')
    expect(result.params).toEqual(['inactive'])
  })

  test('lt operator', () => {
    const where: Where[] = [{ field: 'age', operator: 'lt', value: 30 }]
    const result = convertWhere(where)
    expect(result.sql).toBe('"age" < ?')
    expect(result.params).toEqual([30])
  })

  test('lte operator', () => {
    const where: Where[] = [{ field: 'age', operator: 'lte', value: 30 }]
    const result = convertWhere(where)
    expect(result.sql).toBe('"age" <= ?')
    expect(result.params).toEqual([30])
  })

  test('gt operator', () => {
    const where: Where[] = [{ field: 'age', operator: 'gt', value: 18 }]
    const result = convertWhere(where)
    expect(result.sql).toBe('"age" > ?')
    expect(result.params).toEqual([18])
  })

  test('gte operator', () => {
    const where: Where[] = [{ field: 'age', operator: 'gte', value: 18 }]
    const result = convertWhere(where)
    expect(result.sql).toBe('"age" >= ?')
    expect(result.params).toEqual([18])
  })

  test('in operator with strings', () => {
    const where: Where[] = [{ field: 'role', operator: 'in', value: ['admin', 'editor'] }]
    const result = convertWhere(where)
    expect(result.sql).toBe('"role" IN (?,?)')
    expect(result.params).toEqual(['admin', 'editor'])
  })

  test('in operator with numbers', () => {
    const where: Where[] = [{ field: 'id', operator: 'in', value: [1, 2, 3] }]
    const result = convertWhere(where)
    expect(result.sql).toBe('"id" IN (?,?,?)')
    expect(result.params).toEqual([1, 2, 3])
  })

  test('not_in operator', () => {
    const where: Where[] = [{ field: 'role', operator: 'not_in', value: ['banned'] }]
    const result = convertWhere(where)
    expect(result.sql).toBe('"role" NOT IN (?)')
    expect(result.params).toEqual(['banned'])
  })

  test('contains operator', () => {
    const where: Where[] = [{ field: 'name', operator: 'contains', value: 'foo' }]
    const result = convertWhere(where)
    expect(result.sql).toBe('"name" LIKE ?')
    expect(result.params).toEqual(['%foo%'])
  })

  test('starts_with operator', () => {
    const where: Where[] = [{ field: 'name', operator: 'starts_with', value: 'Alice' }]
    const result = convertWhere(where)
    expect(result.sql).toBe('"name" LIKE ?')
    expect(result.params).toEqual(['Alice%'])
  })

  test('ends_with operator', () => {
    const where: Where[] = [{ field: 'email', operator: 'ends_with', value: '.com' }]
    const result = convertWhere(where)
    expect(result.sql).toBe('"email" LIKE ?')
    expect(result.params).toEqual(['%.com'])
  })

  test('boolean false → 0', () => {
    const where: Where[] = [{ field: 'active', operator: 'eq', value: false }]
    const result = convertWhere(where)
    expect(result.sql).toBe('"active" = ?')
    expect(result.params).toEqual([0])
  })

  test('boolean true → 1', () => {
    const where: Where[] = [{ field: 'active', operator: 'eq', value: true }]
    const result = convertWhere(where)
    expect(result.sql).toBe('"active" = ?')
    expect(result.params).toEqual([1])
  })

  test('null value', () => {
    const where: Where[] = [{ field: 'image', operator: 'eq', value: null }]
    const result = convertWhere(where)
    expect(result.sql).toBe('"image" = ?')
    expect(result.params).toEqual([null])
  })

  test('AND connector (default) between multiple conditions', () => {
    const where: Where[] = [
      { field: 'email', operator: 'eq', value: 'a@b.com' },
      { field: 'active', operator: 'eq', value: true, connector: 'AND' },
    ]
    const result = convertWhere(where)
    expect(result.sql).toBe('"email" = ? AND "active" = ?')
    expect(result.params).toEqual(['a@b.com', 1])
  })

  test('AND connector is default when omitted', () => {
    const where: Where[] = [
      { field: 'name', value: 'Alice' },
      { field: 'age', operator: 'gt', value: 18 },
    ]
    const result = convertWhere(where)
    expect(result.sql).toBe('"name" = ? AND "age" > ?')
    expect(result.params).toEqual(['Alice', 18])
  })

  test('OR connector', () => {
    const where: Where[] = [
      { field: 'role', operator: 'eq', value: 'admin' },
      { field: 'role', operator: 'eq', value: 'editor', connector: 'OR' },
    ]
    const result = convertWhere(where)
    expect(result.sql).toBe('"role" = ? OR "role" = ?')
    expect(result.params).toEqual(['admin', 'editor'])
  })

  test('three conditions with mixed connectors', () => {
    const where: Where[] = [
      { field: 'a', value: '1' },
      { field: 'b', value: '2', connector: 'AND' },
      { field: 'c', value: '3', connector: 'OR' },
    ]
    const result = convertWhere(where)
    expect(result.sql).toBe('"a" = ? AND "b" = ? OR "c" = ?')
    expect(result.params).toEqual(['1', '2', '3'])
  })
})
