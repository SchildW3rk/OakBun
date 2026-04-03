---
title: "Pagination"
category: "sql"
tags: ["pagination", "page", "limit", "offset"]
related: ["SelectBuilder", "Where Operators", "Aggregation"]
---

# Pagination

OakBun's SelectBuilder provides two pagination styles: page-based and offset-based.

## Page-Based Pagination

`.page(page, size)` — 1-indexed. Page 1 returns the first `size` rows.

```ts
.get('/', {
  query: z.object({
    page: z.coerce.number().min(1).default(1),
    size: z.coerce.number().min(1).max(100).default(20),
  }),
  async handler(ctx) {
    const { page, size } = ctx.query
    const rows = await ctx.db.from(usersTable)
      .orderBy('createdAt', 'DESC')
      .page(page, size)
      .select()
    return ctx.json(rows)
  },
})
```

Generated SQL (page 2, size 20):
```sql
SELECT * FROM "users" ORDER BY "createdAt" DESC LIMIT 20 OFFSET 20
```

## Offset-Based Pagination

`.limit(n)` and `.offset(n)` for manual control:

```ts
const rows = await ctx.db.from(postsTable)
  .where({ published: true })
  .orderBy('createdAt', 'DESC')
  .limit(10)
  .offset(50)
  .select()
```

## Total Count for UI

Combine a count query with the paginated query:

```ts
async handler(ctx) {
  const { page, size } = ctx.query
  const [total, rows] = await Promise.all([
    ctx.db.from(usersTable).count(),
    ctx.db.from(usersTable).page(page, size).select(),
  ])
  return ctx.json({
    data:       rows,
    total,
    page,
    totalPages: Math.ceil(total / size),
  })
},
```

## See Also

- [SelectBuilder](./02-select-builder.md)
- [Aggregation](./05-aggregation.md)
