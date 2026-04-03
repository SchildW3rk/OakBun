---
title: "N+1 Detection"
category: "guides"
tags: ["n+1", "performance", "query", "optimization"]
related: ["Relation Loader", "Query Logging", "SelectBuilder"]
---

# N+1 Detection

The N+1 problem occurs when fetching a list of N rows and then making one additional query per row. OakBun detects this pattern and logs a warning.

## What is N+1?

```ts
// PROBLEMATIC — 1 + N queries (1 for posts, N for comments)
const posts = await ctx.db.from(postsTable).select()   // 1 query
for (const post of posts) {
  post.comments = await ctx.db                          // N queries
    .from(commentsTable)
    .where({ postId: post.id })
    .select()
}
```

With 100 posts, this makes 101 queries.

## Detection Configuration

Enable N+1 detection in `dbPlugin`:

```ts
app.use(dbPlugin(adapter, {
  enabled:     true,
  n1Threshold: 10,   // warn if a single request makes more than 10 queries
}))
```

When exceeded, OakBun logs:

```
[db:n+1] 101 queries in GET /posts — threshold: 10
```

## The Fix: loadRelation

Replace the loop with a single batch query:

```ts
// GOOD — 2 queries regardless of post count
const posts = await ctx.db.from(postsTable).select()

const commentsByPost = await ctx.db.loadRelation(
  posts,          // parent rows
  'id',           // parent key
  commentsTable,  // child table
  'postId',       // child foreign key
)

const result = posts.map((post) => ({
  ...post,
  comments: commentsByPost.get(post.id) ?? [],
}))
```

## loadRelationOne for Belongs-To

```ts
// Posts with author — 2 queries
const posts  = await ctx.db.from(postsTable).select()
const authors = await ctx.db.loadRelationOne(posts, 'authorId', usersTable, 'id')

const result = posts.map((post) => ({
  ...post,
  author: authors.get(post.authorId) ?? null,
}))
```

## Debugging with Query Log

Access the per-request query log to diagnose slow endpoints:

```ts
.get('/debug', async (ctx) => {
  const posts = await ctx.db.from(postsTable).select()
  return ctx.json({
    posts,
    _debug: {
      queryCount: ctx._queryLog?.queries,
      totalMs:    ctx._queryLog?.totalMs,
      queries:    ctx._queryLog?.entries.map((e) => ({
        sql: e.sql,
        ms:  e.durationMs,
      })),
    },
  })
})
```

## Threshold Guidelines

| Scenario | Suggested Threshold |
|---|---|
| Simple CRUD API | 5–10 |
| Content-heavy API | 10–20 |
| Dashboards with aggregations | 20–50 |
| Disable detection | omit `n1Threshold` |

## See Also

- [Relation Loader](../sql/06-relation-loader.md)
- [Query Logging](../sql/10-query-logging.md)
- [DB Plugin](../plugins/04-db-plugin.md)
