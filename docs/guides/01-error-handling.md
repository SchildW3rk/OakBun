---
title: "Error Handling"
category: "guides"
tags: ["errors", "exceptions", "onError", "validation"]
related: ["defineGuard", "defineModule", "ctx Reference"]
---

# Error Handling

OakBun converts thrown errors to HTTP responses automatically. Use the built-in error classes for consistent status codes and error codes.

## Built-in Error Classes

```ts
import {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,        // from 'oakbun' via resource/index
  ConflictError,        // from 'oakbun' via resource/index
  UnprocessableError,
  TooManyRequestsError,
  InternalError,
  OakBunError,            // base class
} from 'oakbun'
```

| Class | HTTP Status | Code |
|---|---|---|
| `BadRequestError` | 400 | `BAD_REQUEST` |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` |
| `ForbiddenError` | 403 | `FORBIDDEN` |
| `NotFoundError` | 404 | `NOT_FOUND` |
| `ConflictError` | 409 | `CONFLICT` |
| `UnprocessableError` | 422 | `UNPROCESSABLE` |
| `TooManyRequestsError` | 429 | `TOO_MANY_REQUESTS` |
| `InternalError` | 500 | `INTERNAL_ERROR` |

## Throwing Errors in Handlers

Throw errors anywhere — in route handlers, services, models, or guards:

```ts
.get('/:id', {
  params: z.object({ id: z.coerce.number() }),
  async handler(ctx) {
    const user = await ctx.db.from(usersTable).where({ id: ctx.params.id }).first()
    if (!user) throw new NotFoundError(`User ${ctx.params.id} not found`)
    return ctx.json(user)
  },
})
```

## Error Response Format

All `OakBunError` subclasses produce a consistent JSON response:

```json
{
  "error": "User 42 not found",
  "code":  "NOT_FOUND",
  "status": 404
}
```

## Validation Errors

When a `body`, `params`, or `query` schema fails, OakBun automatically throws a `ValidationError` (status 422):

```ts
.post('/', {
  body: z.object({ email: z.string().email() }),
  async handler(ctx) {
    // ctx.body is validated — invalid requests never reach here
    return ctx.json(await ctx.users.create(ctx.body))
  },
})
```

Validation error response:

```json
{
  "error": "Validation failed",
  "code":  "VALIDATION_ERROR",
  "status": 422,
  "issues": [
    { "path": ["email"], "message": "Invalid email" }
  ]
}
```

## Custom onError Handler

Override error handling at module or app level:

```ts
// App-level
app.onError((err, ctx) => {
  if (err instanceof OakBunError) {
    return ctx.json({ error: err.message, code: err.code }, err.status)
  }
  console.error(err)
  return ctx.json({ error: 'Internal server error' }, 500)
})

// Module-level
defineModule('/api')
  .onError((err, ctx) => {
    // Module-specific error handling
    return ctx.json({ error: err.message }, 500)
  })
```

## OakBunError Base Class

```ts
class OakBunError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code:   string,
  )
}
```

Extend for custom domain errors:

```ts
class PaymentRequiredError extends OakBunError {
  constructor(message = 'Payment required') {
    super(message, 402, 'PAYMENT_REQUIRED')
  }
}
```

## Error Cascade

Errors propagate in this order until handled:
1. Route-level `onError`
2. Module-level `onError`
3. App-level `onError`
4. OakBun's default handler (converts `OakBunError` to JSON, unknown errors to 500)

## See Also

- [defineGuard](../core/07-define-guard.md)
- [defineModule](../core/02-define-module.md)
- [Guards & Auth](./02-guards-and-auth.md)
