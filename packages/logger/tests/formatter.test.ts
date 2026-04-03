import { describe, test, expect } from 'bun:test'
import { formatPretty, formatJson } from '../src/formatter'

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

describe('formatPretty', () => {
  test('includes level, scope, message, and data', () => {
    const line = stripAnsi(formatPretty('info', 'users', 'Created', { id: 1 }, true))
    expect(line).toContain('INFO')
    expect(line).toContain('users')
    expect(line).toContain('Created')
    expect(line).toContain('id=1')
  })

  test('without scope', () => {
    const line = stripAnsi(formatPretty('warn', undefined, 'Rate limit', undefined, false))
    expect(line).toContain('WARN')
    expect(line).toContain('Rate limit')
    expect(line).not.toContain('›')
  })

  test('without timestamp when timestamp=false', () => {
    const line = stripAnsi(formatPretty('info', undefined, 'Hello', undefined, false))
    // HH:MM:SS pattern should not be present at the start when timestamp=false
    expect(line).not.toMatch(/^\d{2}:\d{2}:\d{2}/)
  })

  test('with timestamp when timestamp=true', () => {
    const line = stripAnsi(formatPretty('info', undefined, 'Hello', undefined, true))
    expect(line).toMatch(/\d{2}:\d{2}:\d{2}/)
  })

  test('error level uses ERR  label', () => {
    const line = stripAnsi(formatPretty('error', undefined, 'Boom', undefined, false))
    expect(line).toContain('ERR ')
  })

  test('debug level uses DBG  label', () => {
    const line = stripAnsi(formatPretty('debug', undefined, 'verbose', undefined, false))
    expect(line).toContain('DBG ')
  })

  test('no data — no extra output', () => {
    const line = stripAnsi(formatPretty('info', undefined, 'Clean', undefined, false))
    expect(line).toBe('INFO Clean')
  })
})

describe('formatJson', () => {
  test('flat embedding of data fields', () => {
    const line = formatJson('error', 'db', 'Query failed', { code: 'TIMEOUT' })
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect(parsed['level']).toBe('error')
    expect(parsed['scope']).toBe('db')
    expect(parsed['msg']).toBe('Query failed')
    expect(parsed['code']).toBe('TIMEOUT')
    // data should NOT be nested
    expect(parsed['data']).toBeUndefined()
  })

  test('without data', () => {
    const line = formatJson('info', undefined, 'Started', undefined)
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect(parsed['ts']).toBeDefined()
    expect(parsed['level']).toBe('info')
    expect(parsed['msg']).toBe('Started')
    expect(parsed['scope']).toBeUndefined()
  })

  test('includes iso timestamp', () => {
    const line = formatJson('info', undefined, 'hi', undefined)
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect(typeof parsed['ts']).toBe('string')
    expect(parsed['ts']).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('multiple data fields are all flat', () => {
    const line = formatJson('info', 'api', 'Request', { userId: 42, path: '/users' })
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect(parsed['userId']).toBe(42)
    expect(parsed['path']).toBe('/users')
  })
})
