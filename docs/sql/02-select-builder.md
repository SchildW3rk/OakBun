---
title: "SelectBuilder"
category: "sql"
tags: ["select", "query", "builder", "db"]
related: ["Where Operators", "Pagination", "Aggregation", "Join Builder"]
---

# SelectBuilder

Fluent builder for `SELECT` queries. Returned by `ctx.db.from(table)`.

## Signature

```ts
ctx.db.from<T>(table: TableDef<T>): SelectBuilder<T>
```

## Basic Example

```ts
// Select all rows
const users = await ctx.db.from(usersTable).select()

// Select with condition
const admins = await ctx.db.from(usersTable)
  .where({ role: 'admin' })
  .select()

// Select first matching row
const user = await ctx.db.from(usersTable)
  .where({ email: 'alice@example.com' })
  .first()
```

## Methods

### `.where(conditions)`

Filter rows. See [Where Operators](./03-where-operators.md) for full syntax.

```ts
.where({ role: 'admin' })
.where({ id: { op: 'IN', value: [1, 2, 3] } })
.where({ OR: [{ role: 'admin' }, { role: 'moderator' }] })
```

### `.whereRaw(sql, params?)`

Raw SQL WHERE fragment appended with AND:

```ts
.whereRaw('created_at > NOW() - INTERVAL \'7 days\'')
.whereRaw('LOWER(email) = ?', ['alice@example.com'])
```

### `.select()`

Execute the query and return all matching rows as `T[]`.

```ts
const rows = await ctx.db.from(usersTable).select()
```

### `.first()`

Return the first matching row or `undefined`.

```ts
const user = await ctx.db.from(usersTable).where({ id: 1 }).first()
```

### `.columns(...cols)`

Select specific columns:

```ts
const names = await ctx.db.from(usersTable).columns('id', 'name').select()
```

### `.orderBy(col, dir?)`

Sort results:

```ts
.orderBy('createdAt', 'DESC')
.orderBy('name', 'ASC')
```

### `.limit(n)` / `.offset(n)`

Manual pagination:

```ts
.limit(20).offset(40)
```

### `.page(page, size)`

Page-based pagination (1-indexed):

```ts
.page(2, 20)   // LIMIT 20 OFFSET 20
```

### `.groupBy(...cols)`

Group rows:

```ts
.groupBy('role')
```

### `.having(sql, params?)`

Filter grouped results:

```ts
.groupBy('role').having('COUNT(*) > ?', [5])
```

### `.aggregate<T>(clause)`

Run an aggregation query:

```ts
const [result] = await ctx.db.from(usersTable)
  .aggregate<{ total: number }>({ fn: 'COUNT', alias: 'total' })
```

### `.count()` / `.sum(col)` / `.avg(col)` / `.min(col)` / `.max(col)`

Shorthand aggregations:

```ts
const total = await ctx.db.from(usersTable).count()
const avgAge = await ctx.db.from(usersTable).avg('age')
```

### `.update(where, data)`

Update matching rows:

```ts
const updated = await ctx.db.from(usersTable)
  .update({ id: 1 }, { name: 'Alice Updated' })
```

### `.delete(where?)`

Delete matching rows:

```ts
const deleted = await ctx.db.from(usersTable).where({ id: 1 }).delete()
```

## InsertBuilder

Returned by `ctx.db.into(table)`:

```ts
// Insert one row
const user = await ctx.db.into(usersTable).insert({ name: 'Alice', email: 'alice@example.com' })

// Insert many rows
const users = await ctx.db.into(usersTable).insertMany([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob',   email: 'bob@example.com' },
])
```

## Full Query Example

```ts
const recentAdmins = await ctx.db.from(usersTable)
  .where({ role: 'admin' })
  .where({ createdAt: { op: '>', value: new Date(Date.now() - 86_400_000) } })
  .orderBy('createdAt', 'DESC')
  .limit(10)
  .select()
```

## See Also

- [Where Operators](./03-where-operators.md)
- [Pagination](./04-pagination.md)
- [Aggregation](./05-aggregation.md)
- [Join Builder](./08-join-builder.md)
