---
title: "defineTable / column"
category: "core"
tags: ["schema", "table", "column", "types"]
related: ["defineModel", "SelectBuilder", "Migrations"]
---

# defineTable / column

`defineTable` declares a database table schema with column definitions, hooks, and event mappings. `column` is the column type builder.

## Signatures

```ts
function defineTable<S extends SchemaMap>(
  name: string,
  schema: S
): TableBuilder<InferRow<S>, S>

const column: {
  integer():   Column<number>
  text():      Column<string>
  real():      Column<number>
  boolean():   Column<boolean>
  timestamp(): Column<Date>
  uuid():      Column<string>
  blob():      Column<Uint8Array>
  json<T>():   Column<T>
}
```

## Basic Example

```ts
import { defineTable, column } from 'oakbun'

export const usersTable = defineTable('users', {
  id:        column.integer().primaryKey(),
  name:      column.text(),
  email:     column.text().unique(),
  role:      column.text().default('user'),
  createdAt: column.timestamp().defaultFn(() => new Date()),
}).build()
```

## Full Example with Hooks and Events

```ts
import { defineTable, column, InferTable } from 'oakbun'

export const postsTable = defineTable('posts', {
  id:        column.integer().primaryKey(),
  title:     column.text(),
  body:      column.text(),
  authorId:  column.integer(),
  published: column.boolean().default(false),
  createdAt: column.timestamp().defaultFn(() => new Date()),
})
  .hook({
    beforeInsert: (data) => ({
      ...data,
      createdAt: data.createdAt ?? new Date(),
    }),
    afterInsert:  (row) => { /* side effects, no return */ },
    beforeUpdate: (data) => data,
    afterDelete:  (row) => { /* cleanup */ },
  })
  .emits({
    afterInsert: 'post.created',
    afterUpdate: 'post.updated',
    afterDelete: 'post.deleted',
  })
  .build()

export type PostTypes  = InferTable<typeof postsTable>
export type Post       = PostTypes['row']
export type PostInsert = PostTypes['insert']
export type PostUpdate = PostTypes['update']
```

## Column Modifiers

| Method | Description |
|---|---|
| `.nullable()` | Allow NULL — adds `null` to the TypeScript type |
| `.primaryKey()` | Mark as primary key (also sets auto-increment for integers) |
| `.unique()` | Add UNIQUE constraint |
| `.default(value)` | Static default value |
| `.defaultFn(fn)` | Dynamic default — function called at insert time |
| `.name(sqlName)` | Set an explicit SQL column name (see [Column Name Mapping](#column-name-mapping)) |

## Column Name Mapping

By default, the JavaScript property key is used as the SQL column name. Use `.name()` to map a camelCase TypeScript key to a snake_case SQL column:

```ts
export const usersTable = defineTable('users', {
  id:           column.integer().primaryKey(),
  email:        column.text().unique(),
  passwordHash: column.text().name('password_hash'),
  createdAt:    column.timestamp().name('created_at').defaultFn(() => new Date()),
}).build()
```

OakBun transparently handles the mapping in both directions:

- `insert({ passwordHash: '...' })` → `INSERT INTO users (password_hash, ...) VALUES (...)`
- `SELECT password_hash FROM users` → row returned as `{ passwordHash: '...' }`
- `.where({ passwordHash: '...' })` → `WHERE "password_hash" = ?`
- `UPDATE users SET password_hash = ?` when updating `passwordHash`

The generated `CREATE TABLE` SQL uses the mapped column name:

```sql
CREATE TABLE IF NOT EXISTS "users" (
  "id"            INTEGER PRIMARY KEY AUTOINCREMENT,
  "email"         TEXT NOT NULL UNIQUE,
  "password_hash" TEXT NOT NULL,
  "created_at"    TEXT NOT NULL
)
```

## Column Types

| Method | SQL Type | TypeScript Type |
|---|---|---|
| `column.integer()` | `INTEGER` | `number` |
| `column.text()` | `TEXT` | `string` |
| `column.real()` | `REAL` | `number` |
| `column.boolean()` | `BOOLEAN` | `boolean` |
| `column.timestamp()` | `TIMESTAMP` | `Date` |
| `column.uuid()` | `UUID` | `string` |
| `column.blob()` | `BLOB` | `Uint8Array` |
| `column.json<T>()` | `JSON` | `T` |

## TableBuilder Methods

| Method | Description |
|---|---|
| `.hook(handlers)` | Table-level hooks — run without ctx access |
| `.emits(map)` | Declare event names for insert/update/delete |
| `.build()` | Return sealed `TableDef` |

## Table Hooks

Table hooks have no access to the request context. They run on the row data directly:

```ts
.hook({
  beforeInsert: (data: PostInsert) => PostInsert,   // transform before insert
  afterInsert:  (row: Post) => void,                // side effects
  beforeUpdate: (data: Partial<PostInsert>) => data, // transform before update
  afterUpdate:  (row: Post) => void,
  beforeDelete: (row: Post) => void,
  afterDelete:  (row: Post) => void,
})
```

For hooks with ctx access (e.g. reading `ctx.user`), use [module hooks](./02-define-module.md#methods-reference) via `.hook()` on the module builder.

## Inferred Types

```ts
type InferRow<T>    // full row type (all columns present)
type InferInsert<T> // insert type (PK and defaulted columns optional)
type InferUpdate<T> // update type (all fields Partial, PK required)
type InferTable<T>  // { row, insert, update }
```

## Event Mapping

```ts
.emits({
  afterInsert: 'user.created',  // event name emitted after successful insert
  afterUpdate: 'user.updated',
  afterDelete: 'user.deleted',
})
```

Event payloads carry the affected row. Subscribe via `app.on()` or `defineEventHandler`.

## Generate SQL

```ts
import { toCreateTableSql } from 'oakbun'

console.log(toCreateTableSql(usersTable))
// CREATE TABLE IF NOT EXISTS "users" (
//   "id" INTEGER PRIMARY KEY AUTOINCREMENT,
//   "name" TEXT NOT NULL,
//   ...
// )
```

## See Also

- [defineModel](./06-define-model.md)
- [Migrations](../sql/09-migrations.md)
- [Hooks & Events](../guides/03-hooks-and-events.md)
- [Audit Logging](../guides/04-audit-logging.md)
