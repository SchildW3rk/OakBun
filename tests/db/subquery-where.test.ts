import { describe, test, expect } from 'bun:test'
import { buildWhere, buildSubquery } from '../../packages/core/src/db/sql'

describe('WHERE IN / NOT IN with SubqueryResult', () => {
  test('IN with SubqueryResult — SQL uses subquery, not placeholders', () => {
    const sub = buildSubquery<'id', number>('SELECT "id" FROM "users" WHERE "active" = ?', [true], 'id')
    const { sql, params } = buildWhere({ userId: { op: 'IN', value: sub } })

    expect(sql).toBe('"userId" IN (SELECT "id" FROM "users" WHERE "active" = ?)')
    expect(params).toEqual([true])
  })

  test('NOT IN with SubqueryResult', () => {
    const sub = buildSubquery<'id', number>('SELECT "id" FROM "users" WHERE "banned" = ?', [true], 'id')
    const { sql, params } = buildWhere({ userId: { op: 'NOT IN', value: sub } })

    expect(sql).toBe('"userId" NOT IN (SELECT "id" FROM "users" WHERE "banned" = ?)')
    expect(params).toEqual([true])
  })

  test('IN with plain array — behaviour unchanged (no regression)', () => {
    const { sql, params } = buildWhere({ userId: { op: 'IN', value: [1, 2, 3] } })
    expect(sql).toBe('"userId" IN (?, ?, ?)')
    expect(params).toEqual([1, 2, 3])
  })

  test('NOT IN with plain array — behaviour unchanged', () => {
    const { sql, params } = buildWhere({ userId: { op: 'NOT IN', value: [1, 2] } })
    expect(sql).toBe('"userId" NOT IN (?, ?)')
    expect(params).toEqual([1, 2])
  })

  test('IN with empty array — still returns 1 = 0 (no regression)', () => {
    const { sql, params } = buildWhere({ userId: { op: 'IN', value: [] } })
    expect(sql).toBe('1 = 0')
    expect(params).toEqual([])
  })

  test('NOT IN with empty array — still returns 1 = 1 (no regression)', () => {
    const { sql, params } = buildWhere({ userId: { op: 'NOT IN', value: [] } })
    expect(sql).toBe('1 = 1')
    expect(params).toEqual([])
  })

  test('IN subquery combined with another WHERE condition — params in correct order', () => {
    const sub = buildSubquery<'id', number>('SELECT "id" FROM "users" WHERE "active" = ?', [true], 'id')
    // buildWhere processes entries in insertion order — active first, then userId
    const { sql, params } = buildWhere({ active: true, userId: { op: 'IN', value: sub } })

    // active param first, then sub param
    expect(params).toEqual([true, true])
    expect(sql).toContain('"active" = ?')
    expect(sql).toContain('"userId" IN (SELECT "id" FROM "users" WHERE "active" = ?)')
  })

  test('subquery with multiple params — all forwarded', () => {
    const sub = buildSubquery<'id', number>(
      'SELECT "id" FROM "users" WHERE "role" = ? AND "active" = ?',
      ['admin', true],
      'id',
    )
    const { sql, params } = buildWhere({ userId: { op: 'IN', value: sub } })

    expect(params).toEqual(['admin', true])
    expect(sql).toBe('"userId" IN (SELECT "id" FROM "users" WHERE "role" = ? AND "active" = ?)')
  })
})
