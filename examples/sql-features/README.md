# OakBun SQL Features — Examples

Runnable examples for every SQL feature added since v1.1.
Each file is self-contained: it creates an in-memory SQLite DB, seeds data, and prints results.

## Setup

```sh
bun install
```

## Run

```sh
bun examples/sql-features/01-batch-ops.ts
bun examples/sql-features/02-relations.ts
bun examples/sql-features/03-eager-loading.ts
bun examples/sql-features/04-subqueries.ts
bun examples/sql-features/05-soft-delete.ts
bun examples/sql-features/06-distinct-union.ts
bun examples/sql-features/07-combined.ts
```

## Features

| File | Feature |
|------|---------|
| `01-batch-ops.ts` | `insertMany()` / `updateMany()` — bulk ops, transactional rollback |
| `02-relations.ts` | `loadRelation()` / `loadRelationOne()` — name-based and explicit |
| `03-eager-loading.ts` | `.with({ author, comments })` — 3 queries, not N+1 |
| `04-subqueries.ts` | `.columns('id').subquery()` in `WHERE IN` / `NOT IN` |
| `05-soft-delete.ts` | `.softDelete()` / `.restore()` / `.withDeleted()` |
| `06-distinct-union.ts` | `.distinct()` / `.union()` / `.unionAll()` / union as subquery |
| `07-combined.ts` | All features in a realistic moderation workflow |

## Shared Helpers (`_shared/`)

- **`schema.ts`** — Blog-like schema: users, posts, comments, tags with relations and soft delete
- **`seed.ts`** — `createDB(adapter)`, `createTables(adapter)`, `seed(db)` — used by every example
