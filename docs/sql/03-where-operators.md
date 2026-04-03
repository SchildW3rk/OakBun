---
title: "Where Operators"
category: "sql"
tags: ["where", "filter", "operators", "query"]
related: ["SelectBuilder", "Join Builder", "Raw SQL"]
---

# Where Operators

OakBun's `WhereInput` type supports equality, comparison, range, pattern, and NULL checks, as well as boolean `AND`/`OR` composition.

## Basic Equality

Shorthand: a plain value means `=`.

```ts
.where({ role: 'admin' })
// SQL: WHERE "role" = 'admin'

.where({ id: 42 })
// SQL: WHERE "id" = 42
```

## WhereOp Operators

Use `{ op, value }` for non-equality comparisons:

```ts
.where({ age: { op: '>', value: 18 } })
.where({ age: { op: '>=', value: 18 } })
.where({ age: { op: '<', value: 65 } })
.where({ age: { op: '<=', value: 65 } })
.where({ role: { op: '!=', value: 'guest' } })
```

## IN / NOT IN

```ts
.where({ id: { op: 'IN', value: [1, 2, 3] } })
.where({ role: { op: 'NOT IN', value: ['guest', 'banned'] } })
```

## LIKE / ILIKE

```ts
.where({ name: { op: 'LIKE', value: 'Alice%' } })
.where({ email: { op: 'ILIKE', value: '%@example.com' } })  // case-insensitive (Postgres)
```

## NULL Checks

```ts
.where({ deletedAt: { op: 'IS NULL' } })
.where({ deletedAt: { op: 'IS NOT NULL' } })
```

## Multiple Conditions (AND)

Multiple fields in the same `.where()` call are ANDed:

```ts
.where({ role: 'admin', published: true })
// SQL: WHERE "role" = 'admin' AND "published" = true
```

Chaining `.where()` calls also produces AND:

```ts
.where({ role: 'admin' })
.where({ published: true })
// SQL: WHERE "role" = 'admin' AND "published" = true
```

## OR Composition

```ts
.where({
  OR: [
    { role: 'admin' },
    { role: 'moderator' },
  ],
})
// SQL: WHERE ("role" = 'admin' OR "role" = 'moderator')
```

## Nested AND / OR

```ts
.where({
  AND: [
    { published: true },
    {
      OR: [
        { role: 'admin' },
        { authorId: ctx.user.id },
      ],
    },
  ],
})
```

## Raw WHERE Fragment

For cases not covered by the builder:

```ts
.whereRaw("created_at > NOW() - INTERVAL '7 days'")
.whereRaw('LOWER(email) LIKE ?', ['%@example.com'])
```

Raw fragments are appended with `AND` to any existing conditions.

## WhereInput Type

```ts
type WhereOp<T> =
  | { op: '=' | '!=' | '>' | '>=' | '<' | '<='; value: T }
  | { op: 'IN' | 'NOT IN'; value: T[] }
  | { op: 'LIKE' | 'ILIKE'; value: string }
  | { op: 'IS NULL' | 'IS NOT NULL' }

type FieldCondition<T> = T | WhereOp<T>

type WhereConditions<TRow> = {
  [K in keyof TRow]?: FieldCondition<TRow[K]>
}

type WhereInput<TRow> =
  | WhereConditions<TRow>
  | { OR: WhereInput<TRow>[] }
  | { AND: WhereInput<TRow>[] }
```

## See Also

- [SelectBuilder](./02-select-builder.md)
- [Raw SQL](./07-raw-sql.md)
