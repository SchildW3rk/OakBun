// types.test.ts — compile-time type assertions only
// No test() blocks needed — TypeScript must accept or reject each line as documented.

import { z } from 'zod'
import { createApp } from '../../packages/core/src/app/index'
import { createClient } from '../../packages/core/src/client/index'

// ── Build a typed app ──────────────────────────────────────────────────────────

const app = createApp()
  .get(
    '/users/:id',
    {
      params:   z.object({ id: z.coerce.number() }),
      response: z.object({ id: z.number(), name: z.string() }),
    },
    (ctx) => ctx.json({ id: ctx.params.id, name: 'test' }),
  )
  .post(
    '/users',
    {
      body:     z.object({ name: z.string() }),
      response: z.object({ id: z.number(), name: z.string() }),
    },
    (ctx) => ctx.json({ id: 1, name: ctx.body.name }, 201),
  )
  .get(
    '/search',
    {
      query:    z.object({ q: z.string() }),
      response: z.object({ results: z.array(z.string()) }),
    },
    (ctx) => ctx.json({ results: [ctx.query.q] }),
  )

const client = createClient<typeof app>('http://localhost')

// ── Type assertion helpers (async IIFE — never actually runs) ──────────────────
// Wrapped in async function so we can use await without top-level await issues.
// The function is never called — only the types matter.

void (async () => {
  // ✅ GET /users/:id → response has name: string
  const r = await client.get('/users/:id', { params: { id: 1 } })
  const _nameOk: string = r.name  // must compile

  // ❌ name is string, not number
  // @ts-expect-error
  const _nameFail: number = r.name  // directive consumed

  // ❌ path does not exist in TRoutes
  // @ts-expect-error
  await client.get('/nonexistent')  // directive consumed

  // ❌ id is z.coerce.number() → infer<ZodCoerce<ZodNumber>> = number, not string
  // @ts-expect-error
  await client.get('/users/:id', { params: { id: 'str' } })  // directive consumed

  // ❌ POST /users body.name must be string, not number
  // @ts-expect-error
  await client.post('/users', { body: { name: 123 } })  // directive consumed

  // ❌ GET /search query.q must be string, not number
  // @ts-expect-error
  await client.get('/search', { query: { q: 123 } })  // directive consumed
})
