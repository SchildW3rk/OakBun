import { describe, test, expect } from 'bun:test'
import { maskData } from '../src/masker'

describe('maskData', () => {
  test('masks a direct key', () => {
    const result = maskData({ password: 'secret123', email: 'a@b.com' }, ['password'])
    expect(result).toEqual({ password: '***', email: 'a@b.com' })
  })

  test('is case-insensitive', () => {
    const result = maskData({ Password: 'x', PASSWORD: 'y' }, ['password'])
    expect(result).toEqual({ Password: '***', PASSWORD: '***' })
  })

  test('masks nested object keys', () => {
    const result = maskData({ user: { token: 'abc', name: 'René' } }, ['token'])
    expect(result).toEqual({ user: { token: '***', name: 'René' } })
  })

  test('masks array-value key when key matches', () => {
    // key matched → masked (arrays are not recursed)
    const result = maskData({ ids: [1, 2, 3] }, ['ids'])
    expect(result).toEqual({ ids: '***' })
  })

  test('leaves arrays unmasked when key does not match', () => {
    const result = maskData({ ids: [1, 2, 3] }, ['password'])
    expect(result).toEqual({ ids: [1, 2, 3] })
  })

  test('no match — returns unchanged', () => {
    const result = maskData({ email: 'a@b.com' }, ['password'])
    expect(result).toEqual({ email: 'a@b.com' })
  })

  test('empty object', () => {
    const result = maskData({}, ['password'])
    expect(result).toEqual({})
  })

  test('masks multiple keys', () => {
    const result = maskData({ token: 'abc', secret: 'xyz', name: 'Bob' }, ['token', 'secret'])
    expect(result).toEqual({ token: '***', secret: '***', name: 'Bob' })
  })

  test('deep nesting', () => {
    const result = maskData({ a: { b: { password: 'deep' } } }, ['password'])
    expect(result).toEqual({ a: { b: { password: '***' } } })
  })
})
