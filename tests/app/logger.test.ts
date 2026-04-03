import { describe, test, expect, spyOn } from 'bun:test'
import { createMinimalLogger } from '../../packages/core/src/app/logger'

// ── 1. Scope label ────────────────────────────────────────────────────────────

describe('createMinimalLogger — scope label', () => {
  test('output contains [scope] label', () => {
    const lines: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { lines.push(msg) })
    const logger = createMinimalLogger('service:users')
    logger.info('hello')
    spy.mockRestore()
    expect(lines.some((l) => l.includes('[service:users]'))).toBe(true)
  })

  test('no scope prefix → still has label', () => {
    const lines: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { lines.push(msg) })
    const logger = createMinimalLogger('custom')
    logger.info('x')
    spy.mockRestore()
    expect(lines.some((l) => l.includes('[custom]'))).toBe(true)
  })
})

// ── 2. Level filter ───────────────────────────────────────────────────────────

describe('createMinimalLogger — level filter', () => {
  test('level: "error" — info suppressed', () => {
    const lines: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { lines.push(msg) })
    const logger = createMinimalLogger('test', { level: 'error' })
    logger.info('should not appear')
    spy.mockRestore()
    expect(lines).toHaveLength(0)
  })

  test('level: "error" — error emitted', () => {
    const lines: string[] = []
    const spy = spyOn(console, 'error').mockImplementation((msg: string) => { lines.push(msg) })
    const logger = createMinimalLogger('test', { level: 'error' })
    logger.error('oops')
    spy.mockRestore()
    expect(lines.some((l) => l.includes('oops'))).toBe(true)
  })

  test('default level "info" — debug suppressed', () => {
    const lines: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { lines.push(msg) })
    const logger = createMinimalLogger('test')
    logger.debug('verbose')
    spy.mockRestore()
    expect(lines).toHaveLength(0)
  })

  test('level: "debug" — debug emitted', () => {
    const lines: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { lines.push(msg) })
    const logger = createMinimalLogger('test', { level: 'debug' })
    logger.debug('verbose')
    spy.mockRestore()
    expect(lines.some((l) => l.includes('verbose'))).toBe(true)
  })
})

// ── 3. Silent ─────────────────────────────────────────────────────────────────

describe('createMinimalLogger — silent', () => {
  test('silent: true → no output at all', () => {
    const logSpy   = spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy  = spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    const logger = createMinimalLogger('test', { silent: true })
    logger.info('info')
    logger.warn('warn')
    logger.error('error')
    logger.debug('debug')

    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()

    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

// ── 4. Masking ────────────────────────────────────────────────────────────────

describe('createMinimalLogger — mask', () => {
  test('masked key replaced with ***', () => {
    const lines: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { lines.push(msg) })
    const logger = createMinimalLogger('test', { level: 'info', mask: ['password'] })
    logger.info('login', { password: 'secret', name: 'alice' })
    spy.mockRestore()
    const line = lines.find((l) => l.includes('login'))
    expect(line).toBeDefined()
    expect(line).not.toContain('secret')
    expect(line).toContain('***')
    expect(line).toContain('alice')
  })

  test('mask is case-insensitive', () => {
    const lines: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { lines.push(msg) })
    const logger = createMinimalLogger('test', { level: 'info', mask: ['EMAIL'] })
    logger.info('contact', { email: 'a@b.com', id: 1 })
    spy.mockRestore()
    const line = lines.find((l) => l.includes('contact'))
    expect(line).not.toContain('a@b.com')
    expect(line).toContain('***')
  })

  test('unmasked keys still present', () => {
    const lines: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { lines.push(msg) })
    const logger = createMinimalLogger('test', { level: 'info', mask: ['token'] })
    logger.info('req', { token: 'abc', id: 99 })
    spy.mockRestore()
    const line = lines.find((l) => l.includes('req'))
    expect(line).toContain('99')
  })
})

// ── 5. Data formatting ────────────────────────────────────────────────────────

describe('createMinimalLogger — data formatting', () => {
  test('compact inline for ≤3 keys', () => {
    const lines: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { lines.push(msg) })
    const logger = createMinimalLogger('test', { level: 'info' })
    logger.info('found', { id: 1, name: 'René' })
    spy.mockRestore()
    const line = lines.find((l) => l.includes('found'))
    expect(line).toBeDefined()
    // Compact: all on one line
    expect(line).not.toContain('\n')
    expect(line).toContain('1')
    expect(line).toContain('René')
  })

  test('multi-line for >3 keys', () => {
    const lines: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { lines.push(msg) })
    const logger = createMinimalLogger('test', { level: 'info' })
    logger.info('found', { id: 1, name: 'René', email: 'a@b.com', role: 'admin' })
    spy.mockRestore()
    const line = lines.find((l) => l.includes('found'))
    expect(line).toBeDefined()
    expect(line).toContain('\n')
  })

  test('no data object → no extra output', () => {
    const lines: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { lines.push(msg) })
    const logger = createMinimalLogger('test', { level: 'info' })
    logger.info('ping')
    spy.mockRestore()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('ping')
  })
})

// ── 6. warn / error use correct console methods ───────────────────────────────

describe('createMinimalLogger — console routing', () => {
  test('warn → console.warn', () => {
    const lines: string[] = []
    const spy = spyOn(console, 'warn').mockImplementation((msg: string) => { lines.push(msg) })
    const logger = createMinimalLogger('test')
    logger.warn('watch out')
    spy.mockRestore()
    expect(lines.some((l) => l.includes('watch out'))).toBe(true)
  })

  test('error → console.error', () => {
    const lines: string[] = []
    const spy = spyOn(console, 'error').mockImplementation((msg: string) => { lines.push(msg) })
    const logger = createMinimalLogger('test')
    logger.error('boom')
    spy.mockRestore()
    expect(lines.some((l) => l.includes('boom'))).toBe(true)
  })

  test('info → console.log', () => {
    const lines: string[] = []
    const spy = spyOn(console, 'log').mockImplementation((msg: string) => { lines.push(msg) })
    const logger = createMinimalLogger('test')
    logger.info('hello')
    spy.mockRestore()
    expect(lines.some((l) => l.includes('hello'))).toBe(true)
  })
})
