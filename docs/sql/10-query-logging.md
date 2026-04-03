---
title: "Query Logging & N+1 Detection"
category: "sql"
tags: ["logging", "n+1", "performance", "debug"]
related: ["DB Plugin", "Relation Loader", "N+1 Detection Guide"]
---

# Query Logging & N+1 Detection

OakBun can log SQL queries, measure execution time, and warn when a request makes more queries than a configured threshold.

## Setup

Configure via `dbPlugin`:

```ts
app.use(dbPlugin(adapter, {
  enabled:     true,         // enable query logging (default: false)
  slowQueryMs: 100,          // warn on queries slower than 100ms
  logQueries:  true,         // log every query (verbose)
  n1Threshold: 10,           // warn if request makes > 10 queries
  level:       'debug',      // log level
}))
```

## DbLogOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `false` | Enable the query log |
| `slowQueryMs` | `number` | — | Log warning if query exceeds this ms |
| `logQueries` | `boolean` | `false` | Log every executed query |
| `n1Threshold` | `number` | — | Warn if request query count exceeds |
| `level` | `LogLevel` | `'debug'` | Log level for query messages |
| `onQuery` | `(entry) => void` | — | Custom query callback |

## Per-Request Query Log

Access the query log inside a route handler:

```ts
.get('/debug', async (ctx) => {
  const data = await ctx.db.from(usersTable).select()
  return ctx.json({
    data,
    queries:   ctx._queryLog?.entries.length,
    totalMs:   ctx._queryLog?.totalMs,
  })
})
```

## QueryLog Type

```ts
interface QueryLog {
  queries:     number        // total query count for this request
  totalMs:     number        // total execution time
  threshold:   number        // n1Threshold
  logQueries:  boolean
  entries:     QueryLogEntry[]
}

interface QueryLogEntry {
  sql:        string
  params:     BindingValue[]
  durationMs: number
}
```

## N+1 Warning

When `n1Threshold` is set and a request exceeds it, OakBun logs:

```
[db:n+1] 11 queries in GET /items — threshold: 10
```

Use `loadRelation` or `loadRelationOne` to fix N+1 patterns. See [Relation Loader](./06-relation-loader.md).

## See Also

- [Relation Loader](./06-relation-loader.md)
- [N+1 Detection Guide](../guides/06-n1-detection.md)
- [DB Plugin](../plugins/04-db-plugin.md)
