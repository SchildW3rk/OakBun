---
title: "defineModule"
category: "core"
tags: ["routing", "module", "builder", "routes"]
related: ["createApp", "definePlugin", "defineGuard", "defineService"]
---

# defineModule

Creates a route group with a shared URL prefix. Supports guards, plugins, hooks, services, audit logging, and event handlers — all scoped to the module.

## Signature

```ts
function defineModule<TCtx extends BaseCtx = BaseCtx>(
  prefix: string
): ModuleBuilder<TCtx>
```

## Basic Example

```ts
import { defineModule } from 'oakbun'
import { z } from 'zod'

const usersModule = defineModule('/users')
  .get('/', async (ctx) => {
    const users = await ctx.db.from(usersTable).select()
    return ctx.json(users)
  })
  .post('/', {
    body: z.object({ name: z.string(), email: z.string().email() }),
    async handler(ctx) {
      const user = await ctx.db.into(usersTable).insert(ctx.body)
      return ctx.json(user, 201)
    },
  })
  .build()
```

## Full Example

```ts
import { defineModule } from 'oakbun'
import { jwtPlugin } from '@oakbun/jwt'
import { z } from 'zod'

const postsModule = defineModule('/posts')
  .meta({ tag: 'Posts', description: 'Blog post management' })
  .plugin(jwtPlugin(process.env.JWT_SECRET!, { optional: true }))
  .use(PostService)
  .guard(requireAuth)
  .get('/', {
    guard: false,                          // opt this route out of the module guard
    response: z.array(postSchema),
    async handler(ctx) {
      return ctx.json(await ctx.posts.findAll())
    },
  })
  .post('/', {
    body: z.object({ title: z.string(), body: z.string() }),
    async handler(ctx) {
      const post = await ctx.posts.create({
        ...ctx.body,
        authorId: ctx.jwtUser!.sub,
      })
      return ctx.json(post, 201)
    },
  })
  .build()
```

## HTTP Methods

All HTTP method builders accept two overload forms:

**Plain handler:**
```ts
.get('/path', async (ctx) => ctx.json({ ok: true }))
```

**Typed schema + handler:**
```ts
.post('/path', {
  params:   z.object({ id: z.coerce.number() }),
  query:    z.object({ page: z.coerce.number().optional() }),
  body:     z.object({ name: z.string() }),
  response: z.object({ id: z.number(), name: z.string() }),
  guard:    myGuard,      // per-route guard (overrides module guard)
  docs:     { summary: 'Create a user', operationId: 'createUser' },
  handler:  async (ctx) => ctx.json(result),
})
```

## Methods Reference

| Method | Returns | Description |
|---|---|---|
| `.get(path, handler\|def)` | `this` | Register GET route |
| `.post(path, handler\|def)` | `this` | Register POST route |
| `.put(path, handler\|def)` | `this` | Register PUT route |
| `.patch(path, handler\|def)` | `this` | Register PATCH route |
| `.delete(path, handler\|def)` | `this` | Register DELETE route |
| `.plugin(plugin)` | `this` | Apply plugin to all routes in this module |
| `.guard(guard)` | `this` | Apply guard to all routes (opt out per-route with `guard: false`) |
| `.use(serviceDef)` | `this` | Inject service into ctx (e.g. `ctx.users`) |
| `.use(middlewareDef)` | `this` | Wire middleware hooks to this module |
| `.hook(table, handlers)` | `this` | Table hooks with ctx access (afterInsert, etc.) |
| `.audit(table, config)` | `this` | Automatic audit logging for a table |
| `.events(handlerDef)` | `this` | Wire event handlers to the module's event bus |
| `.cron(cronDef)` | `this` | Register a cron job (started with app) |
| `.onRequest(fn)` | `this` | Lifecycle hook: before routing |
| `.onBeforeHandle(fn)` | `this` | Lifecycle hook: after routing, before handler |
| `.onResponse(fn)` | `this` | Lifecycle hook: after response |
| `.onError(fn)` | `this` | Module-scoped error handler |
| `.meta(opts)` | `this` | OpenAPI tag and description |
| `.visibility(v)` | `this` | `'public'` \| `'private'` \| `'internal'` |
| `.options(opts)` | `this` | Log options (`level`, `mask`) |
| `.build()` | `OakBunModule` | Seal and return the module |

## Route Parameters

Parameters declared in path segments (`:id`) are typed via the `params` schema:

```ts
.get('/:id', {
  params: z.object({ id: z.coerce.number() }),
  async handler(ctx) {
    const user = await ctx.db.from(usersTable)
      .where({ id: ctx.params.id })
      .first()
    if (!user) throw new NotFoundError('User not found')
    return ctx.json(user)
  },
})
```

## Guard Opt-Out

A module-level guard applies to all routes. Individual routes can opt out:

```ts
defineModule('/posts')
  .guard(requireAuth)
  .get('/public', { guard: false, handler: (ctx) => ctx.json([]) })  // no auth
  .get('/private', async (ctx) => ctx.json([]))                      // requires auth
```

## See Also

- [defineGuard](./07-define-guard.md)
- [defineService](./05-define-service.md)
- [definePlugin](./04-define-plugin.md)
- [Hooks & Events](../guides/03-hooks-and-events.md)
- [Audit Logging](../guides/04-audit-logging.md)
