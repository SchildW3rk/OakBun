import { describe, test, expect } from 'bun:test'
import { matchPath, parseQuery } from '../../packages/core/src/app/router'

describe('matchPath', () => {
  test('exact match — /users', () => {
    const result = matchPath('/users', '/users')
    expect(result).not.toBeNull()
    expect(result!.params).toEqual({})
  })

  test(':param match — /users/:id extracts id', () => {
    const result = matchPath('/users/:id', '/users/42')
    expect(result).not.toBeNull()
    expect(result!.params).toEqual({ id: '42' })
  })

  test('multiple params — /orgs/:org/repos/:repo', () => {
    const result = matchPath('/orgs/:org/repos/:repo', '/orgs/veln/repos/core')
    expect(result).not.toBeNull()
    expect(result!.params).toEqual({ org: 'veln', repo: 'core' })
  })

  test('no match — returns null', () => {
    const result = matchPath('/users/:id', '/products/42')
    expect(result).toBeNull()
  })

  test('trailing slash does not affect match', () => {
    const result = matchPath('/users/', '/users')
    expect(result).not.toBeNull()

    const result2 = matchPath('/users', '/users/')
    expect(result2).not.toBeNull()
  })

  test('root path matches root', () => {
    const result = matchPath('/', '/')
    expect(result).not.toBeNull()
    expect(result!.params).toEqual({})
  })

  test('different segment count — no match', () => {
    const result = matchPath('/users/:id', '/users/42/extra')
    expect(result).toBeNull()
  })
})

describe('matchPath — optional params and wildcards', () => {
  test('/:id? matches with id', () => {
    const result = matchPath('/users/:id?', '/users/42')
    expect(result).not.toBeNull()
    expect(result?.params['id']).toBe('42')
  })

  test('/:id? matches without id', () => {
    const result = matchPath('/users/:id?', '/users')
    expect(result).not.toBeNull()
    expect(result?.params['id']).toBeUndefined()
  })

  test('/files/* matches deep path', () => {
    const result = matchPath('/files/*', '/files/a/b/c')
    expect(result).not.toBeNull()
    expect(result?.params['*']).toBe('a/b/c')
  })

  test('/files/* matches single segment', () => {
    const result = matchPath('/files/*', '/files/doc.pdf')
    expect(result).not.toBeNull()
    expect(result?.params['*']).toBe('doc.pdf')
  })

  test('/files/* does not match /files (no trailing segment)', () => {
    const result = matchPath('/files/*', '/files')
    expect(result).toBeNull()
  })

  test('exact route still matches exactly', () => {
    const result = matchPath('/users/count', '/users/count')
    expect(result).not.toBeNull()
    expect(Object.keys(result?.params ?? {})).toHaveLength(0)
  })

  test('wildcard captures everything after prefix', () => {
    const result = matchPath('/api/*', '/api/v1/users/42')
    expect(result?.params['*']).toBe('v1/users/42')
  })
})

describe('wildcard routing integration', () => {
  test('wildcard route matches in app.fetch()', async () => {
    const { createApp } = await import('../../packages/core/src/app/index')
    const app = createApp()
    app.get('/files/*', (ctx) => ctx.json({ wildcard: ctx.params['*'] }))
    const res = await app.fetch(new Request('http://localhost/files/images/logo.png'))
    expect(res.status).toBe(200)
    const body = await res.json() as { wildcard: string }
    expect(body.wildcard).toBe('images/logo.png')
  })

  test('optional param route matches with and without param', async () => {
    const { createApp } = await import('../../packages/core/src/app/index')
    const app = createApp()
    app.get('/users/:id?', (ctx) => ctx.json({ id: ctx.params['id'] ?? null }))

    const withId = await app.fetch(new Request('http://localhost/users/42'))
    expect((await withId.json() as { id: string }).id).toBe('42')

    const withoutId = await app.fetch(new Request('http://localhost/users'))
    expect((await withoutId.json() as { id: null }).id).toBeNull()
  })
})

describe('parseQuery', () => {
  test('empty string → empty object', () => {
    expect(parseQuery('')).toEqual({})
  })

  test('single param', () => {
    expect(parseQuery('foo=bar')).toEqual({ foo: 'bar' })
  })

  test('multiple params', () => {
    expect(parseQuery('a=1&b=2')).toEqual({ a: '1', b: '2' })
  })

  test('duplicate key → array', () => {
    const result = parseQuery('tag=a&tag=b&tag=c')
    expect(result).toEqual({ tag: ['a', 'b', 'c'] })
  })

  test('?-prefix handled correctly', () => {
    expect(parseQuery('?foo=bar')).toEqual({ foo: 'bar' })
  })

  test('empty value', () => {
    expect(parseQuery('key=')).toEqual({ key: '' })
  })
})
