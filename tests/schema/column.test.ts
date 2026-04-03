import { describe, test, expect } from 'bun:test'
import { column, Column } from '../../packages/core/src/schema/column'

describe('column factories', () => {
  // ── Happy path ────────────────────────────────────────────────

  test('column.integer() creates INTEGER column', () => {
    const c = column.integer()
    expect(c.def.type).toBe('INTEGER')
    expect(c.def.nullable).toBe(false)
    expect(c.def.primaryKey).toBe(false)
  })

  test('column.text() creates TEXT column', () => {
    expect(column.text().def.type).toBe('TEXT')
  })

  test('column.boolean() creates BOOLEAN column', () => {
    expect(column.boolean().def.type).toBe('BOOLEAN')
  })

  test('column.timestamp() creates TIMESTAMP column', () => {
    expect(column.timestamp().def.type).toBe('TIMESTAMP')
  })

  test('column.uuid() creates UUID column', () => {
    expect(column.uuid().def.type).toBe('UUID')
  })

  test('column.json() creates JSON column', () => {
    expect(column.json().def.type).toBe('JSON')
  })
})

describe('column modifiers', () => {
  // ── Happy path ────────────────────────────────────────────────

  test('.nullable() sets nullable = true', () => {
    const c = column.text().nullable()
    expect(c.def.nullable).toBe(true)
  })

  test('.primaryKey() sets primaryKey + autoIncrement = true', () => {
    const c = column.integer().primaryKey()
    expect(c.def.primaryKey).toBe(true)
    expect(c.def.autoIncrement).toBe(true)
  })

  test('.unique() sets unique = true', () => {
    const c = column.text().unique()
    expect(c.def.unique).toBe(true)
  })

  test('.default() stores the default value', () => {
    const c = column.text().default('user')
    expect(c.def.defaultValue).toBe('user')
  })

  test('.defaultFn() stores the factory function', () => {
    const fn = () => new Date()
    const c = column.timestamp().defaultFn(fn)
    expect(c.def.defaultFn).toBe(fn)
    expect(c.def.defaultFn!()).toBeInstanceOf(Date)
  })

  test('modifiers are chainable', () => {
    const c = column.text().unique().nullable().default(null as any)
    expect(c.def.unique).toBe(true)
    expect(c.def.nullable).toBe(true)
  })

  test('modifiers are immutable — original is unchanged', () => {
    const original = column.text()
    const modified = original.nullable()
    expect(original.def.nullable).toBe(false)  // unchanged
    expect(modified.def.nullable).toBe(true)
  })
})
