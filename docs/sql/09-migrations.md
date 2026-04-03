---
title: "Migrations"
category: "sql"
tags: ["migrations", "schema", "cli", "database"]
related: ["defineTable", "oak CLI", "SQL Overview"]
---

# Migrations

OakBun's migration system tracks SQL files in a `migrations/` directory and applies them in order. The `oak` CLI provides commands to run, roll back, and generate migrations.

## Setup

```ts
// oak.config.ts
import { defineConfig } from 'oakbun'
import { SQLiteAdapter } from 'oakbun/adapter/sqlite'

export default defineConfig({
  adapter: new SQLiteAdapter({ filename: 'app.db' }),
  migrations: './migrations',
})
```

## CLI Commands

```bash
# Run all pending migrations
oak migrate:run

# Show migration status
oak migrate:status

# Generate migration from schema diff
oak migrate:generate add_users_table

# Roll back last migration
oak migrate:rollback

# Create an empty migration file
oak make:migration add_index_on_email
```

See [oak CLI](../cli/01-oak-cli.md) for full reference.

## Migration Files

Migration files are plain SQL. Each file can contain multiple statements separated by `;`.

```sql
-- migrations/0001_initial.sql
CREATE TABLE IF NOT EXISTS "users" (
  "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"       TEXT NOT NULL,
  "email"      TEXT NOT NULL UNIQUE,
  "role"       TEXT NOT NULL DEFAULT 'user',
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "posts" (
  "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
  "title"      TEXT NOT NULL,
  "body"       TEXT NOT NULL,
  "author_id"  INTEGER NOT NULL REFERENCES "users"("id"),
  "published"  BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## Programmatic API

```ts
import { createMigrator } from 'oakbun'
import { SQLiteAdapter } from 'oakbun/adapter/sqlite'

const adapter = new SQLiteAdapter({ filename: 'app.db' })

const migrator = createMigrator(adapter, {
  migrationsDir: './migrations',
})

// Run pending
const result = await migrator.run()
console.log(result.applied)

// Status
const status = await migrator.status()
// [{ name: '0001_initial', appliedAt: Date | null }]

// Rollback last
await migrator.rollback()
```

## createMigrator Options

| Option | Type | Description |
|---|---|---|
| `migrationsDir` | `string` | Path to migrations folder |
| `tableName` | `string` | Migration tracking table (default: `_migrations`) |

## Schema Diff Generation

`oak migrate:generate` compares your current `defineTable` schemas against the live database and generates a SQL migration:

```bash
oak migrate:generate add_comments_table
# Creates: migrations/0003_add_comments_table.sql
```

The generator uses `compareSchemas` / `introspectSchema` internally.

## Programmatic Schema Generation

```ts
import { generateMigration, compareSchemas, introspectSchema } from 'oakbun'

const liveSchema = await introspectSchema(adapter)
const diff = compareSchemas(liveSchema, [usersTable, postsTable])
const sql = generateMigration(diff, { name: 'add_posts' })
```

## Migration Hooks

Destructive operations (DROP, ALTER) can be gated with pre/post hooks:

```ts
const migrator = createMigrator(adapter, {
  migrationsDir: './migrations',
  hooks: {
    beforeRun: async (migration) => {
      console.log('Running:', migration.name)
    },
    afterRun: async (migration, result) => {
      console.log('Done:', migration.name, result)
    },
  },
})
```

## See Also

- [oak CLI](../cli/01-oak-cli.md)
- [defineTable / column](../core/09-define-table.md)
- [SQL Overview](./01-overview.md)
