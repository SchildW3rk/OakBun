---
title: "Quick Start"
category: "getting-started"
tags: ["quickstart", "example", "createApp"]
related: ["createApp", "defineModule", "defineTable"]
---

# Quick Start

A minimal OakBun application with a SQLite database, one table, and two routes.

## Minimal App

```ts
import { createApp, defineModule, defineTable, column, dbPlugin } from 'oakbun'
import { SQLiteAdapter } from 'oakbun/adapter/sqlite'
import { z } from 'zod'

// 1. Define schema
const users = defineTable('users', {
  id:    column.integer().primaryKey(),
  name:  column.text(),
  email: column.text().unique(),
}).build()

// 2. Define routes
const usersModule = defineModule('/users')
  .get('/', async (ctx) => {
    const rows = await ctx.db.from(users).select()
    return ctx.json(rows)
  })
  .post('/', {
    body: z.object({ name: z.string(), email: z.string().email() }),
    async handler(ctx) {
      const user = await ctx.db.into(users).insert(ctx.body)
      return ctx.json(user, 201)
    },
  })
  .build()

// 3. Create app
const app = createApp()
app.use(dbPlugin(new SQLiteAdapter({ filename: 'app.db' })))
app.register(usersModule)
app.listen(3000)
```

## With Full Example Structure

See [`examples/basic/src/index.ts`](../../examples/basic/src/index.ts) for a complete app with:
- JWT auth
- Module guards
- Services and models
- Table hooks and events
- Cron jobs
- SSE streaming
- Scalar API docs

## Plugin Registration Order

Plugins are applied in registration order. Register `loggerPlugin` → `eventBusPlugin` → `dbPlugin` before any module that needs them.

```ts
const app = createApp()

app.use(loggerPlugin())
app.use(eventBusPlugin())
app.use(dbPlugin(adapter))

app.register(usersModule)
app.register(postsModule)

app.listen(3000)
```

## See Also

- [createApp](../core/01-create-app.md)
- [defineModule](../core/02-define-module.md)
- [defineTable / column](../core/09-define-table.md)
