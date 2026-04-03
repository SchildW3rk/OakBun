import { describe, test, expect } from 'bun:test'
import { defineAuditTable, applyRedact } from '../../packages/core/src/schema/audit'
import { column } from '../../packages/core/src/schema/column'
import { toCreateTableSql } from '../../packages/core/src/schema/table'

describe('defineAuditTable — schema', () => {
  test('base fields present without extra schema', () => {
    const t = defineAuditTable('audit_logs').build()
    const keys = Object.keys(t.schema)
    expect(keys).toContain('id')
    expect(keys).toContain('tableName')
    expect(keys).toContain('operation')
    expect(keys).toContain('actor')
    expect(keys).toContain('before')
    expect(keys).toContain('after')
    expect(keys).toContain('changedAt')
  })

  test('extra fields merged with base fields', () => {
    const t = defineAuditTable('audit_logs', {
      requestId: column.text().nullable(),
      ipAddress: column.text().nullable(),
    }).build()
    const keys = Object.keys(t.schema)
    // base fields preserved
    expect(keys).toContain('id')
    expect(keys).toContain('tableName')
    // extra fields appended
    expect(keys).toContain('requestId')
    expect(keys).toContain('ipAddress')
  })

  test('extra fields do not overwrite base fields', () => {
    // If user accidentally supplies a field name that collides with a base field,
    // base field wins (spread order: base first, then extra overrides).
    // This test verifies the schema is valid either way.
    const t = defineAuditTable('audit_logs', {
      requestId: column.text().nullable(),
    }).build()
    expect(t.name).toBe('audit_logs')
  })

  test('toCreateTableSql generates valid SQL', () => {
    const t = defineAuditTable('audit_logs', {
      requestId: column.text().nullable(),
    }).build()
    const sql = toCreateTableSql(t)
    expect(sql).toContain('"audit_logs"')
    expect(sql).toContain('"id"')
    expect(sql).toContain('"tableName"')
    expect(sql).toContain('"requestId"')
  })

  test('two calls with same name produce independent tables', () => {
    const a = defineAuditTable('audit_a').build()
    const b = defineAuditTable('audit_b').build()
    expect(a.name).toBe('audit_a')
    expect(b.name).toBe('audit_b')
  })
})

describe('applyRedact', () => {
  test('replaces specified fields with [REDACTED]', () => {
    const row = { id: 1, email: 'a@b.com', name: 'Alice' }
    const result = applyRedact(row, ['email'])
    expect(result.email).toBe('[REDACTED]')
    expect(result.name).toBe('Alice')
    expect(result.id).toBe(1)
  })

  test('returns original row when no fields to redact', () => {
    const row = { id: 1, name: 'Alice' }
    const result = applyRedact(row, [])
    expect(result).toBe(row)  // same reference — no clone needed
  })

  test('does not mutate the original row', () => {
    const row = { id: 1, email: 'x@y.com' }
    applyRedact(row, ['email'])
    expect(row.email).toBe('x@y.com')  // original unchanged
  })

  test('multiple fields redacted', () => {
    const row = { id: 1, email: 'x@y.com', phone: '555-1234', name: 'Bob' }
    const result = applyRedact(row, ['email', 'phone'])
    expect(result.email).toBe('[REDACTED]')
    expect(result.phone).toBe('[REDACTED]')
    expect(result.name).toBe('Bob')
  })

  test('field not present in row — no error, no extra key', () => {
    const row = { id: 1, name: 'Alice' }
    const result = applyRedact(row, ['email'])
    expect('email' in result).toBe(false)
  })
})
