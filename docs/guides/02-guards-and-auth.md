---
title: "Guards & Auth"
category: "guides"
tags: ["guard", "auth", "authorization", "jwt", "permissions"]
related: ["defineGuard", "JWT Plugin", "Error Handling"]
---

# Guards & Auth

Guards are synchronous or asynchronous functions that run before a route handler. They throw to block, return to allow.

## Defining a Guard

```ts
import { defineGuard, UnauthorizedError, ForbiddenError } from 'oakbun'
import type { JwtPayload } from '@oakbun/jwt'

export const requireAuth = defineGuard('requireAuth')
  .options({ log: { level: 'warn' } })
  .check<{ jwtUser?: JwtPayload }>((ctx) => {
    if (!ctx.jwtUser) throw new UnauthorizedError('Authentication required')
  })

export const requireAdmin = defineGuard('requireAdmin')
  .check<{ jwtUser?: JwtPayload }>((ctx) => {
    if (!ctx.jwtUser) throw new UnauthorizedError('Authentication required')
    if (ctx.jwtUser['role'] !== 'admin') throw new ForbiddenError('Admin only')
  })
```

## Module-Level Guard

Protects all routes in a module:

```ts
defineModule('/posts')
  .plugin(jwtPlugin(process.env.JWT_SECRET!))  // populate ctx.jwtUser first
  .guard(requireAuth)
  .get('/', async (ctx) => ctx.json(await ctx.posts.findAll()))
  .post('/', async (ctx) => ctx.json(await ctx.posts.create(ctx.body), 201))
  .build()
```

## Per-Route Guard

Overrides the module guard on specific routes:

```ts
defineModule('/posts')
  .guard(requireAuth)
  .get('/public', {
    guard:   false,                             // public — no guard
    handler: async (ctx) => ctx.json([]),
  })
  .delete('/:id', {
    guard:   requireAdmin,                      // stricter guard for this route
    params:  z.object({ id: z.coerce.number() }),
    handler: async (ctx) => ctx.json(await ctx.posts.remove(ctx.params.id)),
  })
  .build()
```

## Parameterized Guards

Guards can be functions that return a `defineGuard` result:

```ts
export const requireRole = (role: string) =>
  defineGuard(`requireRole:${role}`)
    .check<{ jwtUser?: JwtPayload }>((ctx) => {
      if (!ctx.jwtUser) throw new UnauthorizedError('Authentication required')
      if (ctx.jwtUser['role'] !== role) throw new ForbiddenError(`Role '${role}' required`)
    })

// Usage
defineModule('/admin')
  .guard(requireRole('admin'))
```

## Plugin-Declared Permissions

Plugins can declare named permissions:

```ts
const billingPlugin = definePlugin<{ billing: BillingCtx }>('billing')
  .permission('billing:read')
  .permission('billing:write')
  .extend(() => ({ billing: {} }))
```

Check permissions in a guard using `AuthAdapter`:

```ts
import type { AuthAdapter } from 'oakbun'

const billingAuthAdapter: AuthAdapter = {
  getUser: (ctx) => ({ id: ctx.jwtUser!.sub!, permissions: ctx.jwtUser!['permissions'] as string[] }),
  hasPermission: (user, permission) => user.permissions.includes(permission),
}

const requireBillingRead = defineGuard('requireBillingRead')
  .check<{ jwtUser?: JwtPayload }>((ctx) => {
    const user = billingAuthAdapter.getUser(ctx)
    if (!billingAuthAdapter.hasPermission(user, 'billing:read')) {
      throw new ForbiddenError('billing:read permission required')
    }
  })
```

## JWT Auth Flow

Full end-to-end auth pattern:

```ts
// 1. Token issuance endpoint (no guard)
app.post('/auth/token', {
  body: z.object({ email: z.string(), password: z.string() }),
  async handler(ctx) {
    const user = await verifyCredentials(ctx.body.email, ctx.body.password)
    if (!user) throw new UnauthorizedError('Invalid credentials')
    const token = await signJwt({ sub: user.id, role: user.role }, { algorithm: 'HS256', secret: JWT_SECRET })
    return ctx.json({ token })
  },
})

// 2. Protected module
const apiModule = defineModule('/api')
  .plugin(jwtPlugin(JWT_SECRET))
  .guard(requireAuth)
  .get('/me', async (ctx) => ctx.json({ id: ctx.jwtUser!.sub }))
  .build()
```

## See Also

- [defineGuard](../core/07-define-guard.md)
- [JWT Plugin](../plugins/02-jwt-plugin.md)
- [Auth Adapter](../plugins/03-auth-adapter.md)
- [Error Handling](./01-error-handling.md)
