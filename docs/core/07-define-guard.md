---
title: "defineGuard"
category: "core"
tags: ["guard", "auth", "authorization", "security"]
related: ["defineModule", "definePlugin", "JWT Plugin"]
---

# defineGuard

Creates a guard — a function that runs before a route handler and can block the request by throwing an error.

## Signature

```ts
function defineGuard(name: string): GuardBuilder
```

## Basic Example

```ts
import { defineGuard, UnauthorizedError } from 'oakbun'
import type { JwtPayload } from '@oakbun/jwt'

export const requireAuth = defineGuard('requireAuth')
  .check<{ jwtUser?: JwtPayload }>((ctx) => {
    if (!ctx.jwtUser) {
      throw new UnauthorizedError('Authentication required')
    }
  })
```

## Full Example

```ts
import { defineGuard, UnauthorizedError, ForbiddenError } from 'oakbun'
import type { JwtPayload } from '@oakbun/jwt'

// Simple auth guard
export const requireAuth = defineGuard('requireAuth')
  .options({ log: { level: 'warn' } })
  .check<{ jwtUser?: JwtPayload }>((ctx) => {
    if (!ctx.jwtUser) throw new UnauthorizedError('Authentication required')
  })

// Parameterized role guard
export const requireRole = (role: string) =>
  defineGuard(`requireRole:${role}`)
    .options({ log: { level: 'warn' } })
    .check<{ jwtUser?: JwtPayload }>((ctx) => {
      if (!ctx.jwtUser) throw new UnauthorizedError('Authentication required')
      if (ctx.jwtUser['role'] !== role) {
        throw new ForbiddenError(`Role '${role}' required`)
      }
    })
```

## Applying Guards

**Module-level:** applies to all routes in the module.

```ts
defineModule('/posts')
  .guard(requireAuth)
  .get('/', async (ctx) => ctx.json(await ctx.posts.findAll()))
  .build()
```

**Per-route:** overrides the module guard.

```ts
defineModule('/posts')
  .guard(requireAuth)
  .get('/public', { guard: false, handler: (ctx) => ctx.json([]) })
  .get('/admin',  { guard: requireRole('admin'), handler: ... })
  .build()
```

**App-level:** applied to all routes via `app.use()` (via a plugin).

## GuardBuilder Methods

| Method | Description |
|---|---|
| `.options(opts)` | Log options |
| `.check<TAdd>(fn)` | Provide the guard function — throws to block, returns to allow |

## Guard Function Signature

```ts
type GuardCheck<TCtx> = (ctx: TCtx) => void | Promise<void>
```

The guard function **throws** to block — returning (even `undefined`) allows the request to proceed. Use standard error classes for consistent HTTP responses:

| Error | HTTP Status |
|---|---|
| `UnauthorizedError` | 401 |
| `ForbiddenError` | 403 |
| `BadRequestError` | 400 |

## Guard Type

```ts
type Guard<TCtx> = (ctx: TCtx) => Response | null | Promise<Response | null>
```

`defineGuard` produces a `Guard` that internally wraps the check function and converts thrown errors to `Response` objects.

## See Also

- [Guards & Auth Guide](../guides/02-guards-and-auth.md)
- [defineModule](./02-define-module.md)
- [JWT Plugin](../plugins/02-jwt-plugin.md)
- [Error Handling](../guides/01-error-handling.md)
