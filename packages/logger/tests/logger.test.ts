import { describe, test, expect, spyOn, beforeEach } from 'bun:test'
import { createLogger } from '../src/index'

describe('createLogger', () => {
  test('info logs to console.log', () => {
    const spy = spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger({ format: 'json', timestamp: false })
    logger.info('hello')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  test('warn logs to console.warn', () => {
    const spy = spyOn(console, 'warn').mockImplementation(() => {})
    const logger = createLogger({ format: 'json' })
    logger.warn('watch out')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  test('error logs to console.error', () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    const logger = createLogger({ format: 'json' })
    logger.error('boom')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  test('debug is suppressed at info level', () => {
    const logSpy   = spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy  = spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const logger = createLogger({ level: 'info', format: 'json' })
    logger.debug('verbose')
    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  test('debug logs when level=debug', () => {
    const spy = spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger({ level: 'debug', format: 'json' })
    logger.debug('verbose')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  test('child inherits scope chain', () => {
    const messages: string[] = []
    spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      messages.push(String(args[0]))
    })
    const logger = createLogger({ scope: 'app', format: 'json' })
    const child = logger.child('users')
    child.info('created')
    expect(messages[0]).toContain('app.users')
    ;(console.log as ReturnType<typeof spyOn>).mockRestore()
  })

  test('child of child builds nested scope', () => {
    const messages: string[] = []
    spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      messages.push(String(args[0]))
    })
    const logger = createLogger({ format: 'json' })
    const child = logger.child('a').child('b')
    child.info('deep')
    expect(messages[0]).toContain('a.b')
    ;(console.log as ReturnType<typeof spyOn>).mockRestore()
  })

  test('masks sensitive fields in JSON output', () => {
    const messages: string[] = []
    spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      messages.push(String(args[0]))
    })
    const logger = createLogger({ format: 'json' })
    logger.info('auth', { token: 'secret-value', userId: 1 })
    const parsed = JSON.parse(messages[0]!) as Record<string, unknown>
    expect(parsed['token']).toBe('***')
    expect(parsed['userId']).toBe(1)
    ;(console.log as ReturnType<typeof spyOn>).mockRestore()
  })

  test('does not log below the configured level', () => {
    const messages: string[] = []
    const logSpy  = spyOn(console, 'log').mockImplementation((...args: unknown[]) => { messages.push(String(args[0])) })
    const warnSpy = spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { messages.push(String(args[0])) })
    const logger = createLogger({ level: 'error', format: 'json' })
    logger.info('ignored')
    logger.warn('also ignored')
    expect(messages).toHaveLength(0)
    logSpy.mockRestore()
    warnSpy.mockRestore()
  })
})
