---
title: "definePlugin"
category: "core"
tags: ["plugin", "builder", "extend", "ctx", "guard"]
related: ["createApp", "defineModule", "defineGuard"]
---

# definePlugin

Creates a plugin that extends the request context, bundles modules, declares permissions, adds guards, and runs lifecycle hooks.

## Signature

```ts
function definePlugin<TAdd extends Record<string, unknown>>(
  name: string
): PluginBuilder<TAdd>
```

## Basic Example

```ts
import { definePlugin } from 'oakbun'

const requestIdPlugin = definePlugin<{ requestId: string }>('requestId')
  .extend(() => ({ requestId: crypto.randomUUID() }))
```

## Full Example

```ts
import { definePlugin } from 'oakbun'

interface StatsCtx {
  stats: {
    increment(route: string): void
    getCount(route: string): number
    all(): Record<string, number>
  }
}

const _counters = new Map<string, number>()

const statsPlugin = definePlugin<StatsCtx>('stats')
  .requires(['db', 'logger'])
  .options({ log: { level: 'debug' } })
  .extend(() => ({
    stats: {
      increment(route: string) {
        _counters.set(route, (_counters.get(route) ?? 0) + 1)
      },
      getCount(route: string) {
        return _counters.get(route) ?? 0
      },
      all() {
        return Object.fromEntries(_counters)
      },
    },
  }))
```

## Plugin with Modules

Plugins can bundle modules — all registered automatically when the plugin is installed:

```ts
const adminPlugin = definePlugin<{ admin: AdminCtx }>('admin')
  .requires(['db'])
  .modules([
    defineModule('/admin/users').get('/', ...).build(),
    defineModule('/admin/stats').get('/', ...).build(),
  ])
  .extend(() => ({ admin: { /* ... */ } }))
```

## Plugin with a Guard

Use `.guard()` to protect **all modules in the plugin** with a single guard. The guard runs after global guards and before module-level guards.

```ts
import { definePlugin, defineModule } from 'oakbun'

function adminGuard(ctx: { req: Request }): Response | null {
  const token = ctx.req.headers.get('x-admin-token')
  if (token !== process.env.ADMIN_TOKEN) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null // pass through
}

export const adminPlugin = definePlugin<object>('admin')
  .modules([
    defineModule('/admin/users').get('/', ...).build(),
    defineModule('/admin/posts').get('/', ...).build(),
    defineModule('/admin/settings').get('/', ...).build(),
  ])
  .guard(adminGuard)   // protects all 3 modules at once
  .extend(() => ({}))
```

### Multiple Guards

Chain `.guard()` calls or pass an array — all guards must pass (short-circuit on first block):

```ts
definePlugin<object>('secure')
  .modules([...])
  .guard(requireValidToken)   // runs first
  .guard(requireActiveAccount) // runs second — only if first passes
  .extend(() => ({}))
```

### Guard Execution Order

```
request
  → plugin guard(s)      ← .guard() on definePlugin
    → module guard(s)    ← .guard() on defineModule
      → route guard      ← guard: fn on individual route
        → handler
```

If any guard returns a `Response`, the chain stops immediately and that response is returned. Module and route guards never run.

### Guard Isolation

A plugin guard only applies to **its own modules**. Other plugins and directly registered routes are not affected:

```ts
app.plugin(pluginA)   // pluginA.guard only runs for pluginA's routes
app.plugin(pluginB)   // pluginB.guard only runs for pluginB's routes
app.get('/public', handler)  // no plugin guard — completely unaffected
```

## Plugin with Permissions

Declare permissions that gate all plugin routes via the `AuthAdapter`:

```ts
const billingPlugin = definePlugin<{ billing: BillingCtx }>('billing')
  .permission('billing:read')
  .modules([billingModule])
  .extend(() => ({ billing: {} }))
```

## Plugin with Navigation

Add nav items to the server-driven nav endpoint:

```ts
const adminPlugin = definePlugin<{ admin: AdminCtx }>('admin')
  .nav({ label: 'Dashboard', route: '/admin', icon: 'dashboard', order: 1 })
  .nav({ label: 'Users',     route: '/admin/users', icon: 'users', order: 2 })
  .extend(() => ({ admin: {} }))
```

## Plugin Interface

The `Plugin<TCtx, TAdd>` interface (for manual construction):

```ts
interface Plugin<TCtx, TAdd> {
  name:         string
  requires?:    string[]
  modules?:     OakBunModule[]
  permissions?: string[]
  nav?:         NavItem[]
  guards?:      Guard<any>[]   // plugin-level guards
  install?:     (hooks: HookExecutor) => void | Promise<void>
  request:      (ctx: TCtx) => TAdd | Promise<TAdd>
  teardown?:    () => void | Promise<void>
}
```

## PluginBuilder Methods

| Method | Description |
|---|---|
| `.requires(names)` | Declare plugin dependencies (validated at startup) |
| `.options(opts)` | Log options |
| `.modules(list)` | Bundle modules with this plugin |
| `.guard(fn \| fn[])` | Add one or more plugin-level guards (protect all modules) |
| `.permission(name)` | Declare a permission string |
| `.nav(item)` | Add a nav item |
| `.extend(fn)` | Shorthand: provide ctx additions — fn called per request |
| `.build(def)` | Full control: provide complete Plugin definition |

## Built-in Plugins

| Plugin | Import | Adds to ctx |
|---|---|---|
| `loggerPlugin()` | `oakbun` | `ctx.logger` |
| `eventBusPlugin(bus?)` | `oakbun` | `ctx.events` |
| `dbPlugin(config, log?)` | `oakbun` | `ctx.db` |
| `rateLimitPlugin(opts)` | `oakbun` | — |
| `secureHeadersPlugin(opts)` | `oakbun` | — |
| `corsPlugin(opts)` | `oakbun` | — |
| `csrfPlugin(opts)` | `oakbun` | — |
| `compressionPlugin(opts)` | `oakbun` | — |
| `healthPlugin(opts)` | `oakbun` | — |
| `bodySizeLimitPlugin(opts)` | `oakbun` | — |
| `requestIdPlugin(opts)` | `oakbun` | `ctx.requestId` |
| `scalarPlugin(opts)` | `oakbun` | — |

## See Also

- [createApp](./01-create-app.md)
- [Plugin System](../plugins/01-plugin-system.md)
- [Guards & Auth](../guides/02-guards-and-auth.md)
- [Server-Driven Nav](../guides/05-server-driven-nav.md)
