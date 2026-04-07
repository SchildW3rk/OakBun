---
title: "Distinct + Union"
category: "sql"
tags: ["distinct", "union", "deduplication", "combine"]
related: ["SelectBuilder", "Where Operators", "Subqueries"]
---

# Distinct + Union

## Distinct

Remove duplicate rows from the result set.

```ts
// All rows, deduplicated:
await db.from(usersTable).distinct().select()
// → SELECT DISTINCT * FROM "users"

// Distinct on specific columns — must call .distinct() before .columns():
await db.from(usersTable).distinct().columns('name').select()
// → SELECT DISTINCT "name" FROM "users"

// Composable with .where(), .orderBy(), .limit():
await db.from(usersTable)
  .where({ active: true })
  .distinct()
  .orderBy('name')
  .limit(10)
  .select()
// → SELECT DISTINCT * FROM "users" WHERE "active" = ? ORDER BY "name" ASC LIMIT 10
```

### Soft delete + distinct

The soft-delete `IS NULL` filter is applied alongside `DISTINCT`:

```ts
await db.from(usersTable).distinct().select()
// → SELECT DISTINCT * FROM "users" WHERE "deletedAt" IS NULL

await db.from(usersTable).withDeleted().distinct().select()
// → SELECT DISTINCT * FROM "users"  (no IS NULL)
```

---

## Union

Combine results from multiple SELECT queries. Type-safe — both sides must have the same column type.

`.union()` and `.unionAll()` are available on `ColumnRestrictedBuilder` (returned by single-column `.columns()`).

```ts
// UNION — deduplicates:
const ids = await db.from(usersTable).columns('id')
  .union(db.from(adminsTable).columns('id'))
  .select()
// → SELECT "id" FROM "users" WHERE "deletedAt" IS NULL
//   UNION
//   SELECT "id" FROM "admins"

// UNION ALL — keeps duplicates:
await db.from(usersTable).columns('id')
  .unionAll(db.from_adminsTable).columns('id'))
  .select()
// → ... UNION ALL ...
```

### ORDER BY + LIMIT on the combined result

```ts
await db.from(usersTable).columns('id')
  .union(db.from(adminsTable).columns('id'))
  .orderBy('id', 'ASC')
  .limit(10)
  .select()
```

### Chain three or more parts

```ts
db.from(usersTable).columns('id')
  .union(db.from(adminsTable).columns('id'))
  .union(db.from(moderatorsTable).columns('id'))
  .select()
// → SELECT ... UNION SELECT ... UNION SELECT ...
```

### Type safety

Both sides must produce the same column type — checked at compile time:

```ts
// ✓ both id columns are numbers
db.from(usersTable).columns('id').union(db.from(adminsTable).columns('id'))

// Compile error: number ≠ string
db.from(usersTable).columns('id').union(db.from(adminsTable).columns('name'))
```

### Union as subquery

```ts
const adminOrModIds = db.from(usersTable).columns('id').where({ role: 'admin' })
  .union(db.from(usersTable).columns('id').where({ role: 'mod' }))
  .subquery()

const posts = await db.from(postsTable)
  .where({ authorId: { op: 'IN', value: adminOrModIds } })
  .select()
```

### Soft delete in UNION

Each leg of the union applies its own soft-delete filter independently:

```ts
db.from(usersTable).columns('id')   // has soft delete → IS NULL applied
  .union(db.from(adminsTable).columns('id'))  // no soft delete → no filter
```

## See Also

- [SelectBuilder](./02-select-builder.md)
- [Where Operators](./03-where-operators.md)
- [Subqueries](./13-subqueries.md)
