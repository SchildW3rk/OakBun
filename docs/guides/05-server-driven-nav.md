---
title: "Server-Driven Navigation"
category: "guides"
tags: ["nav", "navigation", "server-driven", "plugin"]
related: ["definePlugin", "Plugin System"]
---

# Server-Driven Navigation

OakBun can expose a `GET /nav` endpoint that returns a structured navigation tree. Plugins declare their nav items — the app assembles them.

## Declaring Nav Items

Declare nav items when defining a plugin:

```ts
import { definePlugin } from 'oakbun'

const dashboardPlugin = definePlugin<{ dashboard: DashboardCtx }>('dashboard')
  .nav({ label: 'Dashboard', route: '/dashboard',        icon: 'dashboard', order: 1 })
  .nav({ label: 'Users',     route: '/dashboard/users',  icon: 'users',     order: 2 })
  .nav({ label: 'Settings',  route: '/dashboard/settings', icon: 'settings', order: 3 })
  .extend(() => ({ dashboard: {} }))
```

## NavItem Type

```ts
interface NavItem {
  label:     string       // display name
  route:     string       // navigation target
  icon?:     string       // icon identifier (frontend-interpreted)
  order?:    number       // sort order (lower = first)
  children?: NavItem[]    // nested navigation
}
```

## Nested Navigation

```ts
const adminPlugin = definePlugin<{ admin: AdminCtx }>('admin')
  .nav({
    label: 'Admin',
    route: '/admin',
    icon:  'shield',
    order: 10,
    children: [
      { label: 'Users',  route: '/admin/users',  icon: 'users' },
      { label: 'Logs',   route: '/admin/logs',   icon: 'logs' },
      { label: 'Config', route: '/admin/config', icon: 'settings' },
    ],
  })
  .extend(() => ({ admin: {} }))
```

## /nav Endpoint

The nav endpoint is automatically available when plugins with `.nav()` items are registered. It returns all nav items aggregated and sorted by `order`:

```json
GET /nav
→ [
    { "label": "Dashboard", "route": "/dashboard", "icon": "dashboard", "order": 1 },
    { "label": "Users",     "route": "/dashboard/users", "icon": "users", "order": 2 },
    ...
  ]
```

## See Also

- [definePlugin](../core/04-define-plugin.md)
- [Plugin System](../plugins/01-plugin-system.md)
