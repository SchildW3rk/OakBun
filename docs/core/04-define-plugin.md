---
title: "definePlugin"
category: "core"
tags: ["plugin", "builder", "extend", "ctx"]
related: ["createApp", "defineModule", "defineGuard"]
---

# definePlugin

Creates a plugin that extends the request context, bundles modules, declares permissions, and runs lifecycle hooks.

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

Plugins can bundle modules:

```ts
const adminPlugin = definePlugin<{ admin: AdminCtx }>('admin')
  .requires(['db'])
  .extend(() => ({ admin: { /* ... */ } }))
  .modules([
    defineModule('/admin/users').get('/', ...).build(),
    defineModule('/admin/stats').get('/', ...).build(),
  ])
```

## Plugin with Permissions

Declare permissions that route guards can check:

```ts
const billingPlugin = definePlugin<{ billing: BillingCtx }>('billing')
  .permission('billing:read')
  .permission('billing:write')
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
  name:       string
  requires?:  string[]
  modules?:   VelnModule[]
  permissions?: string[]
  nav?:       NavItem[]
  install?:   (hooks: HookExecutor) => void | Promise<void>
  request:    (ctx: TCtx) => TAdd | Promise<TAdd>
  teardown?:  () => void | Promise<void>
}
```

## PluginBuilder Methods

| Method | Description |
|---|---|
| `.requires(names)` | Declare plugin dependencies (validated at startup) |
| `.options(opts)` | Log options |
| `.modules(list)` | Bundle modules with this plugin |
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
- [Server-Driven Nav](../guides/05-server-driven-nav.md)
