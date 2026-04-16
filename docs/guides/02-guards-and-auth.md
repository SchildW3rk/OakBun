---
title: "Guards & Auth"
category: "guides"
tags: ["guard", "auth", "authorization", "jwt", "permissions", "plugin-guard"]
related: ["defineGuard", "definePlugin", "JWT Plugin", "Error Handling"]
---

# Guards & Auth

Guards run before a route handler. Return `null` (or throw nothing) to pass, return a `Response` (or throw an error) to block.

## Guard Execution Order

Guards run in a fixed hierarchy — outer tiers run first:

```
plugin guard(s)    ← .guard() on definePlugin
  module guard(s)  ← .guard() on defineModule
    route guard    ← guard: fn on individual route
      handler
```

If any guard returns a `Response`, the chain stops immediately — lower tiers never run.

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

## Plugin-Level Guard

Use `.guard()` on `definePlugin` to protect **all modules in the plugin** with a single guard. This is the outermost tier — it runs before module and route guards.

```ts
import { definePlugin, defineModule } from 'oakbun'

function adminGuard(ctx: { req: Request }): Response | null {
  const token = ctx.req.headers.get('x-admin-token')
  if (token !== process.env.ADMIN_TOKEN) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export const adminPlugin = definePlugin<object>('admin')
  .modules([
    defineModule('/admin/users').get('/', ...).build(),
    defineModule('/admin/posts').get('/', ...).build(),
    defineModule('/admin/settings').get('/', ...).build(),
  ])
  .guard(adminGuard)   // one guard — all 3 modules protected
  .extend(() => ({}))
```

Chain multiple guards or pass an array — all must pass (short-circuit on first block):

```ts
definePlugin<object>('secure')
  .modules([...])
  .guard(requireValidToken)
  .guard(requireActiveAccount)
  .extend(() => ({}))
```

Plugin guards are **isolated** — a guard on plugin A never runs for plugin B's routes or directly registered routes.

## Module-Level Guard

Protects all routes within a module:

```ts
defineModule('/posts')
  .plugin(jwtPlugin(process.env.JWT_SECRET!))  // populate ctx.jwtUser first
  .guard(requireAuth)
  .get('/', async (ctx) => ctx.json(await ctx.posts.findAll()))
  .post('/', async (ctx) => ctx.json(await ctx.posts.create(ctx.body), 201))
  .build()
```

## Per-Route Guard

Applies only to a single route — overrides or supplements the module guard:

```ts
defineModule('/posts')
  .guard(requireAuth)
  .get('/public', {
    guard:   false,            // public — skip the module guard
    handler: async (ctx) => ctx.json([]),
  })
  .delete('/:id', {
    guard:   requireAdmin,     // stricter guard on this route
    params:  z.object({ id: z.coerce.number() }),
    handler: async (ctx) => ctx.json(await ctx.posts.remove(ctx.params.id)),
  })
  .build()
```

## Parameterized Guards

Guards can be factory functions:

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
  .get('/', ...)
  .build()
```

## Plugin-Declared Permissions

Plugins can declare named permissions checked via `AuthAdapter`:

```ts
const billingPlugin = definePlugin<{ billing: BillingCtx }>('billing')
  .permission('billing:read')
  .modules([billingModule])
  .extend(() => ({ billing: {} }))
```

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
- [definePlugin](../core/04-define-plugin.md)
- [JWT Plugin](../plugins/02-jwt-plugin.md)
- [Auth Adapter](../plugins/03-auth-adapter.md)
- [Error Handling](./01-error-handling.md)
