---
title: "Raw SQL"
category: "sql"
tags: ["raw", "sql", "typed", "zod"]
related: ["SelectBuilder", "Join Builder", "Where Operators"]
---

# Raw SQL

`ctx.db.raw()` executes arbitrary SQL and returns typed results.

## Signature

```ts
// Untyped — returns Record<string, unknown>[]
ctx.db.raw(sql: string, params?: BindingValue[]): Promise<Record<string, unknown>[]>

// Typed + validated — validates each row against the Zod schema
ctx.db.raw<T>(
  sql:    string,
  params: BindingValue[],
  schema: { parse: (row: unknown) => T }
): Promise<T[]>
```

## Basic Example

```ts
// Untyped
const rows = await ctx.db.raw(
  'SELECT * FROM orders WHERE amount > ?',
  [100]
)
```

## With Zod Schema

```ts
import { z } from 'zod'

const orderSchema = z.object({
  id:     z.number(),
  amount: z.number(),
  status: z.string(),
})

const orders = await ctx.db.raw(
  'SELECT id, amount, status FROM orders WHERE amount > ?',
  [100],
  orderSchema,
)
// orders is Order[] — fully typed and validated
```

## Complex Queries

Raw SQL is useful for CTEs, window functions, or dialect-specific features:

```ts
const stats = await ctx.db.raw(`
  WITH monthly AS (
    SELECT
      strftime('%Y-%m', created_at) AS month,
      COUNT(*) AS count
    FROM orders
    GROUP BY month
  )
  SELECT * FROM monthly ORDER BY month DESC
  LIMIT ?
`, [12])
```

## BindingValue Types

```ts
type BindingValue = string | number | boolean | null | Uint8Array | Date
```

## See Also

- [Join Builder](./08-join-builder.md)
- [SelectBuilder](./02-select-builder.md)
- [Where Operators](./03-where-operators.md)
