---
title: "Project Structure"
category: "getting-started"
tags: ["structure", "layout", "conventions"]
related: ["defineModule", "defineService", "defineTable"]
---

# Project Structure

Recommended folder layout for an OakBun project.

## Standard Layout

```
src/
  index.ts                 # App entry point — createApp, plugins, listen
  schema/
    users.ts               # defineTable('users', { ... })
    posts.ts
  modules/
    users.module.ts        # defineModule('/users')...build()
    posts.module.ts
  services/
    user.service.ts        # defineService('users')...define(...)
    post.service.ts
  models/
    user.model.ts          # defineModel('UserModel', usersTable)...define(...)
  plugins/
    stats.plugin.ts        # definePlugin<{ stats: Stats }>('stats')...
  guards/
    auth.guard.ts          # defineGuard('requireAuth').check(...)
  crons/
    cleanup.cron.ts        # defineCron('cleanup', '@daily').handler(...)
  commands/                # Custom oak CLI commands (auto-discovered)
    seed.command.ts
migrations/
  0001_initial.sql
oak.config.ts              # defineConfig({ adapter, migrations })
```

## Schema Files

Each schema file exports a `TableDef` and inferred types:

```ts
// src/schema/users.ts
import { defineTable, column, InferTable } from 'oakbun'

export const usersTable = defineTable('users', {
  id:        column.integer().primaryKey(),
  name:      column.text(),
  email:     column.text().unique(),
  createdAt: column.timestamp().defaultFn(() => new Date()),
}).build()

export type UserTypes = InferTable<typeof usersTable>
export type User      = UserTypes['row']
export type UserInsert = UserTypes['insert']
```

## Entry Point

```ts
// src/index.ts
import { createApp, dbPlugin, loggerPlugin, eventBusPlugin } from 'oakbun'
import { SQLiteAdapter } from 'oakbun/adapter/sqlite'
import { usersModule } from './modules/users.module'

const app = createApp()

app.use(loggerPlugin())
app.use(eventBusPlugin())
app.use(dbPlugin(new SQLiteAdapter({ filename: 'app.db' })))

app.register(usersModule)

app.listen(Number(process.env.PORT) || 3000)
```

## Config File

```ts
// oak.config.ts
import { defineConfig } from 'oakbun'
import { SQLiteAdapter } from 'oakbun/adapter/sqlite'

export default defineConfig({
  adapter: new SQLiteAdapter({ filename: 'app.db' }),
  migrations: './migrations',
})
```

## See Also

- [Installation](./01-installation.md)
- [Quick Start](./02-quick-start.md)
- [oak CLI](../cli/01-oak-cli.md)
