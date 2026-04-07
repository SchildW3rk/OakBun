---
title: "Subqueries"
category: "sql"
tags: ["subquery", "where", "in", "not-in", "type-safe"]
related: ["SelectBuilder", "Where Operators", "SQL Overview"]
---

# Subqueries

Use a typed subquery as a `WHERE IN` or `WHERE NOT IN` value — no `db.raw()` needed
for this common pattern.

## Basic usage

```ts
const activeUserIds = db
  .from(usersTable)
  .columns('id')
  .where({ active: true })
  .subquery()
// → SubqueryResult<'id', number>

const posts = await db
  .from(postsTable)
  .where({ authorId: { op: 'IN', value: activeUserIds } })
  .select()
// SQL: SELECT * FROM "posts"
//      WHERE "authorId" IN (SELECT "id" FROM "users" WHERE "active" = ?)
// Params: [true]
```

One bind call — the subquery params are forwarded automatically. No N+1, no raw SQL.

## NOT IN

```ts
const bannedIds = db.from(usersTable).columns('id').where({ banned: true }).subquery()

const posts = await db
  .from(postsTable)
  .where({ authorId: { op: 'NOT IN', value: bannedIds } })
  .select()
```

## Type safety

The column type flows through `SubqueryResult<Col, T>` and is checked against
the outer `WHERE` condition at compile time.

```ts
const idSub   = db.from(usersTable).columns('id').subquery()    // SubqueryResult<'id', number>
const nameSub = db.from(usersTable).columns('name').subquery()  // SubqueryResult<'name', string>

.where({ authorId: { op: 'IN', value: idSub   } })  // ✓ authorId: number
.where({ authorId: { op: 'IN', value: nameSub } })  // Compile-error: string ≠ number
```

## ColumnRestrictedBuilder API

`.columns(singleCol)` returns a `ColumnRestrictedBuilder` that exposes:

| Method | Description |
|--------|-------------|
| `.where(conditions)` | Add WHERE clause |
| `.limit(n)` | Add LIMIT |
| `.orderBy(col, dir)` | Add ORDER BY |
| `.subquery()` | Build and return `SubqueryResult` |

`.select()`, `.with()`, `.update()`, `.delete()` are intentionally absent —
use `.columns('a', 'b')` (multi-column) to get a full `SelectBuilder` back.

## Composability

Subqueries compose freely with the outer query builder:

```ts
const activeIds = db.from(usersTable).columns('id').where({ active: true }).subquery()

const posts = await db
  .from(postsTable)
  .where({ authorId: { op: 'IN', value: activeIds } })
  .with({ author: true })       // ← eager loading still works
  .orderBy('id', 'DESC')
  .limit(10)
  .select()
```

## Supported operators

| Operator | Array | SubqueryResult |
|----------|-------|----------------|
| `IN`     | ✓     | ✓              |
| `NOT IN` | ✓     | ✓              |
| `LIKE`   | ✗     | ✗              |
| `>`, `<`, `=` | ✗ | ✗            |

## Limitations

- **Single column only** — `.columns('id')` ✓, multi-column subqueries → use `db.raw()`
- **No EXISTS** — use `db.raw('SELECT 1 FROM ...')`
- **No scalar comparisons** — `> (SELECT MAX(...))` → use `db.raw()`
- **Nested subqueries** — syntactically supported but not tested

## See Also

- [Where Operators](./03-where-operators.md)
- [SelectBuilder](./02-select-builder.md)
- [Raw SQL](./07-raw-sql.md)
