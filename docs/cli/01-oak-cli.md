---
title: "Oak CLI"
category: "cli"
tags: ["cli", "migrate", "shell", "commands", "oak"]
related: ["defineTable", "Migrations", "defineModule"]
---

# Oak CLI

The `oak` CLI is the built-in command-line tool for OakBun. It handles database migrations, an interactive shell, and custom project commands.

## Installation

The `oak` binary is available after installing `oakbun`:

```sh
bun add oakbun
bunx oak --help
```

Or add to `package.json` scripts:

```json
{
  "scripts": {
    "migrate": "oak migrate:run",
    "shell":   "oak shell"
  }
}
```

## Configuration

Oak reads `oak.config.ts` (or `oak.config.js`) from the project root:

```ts
import { defineConfig } from 'oakbun'

export default defineConfig({
  schema:     './src/schema',      // path to schema files
  tables:     './src/tables',      // path to table definitions
  migrations: './migrations',      // migrations directory
  commands:   './src/commands',    // custom command directory
})
```

All paths are relative to the project root.

---

## Built-in Commands

### oak migrate:run

Run all pending migrations in order.

```sh
oak migrate:run
```

Output:

```
✓ 0001_initial.sql
✓ 0002_add_users.sql
→ 2 migrations applied
```

Already-applied migrations are skipped. The migration state is tracked in a `_migrations` table created automatically.

---

### oak migrate:status

Show the status of all migrations — which have been applied and when.

```sh
oak migrate:status
```

Output:

```
applied    0001_initial.sql          2024-01-15 14:32:01
applied    0002_add_users.sql        2024-01-16 09:11:42
pending    0003_add_sessions.sql     —
```

---

### oak migrate:generate [name]

Inspect the current table schema definitions and compare them against the database. Generate a migration file containing only the diff.

```sh
oak migrate:generate
oak migrate:generate add_sessions
```

Output file: `migrations/0003_add_sessions.sql`

The generator detects:
- New tables
- Dropped tables
- Added columns
- Dropped columns
- Changed column types or constraints
- Added/dropped indexes

Review the generated file before applying — always verify auto-generated SQL.

---

### oak migrate:rollback

Roll back the most recently applied migration.

```sh
oak migrate:rollback
```

Executes the `-- down` section of the migration file if present, then removes the migration record.

---

### oak make:migration [name]

Create an empty migration file with the next sequential number.

```sh
oak make:migration
oak make:migration add_posts_table
```

Creates: `migrations/0003_add_posts_table.sql`

Template:

```sql
-- up


-- down

```

Write your SQL in the `-- up` section. The `-- down` section is optional but enables `migrate:rollback`.

---

### oak shell

Start an interactive REPL (Read–Eval–Print Loop) with database access and loaded services. Similar to Rails console or Laravel Tinker.

```sh
oak shell
```

Inside the shell:

```ts
> const users = await db.from(usersTable).select()
> users.length
42

> await db.into(usersTable).insert({ name: 'Alice', email: 'alice@example.com' })
{ id: 43, name: 'Alice', email: 'alice@example.com' }
```

The shell provides:
- `db` — a `BoundOakBunDB` connected to your database
- All imported tables and services from your schema path
- Standard TypeScript/JavaScript evaluation

Press `Ctrl+C` or `Ctrl+D` to exit.

---

## Custom Commands

Place command files in the directory configured as `commands` (default: `./src/commands`). Each file default-exports a `CommandDef` built with `defineCommand`.

### Defining a Command

```ts
// src/commands/seed.ts
import { defineCommand } from 'oakbun'
import { usersTable } from '../schema/users'

export default defineCommand('seed')
  .description('Seed the database')
  .option('--email <email>', 'Admin email', 'admin@example.com')
  .action(async (args, ctx) => {
    // ctx.db — BoundOakBunDB from the adapter in oak.config.ts
    const existing = await ctx.db.from(usersTable)
      .where({ email: args.email })
      .first()

    if (existing) {
      console.log(`User "${args.email}" already exists — skipping`)
      return
    }

    const user = await ctx.db.into(usersTable).insert({
      email: args.email,
      passwordHash: await Bun.password.hash('changeme'),
    })
    console.log(`Created user (id=${user.id})`)
  })
```

For raw SQL via `ctx.adapter`:

```ts
.action(async (args, ctx) => {
  await ctx.adapter.execute('DELETE FROM sessions WHERE expires_at < ?', [Date.now()])
})
```

Run it:

```sh
oak seed
oak seed --email admin@myapp.com
```

### CommandDef API

```ts
defineCommand(name: string)
  .description(text: string)
  .option(flag: string, description: string, default?: string)
  .action(fn: (args: Record<string, string>, ctx: CommandContext) => Promise<void> | void)
```

`ctx.db` is a `BoundOakBunDB` scoped to the adapter from `oak.config.ts`. `ctx.adapter` gives access to the raw adapter for executing plain SQL.

The `flag` format follows `--flag-name <value>` for required values or `--flag-name` for boolean flags.

---

## Migration File Format

Migration files are plain SQL. Oak applies the `-- up` section and uses `-- down` for rollback.

```sql
-- up
CREATE TABLE IF NOT EXISTS "posts" (
  "id"        INTEGER PRIMARY KEY AUTOINCREMENT,
  "title"     TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "authorId"  INTEGER NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "idx_posts_authorId" ON "posts" ("authorId");

-- down
DROP TABLE IF EXISTS "posts";
```

Files must follow the naming convention: `NNNN_description.sql` where `NNNN` is a zero-padded sequence number (0001, 0002, ...).

## See Also

- [Migrations](../core/07-migrations.md)
- [defineTable / column](../core/09-define-table.md)
- [DB Plugin](../plugins/04-db-plugin.md)
