---
title: "Plugin System"
category: "plugins"
tags: ["plugin", "lifecycle", "extend", "ctx"]
related: ["definePlugin", "createApp", "defineModule"]
---

# Plugin System

Plugins extend `ctx`, bundle modules, declare permissions, and participate in the request lifecycle. They are the primary mechanism for sharing behavior across an OakBun app.

## Plugin Interface

```ts
interface Plugin<TCtx, TAdd extends Record<string, unknown>> {
  name:         string
  requires?:    string[]            // plugin names that must be registered first
  modules?:     OakBunModule[]        // bundled modules
  permissions?: string[]            // declared permissions
  nav?:         NavItem[]           // server-driven nav items
  guards?:      Guard<any>[]        // plugin-level guards (protect all bundled modules)
  install?:     (hooks: HookExecutor) => void | Promise<void>
  request:      (ctx: TCtx) => TAdd | Promise<TAdd>
  teardown?:    () => void | Promise<void>
}
```

## Lifecycle

```
Request arrives
  → app-level onRequest hooks
  → plugin.request() called in registration order
    → ctx is extended with each plugin's TAdd
  → module-level onRequest hooks
  → module plugin.request() called
  → plugin guard(s)     ← .guard() on definePlugin
  → module guard(s)     ← .guard() on defineModule
  → route guard         ← guard: fn on individual route
  → onBeforeHandle hooks
  → route handler
  → onResponse hooks
  → response sent

App shutdown (app.close() / SIGTERM)
  → plugin.teardown() called in reverse registration order
```

## Registration Order

Plugins are applied in order. A plugin that `.requires(['db'])` will throw at startup if `dbPlugin` is not registered before it:

```ts
app.plugin(loggerPlugin())     // 1
app.plugin(eventBusPlugin())   // 2
app.plugin(dbPlugin(adapter))  // 3 — ctx.db now available
app.plugin(statsPlugin)        // 4 — can use ctx.db, ctx.logger
```

## Module-Scoped Plugins

Plugins can be applied to a single module via `.plugin()` on the module builder:

```ts
import { jwtPlugin } from '@oakbun/jwt'

const secureModule = defineModule('/api')
  .plugin(jwtPlugin(process.env.JWT_SECRET!))
  .get('/me', async (ctx) => ctx.json(ctx.jwtUser))
  .build()
```

Module-scoped plugins only extend ctx for routes within that module.

## Bundled Modules

A plugin can bundle its own modules — useful for self-contained feature packages:

```ts
const adminPlugin = definePlugin<{ admin: Admin }>('admin')
  .requires(['db'])
  .modules([
    defineModule('/admin/users').get('/', ...).build(),
    defineModule('/admin/logs').get('/', ...).build(),
  ])
  .extend(() => ({ admin: new Admin() }))
```

When the plugin is registered, its modules are mounted automatically.

## Plugin-Level Guards

Use `.guard()` to protect all bundled modules with a single guard — the outermost tier in the guard hierarchy:

```ts
const adminPlugin = definePlugin<object>('admin')
  .modules([
    defineModule('/admin/users').get('/', ...).build(),
    defineModule('/admin/posts').get('/', ...).build(),
  ])
  .guard((ctx) => {
    const token = ctx.req.headers.get('x-admin-token')
    if (token !== process.env.ADMIN_TOKEN) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return null
  })
  .extend(() => ({}))
```

Guards are **isolated per plugin** — they never affect routes from other plugins or directly registered routes. Chain `.guard()` calls to require multiple conditions; guards short-circuit on the first block.

See [Guards & Auth](../guides/02-guards-and-auth.md) for the full hierarchy and examples.

## NavItem

```ts
interface NavItem {
  label:     string
  route:     string
  icon?:     string
  order?:    number
  children?: NavItem[]
}
```

NavItems declared on plugins are aggregated and served at `GET /nav`. See [Server-Driven Nav](../guides/05-server-driven-nav.md).

## teardown

`teardown()` is called when `app.close()` is invoked — in reverse registration order. Use it to close connections, flush buffers, or cancel timers.

## See Also

- [definePlugin](../core/04-define-plugin.md)
- [createApp](../core/01-create-app.md)
- [Server-Driven Nav](../guides/05-server-driven-nav.md)
