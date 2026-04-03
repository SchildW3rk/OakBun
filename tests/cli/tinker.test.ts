import { describe, test, expect } from 'bun:test'
import { formatResult, formatTable, formatValue, isComplete } from '../../packages/core/src/cli/commands/tinker'

// ── formatValue ───────────────────────────────────────────────────────────────

describe('formatValue', () => {
  test('Date → YYYY-MM-DD HH:MM:SS', () => {
    expect(formatValue(new Date('2026-03-28T18:12:43Z'))).toBe('2026-03-28 18:12:43')
  })

  test('ISO string → YYYY-MM-DD HH:MM:SS', () => {
    expect(formatValue('2026-03-28T18:12:43.000Z')).toBe('2026-03-28 18:12:43')
  })

  test('non-ISO string passes through', () => {
    expect(formatValue('hello')).toBe('hello')
  })

  test('number → string', () => {
    expect(formatValue(42)).toBe('42')
  })

  test('null → empty string', () => {
    expect(formatValue(null)).toBe('')
  })
})

// ── isComplete ─────────────────────────────────────────────────────────────────

describe('isComplete', () => {
  test('simple expression → true', () => {
    expect(isComplete('db.from(table)')).toBe(true)
  })

  test('unclosed paren → false', () => {
    expect(isComplete('db.from(')).toBe(false)
  })

  test('await expression → true', () => {
    expect(isComplete('await db.from(table)')).toBe(true)
  })

  test('unclosed object → false', () => {
    expect(isComplete('const x = {')).toBe(false)
  })

  test('closed object → true', () => {
    expect(isComplete('const x = { a: 1 }')).toBe(true)
  })

  test('unclosed array → false', () => {
    expect(isComplete('[')).toBe(false)
  })

  test('closed array → true', () => {
    expect(isComplete('[1, 2, 3]')).toBe(true)
  })

  test('parens inside string do not affect depth', () => {
    // The string 'hello (world)' is complete — parens inside quotes are ignored
    expect(isComplete("'hello (world)'")).toBe(true)
    // Unclosed paren outside string → false
    expect(isComplete("fn('arg'")).toBe(false)
  })

  test('nested brackets → false until all closed', () => {
    expect(isComplete('fn({ a: [1, 2')).toBe(false)
    expect(isComplete('fn({ a: [1, 2] })')).toBe(true)
  })

  test('empty string → true', () => {
    expect(isComplete('')).toBe(true)
  })

  test('template literal counts as string', () => {
    expect(isComplete('`hello (')).toBe(false)
    expect(isComplete('`hello (world)`')).toBe(true)
  })
})

// ── formatTable ────────────────────────────────────────────────────────────────

describe('formatTable', () => {
  test('empty array → dim "[]"', () => {
    expect(formatTable([])).toContain('[]')
  })

  test('single row includes box-drawing chars and row count', () => {
    const out = formatTable([{ id: 1, name: 'René' }])
    expect(out).toContain('┌')
    expect(out).toContain('│')
    expect(out).toContain('└')
    expect(out).toContain('René')
    expect(out).toContain('(1 row)')
  })

  test('two rows → "(2 rows)"', () => {
    const out = formatTable([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ])
    expect(out).toContain('(2 rows)')
    expect(out).toContain('Alice')
    expect(out).toContain('Bob')
  })

  test('header row present with column names', () => {
    const out = formatTable([{ id: 1, name: 'Alice' }])
    expect(out).toContain('id')
    expect(out).toContain('name')
  })

  test('separator row between header and data', () => {
    const out = formatTable([{ id: 1, name: 'Alice' }])
    expect(out).toContain('├')
    expect(out).toContain('┼')
    expect(out).toContain('┤')
  })

  test('null values rendered as empty string', () => {
    const out = formatTable([{ id: 1, role: null }])
    expect(out).toContain('role')
  })

  test('all box rows same visual width', () => {
    const out   = formatTable([{ id: 1, name: 'Alice' }])
    const lines = out.split('\n').filter(l => l.startsWith('┌') || l.startsWith('├') || l.startsWith('└') || l.startsWith('│'))
    const stripped = lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, ''))
    const len = stripped[0].length
    expect(stripped.every(l => l.length === len)).toBe(true)
  })
})

// ── formatResult ───────────────────────────────────────────────────────────────

describe('formatResult', () => {
  test('null → dim "null"', () => {
    expect(formatResult(null)).toContain('null')
  })

  test('undefined → dim "undefined"', () => {
    expect(formatResult(undefined)).toContain('undefined')
  })

  test('empty array → dim "[]"', () => {
    expect(formatResult([])).toContain('[]')
  })

  test('array of objects → table format', () => {
    const out = formatResult([{ id: 1, name: 'Alice' }])
    expect(out).toContain('id')
    expect(out).toContain('Alice')
    expect(out).toContain('(1 row)')
  })

  test('array of primitives → JSON', () => {
    const out = formatResult([1, 2, 3])
    expect(out).toContain('1')
    expect(out).toContain('2')
  })

  test('plain object → JSON with indent', () => {
    const out = formatResult({ id: 1, name: 'Alice' })
    expect(out).toContain('"id"')
    expect(out).toContain('"Alice"')
  })

  test('number → string', () => {
    expect(formatResult(42)).toBe('42')
  })

  test('boolean → string', () => {
    expect(formatResult(true)).toBe('true')
  })

  test('string → passes through', () => {
    expect(formatResult('hello')).toBe('hello')
  })
})
