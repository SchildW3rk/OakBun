---
title: "Join Builder"
category: "sql"
tags: ["join", "sql", "multi-table", "query"]
related: ["SelectBuilder", "Raw SQL", "Where Operators"]
---

# Join Builder

`JoinBuilder` constructs multi-table joins with a fluent API. Returned by `ctx.db.join(tableName)`.

## Signature

```ts
ctx.db.join(tableName: string): JoinBuilder
```

## Basic Example

```ts
const posts = await ctx.db
  .join('posts')
  .innerJoin('users', 'posts.author_id = users.id')
  .select<{ title: string; authorName: string }>()
```

## Join Types

```ts
.innerJoin(table, on)   // INNER JOIN
.leftJoin(table, on)    // LEFT JOIN
.rightJoin(table, on)   // RIGHT JOIN (not supported in SQLite)
.fullJoin(table, on)    // FULL OUTER JOIN
```

The `on` parameter must follow the format `table.column = table.column`:

```ts
.innerJoin('users', 'posts.author_id = users.id')
.leftJoin('comments', 'posts.id = comments.post_id')
```

## Selecting Columns

```ts
const results = await ctx.db
  .join('posts')
  .innerJoin('users', 'posts.author_id = users.id')
  .columns('posts.id', 'posts.title', 'users.name AS authorName')
  .select<{ id: number; title: string; authorName: string }>()
```

## With WHERE

```ts
const publishedPosts = await ctx.db
  .join('posts')
  .innerJoin('users', 'posts.author_id = users.id')
  .whereRaw('posts.published = ?', [true])
  .orderBy('posts.created_at', 'DESC')
  .limit(20)
  .select<PostWithAuthor>()
```

## .first()

Returns the first result or `undefined`:

```ts
const post = await ctx.db
  .join('posts')
  .innerJoin('users', 'posts.author_id = users.id')
  .whereRaw('posts.id = ?', [id])
  .first<PostWithAuthor>()
```

## JoinClause Type

```ts
interface JoinClause {
  type:  'INNER' | 'LEFT' | 'RIGHT' | 'FULL'
  table: string
  on:    string   // validated: must be "table.col = table.col"
}
```

The `on` clause is validated at query construction time — an invalid format throws a `OakBunError(500, INVALID_JOIN_ON)`.

## When to Use Raw SQL Instead

For complex queries with CTEs, subqueries, or dialect-specific syntax, prefer [`ctx.db.raw()`](./07-raw-sql.md).

## See Also

- [Raw SQL](./07-raw-sql.md)
- [SelectBuilder](./02-select-builder.md)
- [Where Operators](./03-where-operators.md)
