---
title: "SQL Layer Overview"
category: "sql"
tags: ["db", "sql", "adapter", "dbPlugin"]
related: ["SelectBuilder", "Migrations", "defineModel"]
---

# SQL Layer Overview

OakBun's SQL layer provides a type-safe query builder on top of Bun's native database drivers. It is attached to every request context as `ctx.db`.

## Setup

```ts
import { createApp, dbPlugin } from 'oakbun'
import { SQLiteAdapter } from 'oakbun/adapter/sqlite'

const app = createApp()
app.use(dbPlugin(new SQLiteAdapter({ filename: 'app.db' })))
```

## Adapters

| Adapter | Package | Bun API |
|---|---|---|
| `SQLiteAdapter` | `oakbun/adapter/sqlite` | `bun:sqlite` |
| `PostgresAdapter` | `oakbun/adapter/postgres` | `Bun.sql` |
| `MySQLAdapter` | `oakbun/adapter/mysql` | `Bun.sql` |

```ts
import { SQLiteAdapter }   from 'oakbun/adapter/sqlite'
import { PostgresAdapter } from 'oakbun/adapter/postgres'
import { MySQLAdapter }    from 'oakbun/adapter/mysql'

// SQLite
const sqlite = new SQLiteAdapter({ filename: 'app.db' })

// Postgres (via connection string or Bun.sql options)
const pg = new PostgresAdapter({ url: process.env.DATABASE_URL })

// MySQL
const mysql = new MySQLAdapter({ url: process.env.DATABASE_URL })
```

## resolveAdapter

`resolveAdapter` lets you configure the adapter via an `AdapterConfig` object or pass an existing `VelnAdapter` instance:

```ts
import { resolveAdapter } from 'oakbun'

const adapter = resolveAdapter({ type: 'sqlite', filename: 'app.db' })
// or
const adapter = resolveAdapter({ type: 'postgres', url: process.env.DATABASE_URL })
```

## ctx.db — BoundVelnDB

Every request receives a `BoundVelnDB` — a per-request database handle that tracks query counts and holds the request's hook executor.

```ts
// In a route handler:
ctx.db.from(usersTable).select()
ctx.db.into(usersTable).insert(data)
ctx.db.from(usersTable).where({ id: 1 }).update({ name: 'Alice' })
ctx.db.from(usersTable).where({ id: 1 }).delete()
ctx.db.raw('SELECT COUNT(*) FROM users')
```

## VelnDB vs BoundVelnDB

| Class | Use | Description |
|---|---|---|
| `VelnDB` | Instantiated by `dbPlugin` | Holds the adapter + hook executor |
| `BoundVelnDB` | On `ctx.db` | Per-request; tracks query log, event queue |

## Transactions

```ts
const { result, events } = await ctx.db.transaction(async (txDb) => {
  const user = await txDb.into(usersTable).insert(userData)
  const post  = await txDb.into(postsTable).insert({ ...postData, authorId: user.id })
  return { user, post }
})
// events contains any table events emitted during the transaction
// flush them after the transaction commits:
await ctx.events?.flush(events, ctx)
```

## See Also

- [SelectBuilder](./02-select-builder.md)
- [Where Operators](./03-where-operators.md)
- [Migrations](./09-migrations.md)
- [Query Logging](./10-query-logging.md)
- [DB Plugin](../plugins/04-db-plugin.md)
