---
title: "Aggregation"
category: "sql"
tags: ["aggregation", "count", "sum", "avg", "groupBy"]
related: ["SelectBuilder", "Pagination", "Raw SQL"]
---

# Aggregation

SelectBuilder supports COUNT, SUM, AVG, MIN, MAX, and GROUP BY with HAVING.

## Shorthand Methods

```ts
// Total row count
const total = await ctx.db.from(usersTable).count()

// Sum of a column
const totalSales = await ctx.db.from(ordersTable).sum('amount')

// Average
const avgAge = await ctx.db.from(usersTable).avg('age')

// Min / Max
const earliest = await ctx.db.from(postsTable).min('createdAt')
const latest    = await ctx.db.from(postsTable).max('createdAt')
```

## Full aggregate()

Use `.aggregate<T>()` for custom aggregate expressions with aliases:

```ts
const [result] = await ctx.db.from(usersTable)
  .aggregate<{ total: number; admins: number }>([
    { fn: 'COUNT', alias: 'total' },
    { fn: 'COUNT', col: 'id', alias: 'admins',
      filter: { role: 'admin' } },
  ])

console.log(result.total, result.admins)
```

Supported functions: `'COUNT'` | `'SUM'` | `'AVG'` | `'MIN'` | `'MAX'`

## GROUP BY

```ts
const byRole = await ctx.db.from(usersTable)
  .groupBy('role')
  .aggregate<{ role: string; count: number }>([
    { fn: 'COUNT', alias: 'count' },
  ])

// [{ role: 'admin', count: 3 }, { role: 'user', count: 42 }]
```

## HAVING

Filter on aggregated values:

```ts
const popularTags = await ctx.db.from(tagsTable)
  .groupBy('name')
  .having('COUNT(*) > ?', [10])
  .aggregate<{ name: string; count: number }>([
    { fn: 'COUNT', alias: 'count' },
  ])
```

## Combined with WHERE

Filters and aggregations can be combined:

```ts
const recentAdminCount = await ctx.db.from(usersTable)
  .where({ role: 'admin' })
  .where({ createdAt: { op: '>', value: lastWeek } })
  .count()
```

## See Also

- [SelectBuilder](./02-select-builder.md)
- [Pagination](./04-pagination.md)
- [Raw SQL](./07-raw-sql.md)
