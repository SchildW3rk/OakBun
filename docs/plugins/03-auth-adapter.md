---
title: "Auth Adapter (Better Auth)"
category: "plugins"
tags: ["auth", "better-auth", "session", "plugin"]
related: ["JWT Plugin", "Guards & Auth", "defineGuard"]
---

# Auth Adapter — @oakbun/auth

`@oakbun/auth` integrates [Better Auth](https://www.better-auth.com/) with OakBun. It intercepts auth routes and populates `ctx.betterUser` and `ctx.session`.

## Installation

```bash
bun add @oakbun/auth better-auth
```

## Setup

```ts
import { createApp, dbPlugin } from 'oakbun'
import { betterAuthPlugin } from '@oakbun/auth'
import { SQLiteAdapter } from 'oakbun/adapter/sqlite'

const adapter = new SQLiteAdapter({ filename: 'app.db' })

const app = createApp()
app.plugin(dbPlugin(adapter))
app.plugin(betterAuthPlugin(
  {
    secret:         process.env.AUTH_SECRET!,
    baseUrl:        'http://localhost:3000',
    trustedOrigins: ['http://localhost:5173'],
  },
  adapter,
))
```

## How It Works

`betterAuthPlugin` does two things:

1. **Auth route interception** — requests to `/api/auth/*` are forwarded to Better Auth's handler before OakBun's router runs.
2. **Session hydration** — on every request, the session is read from the cookie/header and `ctx.betterUser` + `ctx.session` are populated.

## BetterAuthPluginOptions

| Option | Type | Description |
|---|---|---|
| `secret` | `string` | Better Auth secret (min 32 chars) |
| `baseUrl` | `string` | App base URL |
| `trustedOrigins` | `string[]` | CORS origins allowed for auth requests |

## ctx Extension

| Field | Type | Description |
|---|---|---|
| `ctx.betterUser` | `BetterAuthUser \| null` | Authenticated user or `null` |
| `ctx.session` | `BetterAuthSession \| null` | Active session or `null` |
| `ctx.auth` | `BetterAuthInstance` | Better Auth instance (for advanced use) |

## Protecting Routes

```ts
import { defineGuard, UnauthorizedError } from 'oakbun'

const requireSession = defineGuard('requireSession')
  .check<{ betterUser?: BetterAuthUser | null }>((ctx) => {
    if (!ctx.betterUser) throw new UnauthorizedError('Login required')
  })

defineModule('/dashboard')
  .guard(requireSession)
  .get('/', async (ctx) => ctx.json({ user: ctx.betterUser }))
  .build()
```

## VelnAdapter for Better Auth

`@oakbun/auth` includes a `createVelnDbAdapter` that wraps `BoundVelnDB` as a Better Auth database adapter:

```ts
import { createVelnDbAdapter } from '@oakbun/auth'

// Usually handled automatically by betterAuthPlugin
const dbAdapter = createVelnDbAdapter(ctx.db)
```

## Auth Tables

Better Auth requires its own tables. Use `createAuthTables` to generate the migration SQL:

```ts
import { createAuthTables } from '@oakbun/auth'

const sql = createAuthTables()
// Run this SQL against your database to set up Better Auth tables
```

## See Also

- [JWT Plugin](./02-jwt-plugin.md)
- [Guards & Auth Guide](../guides/02-guards-and-auth.md)
- [Better Auth Documentation](https://www.better-auth.com/docs)
