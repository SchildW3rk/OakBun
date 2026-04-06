---
title: "Batch Operations"
category: "sql"
tags: ["batch", "insertMany", "updateMany", "bulk", "performance"]
related: ["SelectBuilder", "Relation Loader", "Query Logging"]
---

# Batch Operations

`insertMany` and `updateMany` handle bulk writes efficiently — one query instead of N.

## insertMany

Insert multiple rows in a single `INSERT … VALUES (…), (…) RETURNING *` statement.

```ts
const users = await ctx.db.into(usersTable).insertMany([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob',   email: 'bob@example.com' },
  { name: 'Carol', email: 'carol@example.com' },
])
// → User[]
// → 1 SQL query regardless of array size
```

### Hook and Default Behaviour

`beforeInsert` and `afterInsert` hooks run once per row. Defaults (`default()` / `defaultFn()`) are applied per row before the query executes.

```ts
const postsTable = defineTable('posts', {
  id:        column.integer().primaryKey(),
  title:     column.text(),
  createdAt: column.timestamp().defaultFn(() => new Date()),
}).build()

const posts = await ctx.db.into(postsTable).insertMany([
  { title: 'First Post' },
  { title: 'Second Post' },
])
// Each post gets its own createdAt Date instance
```

### Empty Array

Passing an empty array is a no-op — returns `[]` without touching the database.

```ts
const result = await ctx.db.into(usersTable).insertMany([])
// result === []  (no query executed)
```

### MySQL

MySQL does not support `RETURNING *`. Calling `insertMany` on a MySQL adapter throws an informative error. Use individual `insert()` calls inside a `transaction()` instead.

```ts
// MySQL — use this pattern instead:
await ctx.db.transaction(async (trx) => {
  for (const row of rows) {
    await trx.into(usersTable).insert(row)
  }
})
```

## updateMany

Update multiple rows atomically inside a single transaction. Each row must include the primary key. If any row fails, all updates are rolled back.

```ts
const updated = await ctx.db.from(usersTable).updateMany([
  { id: 1, name: 'Alice Updated' },
  { id: 2, role: 'admin' },
  { id: 3, name: 'Carol New', role: 'mod' },
])
// → User[]
// → 1 transaction wrapping N UPDATE queries
```

### Partial Patches

Only specified fields are updated — unspecified fields are left unchanged.

```ts
await ctx.db.from(usersTable).updateMany([
  { id: 1, name: 'New Name' },
  // role is not set — stays as-is in the database
])
```

### Hook Behaviour

`beforeUpdate` and `afterUpdate` hooks run per row in order. If `beforeUpdate` throws, the transaction rolls back and no further rows are processed.

```ts
// Hooks registered via defineModule are called for every row:
// beforeUpdate(row[0]) → afterUpdate(row[0]) → beforeUpdate(row[1]) → afterUpdate(row[1]) → …
```

### Rollback on Error

If one row fails — record not found, hook throws, DB constraint violated — the entire transaction rolls back and none of the updates are persisted.

```ts
await ctx.db.from(usersTable).updateMany([
  { id: 1, name: 'Alice' },
  { id: 99999, name: 'Ghost' },  // does not exist → throws
  // row 1 is also rolled back
])
```

### Empty Array

Passing an empty array is a no-op — returns `[]` without opening a transaction.

```ts
const result = await ctx.db.from(usersTable).updateMany([])
// result === []  (no transaction opened)
```

## Signatures

```ts
// insertMany — InsertBuilder (returned by ctx.db.into(table))
insertMany(data: InferInsert<S>[]): Promise<T[]>

// updateMany — SelectBuilder (returned by ctx.db.from(table))
updateMany(rows: InferUpdate<S>[]): Promise<T[]>
```

## See Also

- [SelectBuilder](./02-select-builder.md)
- [Relation Loader](./06-relation-loader.md)
- [Query Logging](./10-query-logging.md)
