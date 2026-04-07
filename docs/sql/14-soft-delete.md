---
title: "Soft Delete"
category: "sql"
tags: ["soft-delete", "delete", "restore", "withDeleted", "timestamp"]
related: ["defineTable", "SelectBuilder", "Relations"]
---

# Soft Delete

## Setup

Add a nullable timestamp column to the schema and call `.withSoftDelete()`:

```ts
const usersTable = defineTable('users', {
  id:        column.integer().primaryKey(),
  name:      column.text(),
  deletedAt: column.timestamp().nullable(),
})
  .withSoftDelete('deletedAt')
  .build()
```

The column must exist in the schema — `build()` throws if it does not.

## Behaviour overview

| Operation | Effect |
|-----------|--------|
| `.select()` | Filters `"deletedAt" IS NULL` automatically |
| `.first()` | Filters `"deletedAt" IS NULL` automatically |
| `.count()`, `.sum()`, etc. | Respect the soft-delete filter |
| `.subquery()` | SQL includes `"deletedAt" IS NULL` |
| `.withDeleted().select()` | Returns all rows, including deleted |
| `.softDelete().where(...).execute()` | Sets `deletedAt = NOW()` |
| `.restore().where(...).execute()` | Sets `deletedAt = NULL` |
| `.delete().where(...)` | Hard delete — unaffected by soft delete |

## Soft-deleting rows

```ts
// Single row
await db.from(usersTable).softDelete().where({ id: 1 }).execute()

// Multiple rows
await db.from(usersTable).softDelete().where({ role: 'guest' }).execute()

// All rows (use with care)
await db.from(usersTable).softDelete().execute()
```

`softDelete()` does **not** call `beforeUpdate`/`afterUpdate` hooks — it is a
system-level operation, not a user-initiated record update.

## Restoring rows

```ts
await db.from(usersTable).restore().where({ id: 1 }).execute()
```

After restore, the row is visible again in regular `select()` calls.

## Including deleted rows

```ts
const allUsers = await db.from(usersTable).withDeleted().select()

// Combine with .where() to find a specific deleted row
const deletedUser = await db.from(usersTable)
  .withDeleted()
  .where({ id: 1 })
  .first()
```

`.withDeleted()` is immutable — the original builder is unaffected.

## Relations

When a **foreign table** has soft delete configured, eager loading and
`loadRelation` automatically exclude deleted foreign rows:

```ts
// belongsTo — deleted author resolves to null
const posts = await db.from(postsTable).with({ author: true }).select()
posts[0].author  // → User | null  (null if author is soft-deleted)

// hasMany — deleted children are excluded from arrays
const posts = await db.from(postsTable).with({ comments: true }).select()
posts[0].comments  // → only non-deleted comments
```

`.withDeleted()` applies only to the **main query** — not to loaded relations.
Full opt-out for relations is not yet supported.

## Tables without soft delete

`.withDeleted()` and `.softDelete()` / `.restore()` are available on all tables:

- `.withDeleted()` — no effect if `softDeleteColumn` is null
- `.softDelete().execute()` — throws an informative error at execute time

## Notes

- The soft-delete column type must be `column.timestamp().nullable()`
- SQLite stores timestamps as ISO strings; they are deserialized to `Date` objects
- Without `.where()`, `.softDelete()` affects **all rows** in the table
