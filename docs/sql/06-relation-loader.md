---
title: "Relation Loader"
category: "sql"
tags: ["relations", "loadRelation", "n+1", "dataloader"]
related: ["N+1 Detection", "SelectBuilder", "Raw SQL"]
---

# Relation Loader

`loadRelation` and `loadRelationOne` solve the N+1 query problem by batching child lookups into a single `IN` query.

## loadRelation — One-to-Many

Loads multiple children per parent. Returns a `Map<parentKeyValue, TChild[]>`.

```ts
async handler(ctx) {
  const posts = await ctx.db.from(postsTable).select()

  // Single IN query: SELECT * FROM comments WHERE post_id IN (...)
  const commentsByPost = await ctx.db.loadRelation(
    posts,        // parent rows
    'id',         // parent key (foreign key side: which field on parent)
    commentsTable, // child table
    'postId',     // child foreign key field
  )

  return ctx.json(
    posts.map((post) => ({
      ...post,
      comments: commentsByPost.get(post.id) ?? [],
    }))
  )
},
```

## loadRelationOne — Many-to-One (Belongs-To)

Loads one child per parent. Returns a `Map<fkValue, TChild>`.

```ts
async handler(ctx) {
  const posts = await ctx.db.from(postsTable).select()

  // Single IN query: SELECT * FROM users WHERE id IN (...)
  const authorsById = await ctx.db.loadRelationOne(
    posts,       // parent rows
    'authorId',  // foreign key on parent
    usersTable,  // child table
    'id',        // primary key on child
  )

  return ctx.json(
    posts.map((post) => ({
      ...post,
      author: authorsById.get(post.authorId) ?? null,
    }))
  )
},
```

## Signatures

```ts
// One-to-Many
ctx.db.loadRelation<TParent, TChild, TFk, TPk>(
  parents:    TParent[],
  foreignKey: TFk,         // key on parent pointing to child's PK
  childTable: TableDef<TChild>,
  primaryKey: TPk,         // PK on child table
): Promise<Map<TParent[TFk], TChild[]>>

// Many-to-One
ctx.db.loadRelationOne<TParent, TChild, TFk, TPk>(
  parents:    TParent[],
  foreignKey: TFk,         // FK on parent
  childTable: TableDef<TChild>,
  primaryKey: TPk,         // PK on child
): Promise<Map<TParent[TFk], TChild>>
```

## Why Not a Loop?

The naive approach makes N+1 queries:

```ts
// BAD — 1 query per post
const posts = await ctx.db.from(postsTable).select()
for (const post of posts) {
  post.comments = await ctx.db.from(commentsTable).where({ postId: post.id }).select()
}
```

`loadRelation` collapses this to 2 queries regardless of how many posts there are.

## See Also

- [N+1 Detection](./10-query-logging.md)
- [N+1 Detection Guide](../guides/06-n1-detection.md)
- [SelectBuilder](./02-select-builder.md)
