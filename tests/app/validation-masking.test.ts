import { describe, test, expect } from 'bun:test'
import { z } from 'zod'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'

// ── Helpers ───────────────────────────────────────────────────────────────────

const invalidBody = JSON.stringify({ name: '', qty: -5 })
const bodyHeaders = { 'Content-Type': 'application/json' }

function makeSchema() {
  return z.object({
    name:     z.string().min(3),
    qty:      z.number().int().positive(),
    category: z.enum(['a', 'b', 'c']),
  })
}

async function postInvalid(app: ReturnType<typeof createApp>, path: string) {
  return app.fetch(new Request(`http://localhost${path}`, {
    method:  'POST',
    headers: bodyHeaders,
    body:    invalidBody,
  }))
}

// ── Masked issue shape ────────────────────────────────────────────────────────

type MaskedIssue  = { path: (string | number)[]; message: string }
type RawIssue     = { path: (string | number)[]; message: string; code: string; [key: string]: unknown }

// ── Case 1 — Default: issues are masked ──────────────────────────────────────
//
// BREAKING CHANGE (Spec 12): createApp() without options now masks validation
// issues. Previously, raw Zod issues were always returned. To restore the old
// behaviour, use createApp({ validation: { exposeIssues: true } }).

describe('Default (no config) → issues are masked', () => {
  test('issues contain only path and generic message — no code, minimum, type', async () => {
    const mod = defineModule('/api')
      .post('/items', {
        body:    makeSchema(),
        handler: (ctx) => ctx.json({ ok: true }),
      })
      .build()

    const app = createApp()
    app.register(mod)

    const res = await postInvalid(app, '/api/items')
    expect(res.status).toBe(422)

    const body = await res.json() as { code: string; issues: MaskedIssue[] }
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(Array.isArray(body.issues)).toBe(true)
    expect(body.issues.length).toBeGreaterThan(0)

    for (const issue of body.issues) {
      // Masked shape: only path + generic message
      expect(issue).toHaveProperty('path')
      expect(issue).toHaveProperty('message')
      expect(issue.message).toBe('Invalid value')

      // Raw Zod fields must NOT be present
      expect(issue).not.toHaveProperty('code')
      expect(issue).not.toHaveProperty('minimum')
      expect(issue).not.toHaveProperty('type')
      expect(issue).not.toHaveProperty('inclusive')
      expect(issue).not.toHaveProperty('exact')
      expect(issue).not.toHaveProperty('options')
    }
  })

  test('path is preserved in masked issues', async () => {
    const app = createApp()
    app.post('/validate', {
      body:    z.object({ email: z.string().email() }),
      handler: (ctx) => ctx.json({ ok: true }),
    })

    const res = await app.fetch(new Request('http://localhost/validate', {
      method:  'POST',
      headers: bodyHeaders,
      body:    JSON.stringify({ email: 'not-an-email' }),
    }))

    expect(res.status).toBe(422)
    const body = await res.json() as { issues: MaskedIssue[] }
    expect(body.issues[0].path).toEqual(['email'])
    expect(body.issues[0].message).toBe('Invalid value')
  })
})

// ── Case 2 — Explicit exposeIssues: false → same as default ──────────────────

describe('exposeIssues: false (explicit) → issues masked', () => {
  test('same masked output as default', async () => {
    const app = createApp({ validation: { exposeIssues: false } })
    app.post('/check', {
      body:    z.object({ value: z.number().positive() }),
      handler: (ctx) => ctx.json({ ok: true }),
    })

    const res = await app.fetch(new Request('http://localhost/check', {
      method:  'POST',
      headers: bodyHeaders,
      body:    JSON.stringify({ value: -1 }),
    }))

    expect(res.status).toBe(422)
    const body = await res.json() as { issues: MaskedIssue[] }
    expect(body.issues[0].message).toBe('Invalid value')
    expect(body.issues[0]).not.toHaveProperty('minimum')
  })
})

// ── Case 3 — exposeIssues: true → raw Zod issues ─────────────────────────────

describe('exposeIssues: true → raw Zod issues returned', () => {
  test('issues contain full Zod detail — code, minimum, type present', async () => {
    const app = createApp({ validation: { exposeIssues: true } })
    app.post('/dev', {
      body:    z.object({ password: z.string().min(8) }),
      handler: (ctx) => ctx.json({ ok: true }),
    })

    const res = await app.fetch(new Request('http://localhost/dev', {
      method:  'POST',
      headers: bodyHeaders,
      body:    JSON.stringify({ password: 'short' }),
    }))

    expect(res.status).toBe(422)
    const body = await res.json() as { issues: RawIssue[] }
    expect(body.issues.length).toBeGreaterThan(0)

    const issue = body.issues[0]
    // Raw Zod issue fields are present
    expect(issue).toHaveProperty('code')
    expect(issue).toHaveProperty('message')
    expect(issue.path).toEqual(['password'])
    // The actual Zod message is not replaced — it contains length info
    expect(issue.message).not.toBe('Invalid value')
  })

  test('enum validation exposes options in raw mode', async () => {
    const app = createApp({ validation: { exposeIssues: true } })
    app.post('/enum', {
      body:    z.object({ role: z.enum(['admin', 'user']) }),
      handler: (ctx) => ctx.json({ ok: true }),
    })

    const res = await app.fetch(new Request('http://localhost/enum', {
      method:  'POST',
      headers: bodyHeaders,
      body:    JSON.stringify({ role: 'superuser' }),
    }))

    expect(res.status).toBe(422)
    const body = await res.json() as { issues: RawIssue[] }
    // In raw mode, Zod includes valid values — schema info exposed
    // (Zod v4 uses 'values' field for enum issues)
    expect(body.issues[0]).toHaveProperty('values')
  })

  test('enum validation hides options in masked mode (default)', async () => {
    const app = createApp()  // exposeIssues: false by default
    app.post('/enum-masked', {
      body:    z.object({ role: z.enum(['admin', 'user']) }),
      handler: (ctx) => ctx.json({ ok: true }),
    })

    const res = await app.fetch(new Request('http://localhost/enum-masked', {
      method:  'POST',
      headers: bodyHeaders,
      body:    JSON.stringify({ role: 'superuser' }),
    }))

    expect(res.status).toBe(422)
    const body = await res.json() as { issues: MaskedIssue[] }
    // Masked: no values/options field that would reveal valid enum values
    expect(body.issues[0]).not.toHaveProperty('values')
    expect(body.issues[0]).not.toHaveProperty('options')
    expect(body.issues[0].message).toBe('Invalid value')
  })
})

// ── Case 4 — Multiple issues → all masked ────────────────────────────────────

describe('Multiple issues → all masked in default mode', () => {
  test('three failing fields → three masked issues, all with generic message', async () => {
    const app = createApp()
    app.post('/multi', {
      body:    makeSchema(),
      handler: (ctx) => ctx.json({ ok: true }),
    })

    // All three fields fail: name too short, qty negative, category wrong type
    const res = await app.fetch(new Request('http://localhost/multi', {
      method:  'POST',
      headers: bodyHeaders,
      body:    JSON.stringify({ name: 'x', qty: -1, category: 'z' }),
    }))

    expect(res.status).toBe(422)
    const body = await res.json() as { issues: MaskedIssue[] }
    expect(body.issues.length).toBeGreaterThanOrEqual(3)

    for (const issue of body.issues) {
      expect(issue.message).toBe('Invalid value')
      expect(issue).not.toHaveProperty('code')
      expect(issue).not.toHaveProperty('minimum')
    }
  })
})

// ── Case 5 — onError bypass: raw issues still accessible ─────────────────────
//
// The masking only applies to the built-in fallback response builder.
// Custom onError handlers receive the ValidationError object directly and
// can access err.issues (raw ZodIssues) regardless of exposeIssues setting.

describe('Custom onError still receives raw ZodIssues', () => {
  test('onError gets full err.issues even when exposeIssues: false', async () => {
    const { ValidationError } = await import('../../packages/core/src/app/types')

    let rawIssueCode: string | undefined

    const app = createApp()  // masked by default
    app.post('/guarded', {
      body:    z.object({ count: z.number().positive() }),
      handler: (ctx) => ctx.json({ ok: true }),
    })

    app.onError((err, ctx) => {
      if (err instanceof ValidationError) {
        // Raw Zod issues accessible here — exposeIssues only affects HTTP response
        rawIssueCode = err.issues[0]?.code
        return ctx.json({ handled: true }, 422)
      }
      return ctx.json({ error: String(err) }, 500)
    })

    await app.fetch(new Request('http://localhost/guarded', {
      method:  'POST',
      headers: bodyHeaders,
      body:    JSON.stringify({ count: -1 }),
    }))

    // onError received the raw ZodIssue code — not 'Invalid value'
    expect(rawIssueCode).toBeDefined()
    expect(rawIssueCode).not.toBe('Invalid value')
  })
})
