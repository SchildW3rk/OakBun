import { describe, test, expect } from 'bun:test'
import {
  OakBunError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableError,
  TooManyRequestsError,
  InternalError,
} from '../../packages/core/src/errors/index'
import { ValidationError, createApp } from '../../packages/core/src/index'

// ── 1. OakBunError base class ───────────────────────────────────────────────────

describe('OakBunError — base class', () => {
  test('constructs with message, status, code', () => {
    const err = new OakBunError('something failed', 418, 'IM_A_TEAPOT')
    expect(err.message).toBe('something failed')
    expect(err.status).toBe(418)
    expect(err.code).toBe('IM_A_TEAPOT')
    expect(err.name).toBe('OakBunError')
  })

  test('instanceof Error', () => {
    expect(new OakBunError('x', 500, 'X') instanceof Error).toBe(true)
  })
})

// ── 2. Each error class — status + default code ───────────────────────────────

describe('Error subclasses — status + default code', () => {
  test('BadRequestError — 400 + BAD_REQUEST', () => {
    const err = new BadRequestError()
    expect(err.status).toBe(400)
    expect(err.code).toBe('BAD_REQUEST')
    expect(err.name).toBe('BadRequestError')
  })

  test('UnauthorizedError — 401 + UNAUTHORIZED', () => {
    const err = new UnauthorizedError()
    expect(err.status).toBe(401)
    expect(err.code).toBe('UNAUTHORIZED')
    expect(err.name).toBe('UnauthorizedError')
  })

  test('ForbiddenError — 403 + FORBIDDEN', () => {
    const err = new ForbiddenError()
    expect(err.status).toBe(403)
    expect(err.code).toBe('FORBIDDEN')
    expect(err.name).toBe('ForbiddenError')
  })

  test('NotFoundError — 404 + NOT_FOUND', () => {
    const err = new NotFoundError()
    expect(err.status).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.name).toBe('NotFoundError')
  })

  test('ConflictError — 409 + CONFLICT', () => {
    const err = new ConflictError()
    expect(err.status).toBe(409)
    expect(err.code).toBe('CONFLICT')
    expect(err.name).toBe('ConflictError')
  })

  test('UnprocessableError — 422 + UNPROCESSABLE', () => {
    const err = new UnprocessableError()
    expect(err.status).toBe(422)
    expect(err.code).toBe('UNPROCESSABLE')
    expect(err.name).toBe('UnprocessableError')
  })

  test('TooManyRequestsError — 429 + TOO_MANY_REQUESTS', () => {
    const err = new TooManyRequestsError()
    expect(err.status).toBe(429)
    expect(err.code).toBe('TOO_MANY_REQUESTS')
    expect(err.name).toBe('TooManyRequestsError')
  })

  test('InternalError — 500 + INTERNAL_ERROR', () => {
    const err = new InternalError()
    expect(err.status).toBe(500)
    expect(err.code).toBe('INTERNAL_ERROR')
    expect(err.name).toBe('InternalError')
  })
})

// ── 3. Custom code overrides default ─────────────────────────────────────────

describe('Custom code', () => {
  test('NotFoundError with custom code', () => {
    const err = new NotFoundError('User not found', 'USER_NOT_FOUND')
    expect(err.message).toBe('User not found')
    expect(err.code).toBe('USER_NOT_FOUND')
    expect(err.status).toBe(404)
  })

  test('ConflictError with custom code', () => {
    const err = new ConflictError('Email already taken', 'EMAIL_DUPLICATE')
    expect(err.message).toBe('Email already taken')
    expect(err.code).toBe('EMAIL_DUPLICATE')
    expect(err.status).toBe(409)
  })

  test('BadRequestError with custom message + code', () => {
    const err = new BadRequestError('Invalid date format', 'INVALID_DATE')
    expect(err.message).toBe('Invalid date format')
    expect(err.code).toBe('INVALID_DATE')
  })
})

// ── 4. _handleError — structured JSON response ────────────────────────────────

describe('_handleError — built-in fallback produces structured JSON', () => {
  test('NotFoundError → 404 with error + code + message', async () => {
    const app = createApp()
    app.get('/users/:id', (ctx) => {
      throw new NotFoundError(`User with id ${ctx.params.id} not found`, 'USER_NOT_FOUND')
    })

    const res = await app.fetch(new Request('http://localhost/users/99'))
    expect(res.status).toBe(404)
    const body = await res.json() as { error: string; code: string; message: string }
    expect(body.error).toBe('NotFoundError')
    expect(body.code).toBe('USER_NOT_FOUND')
    expect(body.message).toBe('User with id 99 not found')
  })

  test('ConflictError → 409 with correct code', async () => {
    const app = createApp()
    app.post('/items', () => {
      throw new ConflictError('Slug already taken', 'SLUG_DUPLICATE')
    })

    const res = await app.fetch(new Request('http://localhost/items', { method: 'POST' }))
    expect(res.status).toBe(409)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('SLUG_DUPLICATE')
  })

  test('UnauthorizedError → 401', async () => {
    const app = createApp()
    app.get('/secure', () => { throw new UnauthorizedError() })

    const res = await app.fetch(new Request('http://localhost/secure'))
    expect(res.status).toBe(401)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('UNAUTHORIZED')
  })

  test('ForbiddenError → 403', async () => {
    const app = createApp()
    app.get('/admin', () => { throw new ForbiddenError('Not an admin', 'NOT_ADMIN') })

    const res = await app.fetch(new Request('http://localhost/admin'))
    expect(res.status).toBe(403)
    const body = await res.json() as { code: string; message: string }
    expect(body.code).toBe('NOT_ADMIN')
    expect(body.message).toBe('Not an admin')
  })

  test('unknown error → 500 + INTERNAL_ERROR', async () => {
    const app = createApp()
    app.get('/boom', () => { throw new Error('unexpected') })

    const res = await app.fetch(new Request('http://localhost/boom'))
    expect(res.status).toBe(500)
    const body = await res.json() as { error: string; code: string }
    expect(body.error).toBe('Internal Server Error')
    expect(body.code).toBe('INTERNAL_ERROR')
  })
})

// ── 5. ValidationError — includes issues ──────────────────────────────────────

describe('ValidationError — structured response with issues', () => {
  test('ValidationError → 422 with code + issues', async () => {
    const { z } = await import('zod')
    const app = createApp()
    app.post('/validate',
      { body: z.object({ name: z.string().min(1), email: z.string().email() }) },
      (ctx) => ctx.json({ ok: ctx.body }),
    )

    const res = await app.fetch(new Request('http://localhost/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    }))
    expect(res.status).toBe(422)
    const body = await res.json() as { error: string; code: string; issues: unknown[] }
    expect(body.error).toBe('Validation Error')
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(Array.isArray(body.issues)).toBe(true)
    expect(body.issues.length).toBeGreaterThan(0)
  })
})

// ── 6. OakBunError instanceof checks ───────────────────────────────────────────

describe('OakBunError — instanceof chain', () => {
  test('NotFoundError instanceof OakBunError and Error', () => {
    const err = new NotFoundError()
    expect(err instanceof NotFoundError).toBe(true)
    expect(err instanceof OakBunError).toBe(true)
    expect(err instanceof Error).toBe(true)
  })

  test('ValidationError instanceof OakBunError', () => {
    const { ZodError } = require('zod')
    const zodErr = new ZodError([])
    const err = new ValidationError(zodErr)
    expect(err instanceof OakBunError).toBe(true)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.status).toBe(422)
  })
})
