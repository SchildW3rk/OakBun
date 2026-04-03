import { describe, test, expect } from 'bun:test'
import { z } from 'zod'
import { zodToJsonSchema } from '../../packages/core/src/openapi/zod-to-schema'

describe('zodToJsonSchema', () => {
  test('z.string() → { type: string }', () => {
    expect(zodToJsonSchema(z.string())).toEqual({ type: 'string' })
  })

  test('z.string().email() → { type: string, format: email }', () => {
    expect(zodToJsonSchema(z.string().email())).toEqual({ type: 'string', format: 'email' })
  })

  test('z.string().min(3) → { type: string, minLength: 3 }', () => {
    expect(zodToJsonSchema(z.string().min(3))).toEqual({ type: 'string', minLength: 3 })
  })

  test('z.string().max(10) → { type: string, maxLength: 10 }', () => {
    expect(zodToJsonSchema(z.string().max(10))).toEqual({ type: 'string', maxLength: 10 })
  })

  test('z.string().min(3).max(10) → { type: string, minLength: 3, maxLength: 10 }', () => {
    expect(zodToJsonSchema(z.string().min(3).max(10))).toEqual({
      type: 'string',
      minLength: 3,
      maxLength: 10,
    })
  })

  test('z.number() → { type: number }', () => {
    expect(zodToJsonSchema(z.number())).toEqual({ type: 'number' })
  })

  test('z.coerce.number() → { type: number }', () => {
    expect(zodToJsonSchema(z.coerce.number())).toEqual({ type: 'number' })
  })

  test('z.boolean() → { type: boolean }', () => {
    expect(zodToJsonSchema(z.boolean())).toEqual({ type: 'boolean' })
  })

  test('z.enum([...]) → { type: string, enum: [...] }', () => {
    expect(zodToJsonSchema(z.enum(['a', 'b', 'c']))).toEqual({
      type: 'string',
      enum: ['a', 'b', 'c'],
    })
  })

  test('z.array(z.string()) → { type: array, items: { type: string } }', () => {
    expect(zodToJsonSchema(z.array(z.string()))).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
  })

  test('z.array(z.number()) → { type: array, items: { type: number } }', () => {
    expect(zodToJsonSchema(z.array(z.number()))).toEqual({
      type: 'array',
      items: { type: 'number' },
    })
  })

  test('z.optional(z.string()) → unwrapped inner schema', () => {
    expect(zodToJsonSchema(z.optional(z.string()))).toEqual({ type: 'string' })
  })

  test('z.nullable(z.string()) → { type: [string, null] }', () => {
    expect(zodToJsonSchema(z.nullable(z.string()))).toEqual({ type: ['string', 'null'] })
  })

  test('z.object with required fields', () => {
    const schema = z.object({ name: z.string(), age: z.number() })
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name', 'age'],
    })
  })

  test('z.object with optional fields — omitted from required', () => {
    const schema = z.object({ name: z.string(), age: z.optional(z.number()) })
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    })
  })

  test('z.object with all optional fields — no required array', () => {
    const schema = z.object({ name: z.optional(z.string()) })
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    })
  })

  test('unknown type → empty schema {}', () => {
    // Use a literal type which has _def.type='literal'
    const litSchema = z.literal('foo')
    expect(zodToJsonSchema(litSchema)).toEqual({})
  })
})

describe('zodToJsonSchema — number constraints', () => {
  test('z.number().min(1) → minimum: 1', () => {
    expect(zodToJsonSchema(z.number().min(1))).toEqual({ type: 'number', minimum: 1 })
  })

  test('z.number().max(100) → maximum: 100', () => {
    expect(zodToJsonSchema(z.number().max(100))).toEqual({ type: 'number', maximum: 100 })
  })

  test('z.number().min(1).max(100) → minimum and maximum', () => {
    expect(zodToJsonSchema(z.number().min(1).max(100))).toEqual({
      type: 'number',
      minimum: 1,
      maximum: 100,
    })
  })

  test('z.number().gt(0) → exclusiveMinimum: 0', () => {
    expect(zodToJsonSchema(z.number().gt(0))).toEqual({ type: 'number', exclusiveMinimum: 0 })
  })

  test('z.number().lt(10) → exclusiveMaximum: 10', () => {
    expect(zodToJsonSchema(z.number().lt(10))).toEqual({ type: 'number', exclusiveMaximum: 10 })
  })
})

describe('zodToJsonSchema — string formats', () => {
  test('z.string().uuid() → format: uuid', () => {
    expect(zodToJsonSchema(z.string().uuid())).toEqual({ type: 'string', format: 'uuid' })
  })

  test('z.string().url() → format: uri', () => {
    expect(zodToJsonSchema(z.string().url())).toEqual({ type: 'string', format: 'uri' })
  })

  test('z.string().datetime() → format: date-time', () => {
    expect(zodToJsonSchema(z.string().datetime())).toEqual({ type: 'string', format: 'date-time' })
  })

  test('z.string().date() → format: date', () => {
    expect(zodToJsonSchema(z.string().date())).toEqual({ type: 'string', format: 'date' })
  })
})

describe('zodToJsonSchema — default', () => {
  test('z.number().default(50) → includes default: 50', () => {
    expect(zodToJsonSchema(z.number().default(50))).toEqual({ type: 'number', default: 50 })
  })

  test('z.string().default("asc") → includes default: "asc"', () => {
    expect(zodToJsonSchema(z.string().default('asc'))).toEqual({ type: 'string', default: 'asc' })
  })

  test('z.number().min(1).max(100).default(10) → min, max and default', () => {
    expect(zodToJsonSchema(z.number().min(1).max(100).default(10))).toEqual({
      type: 'number',
      minimum: 1,
      maximum: 100,
      default: 10,
    })
  })
})

describe('zodToJsonSchema — description', () => {
  test('z.string().describe() → description in schema', () => {
    expect(zodToJsonSchema(z.string().describe('The user email'))).toEqual({
      type: 'string',
      description: 'The user email',
    })
  })

  test('z.number().describe() → description in schema', () => {
    expect(zodToJsonSchema(z.number().describe('Page size'))).toEqual({
      type: 'number',
      description: 'Page size',
    })
  })

  test('z.optional(z.string()).describe() → description preserved', () => {
    const schema = z.optional(z.string()).describe('Optional filter')
    const result = zodToJsonSchema(schema)
    expect(result['description']).toBe('Optional filter')
    expect(result['type']).toBe('string')
  })

  test('z.nullable(z.string()).describe() → description preserved', () => {
    const schema = z.nullable(z.string()).describe('Nullable field')
    const result = zodToJsonSchema(schema)
    expect(result['description']).toBe('Nullable field')
  })

  test('z.string().describe() + .email() → description and format', () => {
    expect(zodToJsonSchema(z.string().email().describe('User email address'))).toEqual({
      type: 'string',
      format: 'email',
      description: 'User email address',
    })
  })
})

describe('generateOpenApiSpec — docs.responses', () => {
  test('docs.responses adds extra response codes', async () => {
    const { createApp } = await import('../../packages/core/src/app/index')
    const app = createApp()
    app.get('/users', {
      docs: {
        responses: {
          401: { description: 'Unauthorized' },
          404: { description: 'Not found' },
        },
      },
      handler: (ctx) => ctx.json([]),
    })
    const spec = app.getOpenApiSpec()
    const op = spec.paths['/users']!['get']!
    expect(op.responses['401']).toEqual({ description: 'Unauthorized' })
    expect(op.responses['404']).toEqual({ description: 'Not found' })
    expect(op.responses['200']).toEqual({ description: 'Success' })
  })

  test('200 response from schema is not overwritten by docs.responses', async () => {
    const { createApp } = await import('../../packages/core/src/app/index')
    const { z } = await import('zod')
    const app = createApp()
    app.get('/ping', {
      response: z.object({ ok: z.boolean() }),
      docs: {
        responses: {
          401: { description: 'Unauthorized' },
        },
      },
      handler: (ctx) => ctx.json({ ok: true }),
    })
    const spec = app.getOpenApiSpec()
    const op = spec.paths['/ping']!['get']!
    expect(op.responses['200']!.content).toBeDefined()
    expect(op.responses['401']).toEqual({ description: 'Unauthorized' })
  })
})
