---
title: "Relations"
category: "sql"
tags: ["relations", "belongsTo", "hasMany", "manyToMany", "schema", "metadata"]
related: ["Relation Loader", "Batch Operations", "SelectBuilder"]
---

# Relations

Declare relations directly on `defineTable()`. The metadata is stored on the table object and can be used by `loadRelation()` and `loadRelationOne()` without repeating column names.

## Declaration

```ts
const usersTable = defineTable('users', {
  id:   column.integer().primaryKey(),
  name: column.text(),
})
  .hasMany('posts', () => postsTable, 'authorId')
  .build()

const postsTable = defineTable('posts', {
  id:       column.integer().primaryKey(),
  title:    column.text(),
  authorId: column.integer(),
})
  .belongsTo('author', () => usersTable, 'authorId')
  .hasMany('comments', () => commentsTable, 'postId')
  .build()
```

Always use a **lazy getter** (`() => table`) — this allows circular references between tables without runtime errors.

## Relation kinds

| Kind | Method | FK location |
|------|--------|-------------|
| `belongsTo` | `.belongsTo(name, () => table, fk)` | FK is on **this** table |
| `hasMany` | `.hasMany(name, () => table, fk)` | FK is on the **foreign** table |
| `manyToMany` | `.manyToMany(name, () => table, pivot, localKey, fk)` | Via pivot table |

## Loading relations

Use the relation name instead of repeating column names:

```ts
// Name-based (recommended):
const posts = await ctx.db.from(postsTable).select()
const authorMap = await ctx.db.loadRelation(posts, 'author', postsTable)
// → Map<authorId, User[]>

// Explicit (still works unchanged):
const authorMap = await ctx.db.loadRelation(posts, 'authorId', usersTable, 'id')
```

Both forms issue a single `IN` query — no N+1.

### loadRelationOne with a name

```ts
const authorMap = await ctx.db.loadRelationOne(posts, 'author', postsTable)
// → Map<authorId, User>  (single entity per key, not array)
```

### hasMany via loadRelation

```ts
const users = await ctx.db.from(usersTable).select()
const postsMap = await ctx.db.loadRelation(users, 'posts', usersTable)
// → Map<userId, Post[]>
```

## manyToMany

Declare the relation with a pivot table:

```ts
const postsTable = defineTable('posts', { ... })
  .manyToMany('tags', () => tagsTable, postTagsTable, 'postId', 'tagId')
  .build()
```

`loadRelation` does not yet support `manyToMany` — use a manual `JOIN` or `db.raw()` until eager loading is implemented.

## Accessing metadata

Relation metadata is available on the built table object:

```ts
postsTable.relations['author'].kind        // 'belongsTo'
postsTable.relations['author'].foreignKey  // 'authorId'
postsTable.relations['author'].getTable()  // usersTable
```

## Circular references

Lazy getters solve the forward-reference problem:

```ts
// usersTable declared first, postsTable not yet defined
const usersTable = defineTable('users', { ... })
  .hasMany('posts', () => postsTable, 'authorId')  // ✓ lazy — evaluated later
  .build()

const postsTable = defineTable('posts', { ... })
  .belongsTo('author', () => usersTable, 'authorId')  // ✓ usersTable already defined
  .build()
```

## Eager loading via `.with()`

Load relations inline — one additional `IN` query per relation, never N+1.

```ts
// belongsTo — single entity per row
const posts = await ctx.db.from(postsTable).with({ author: true }).select()
posts[0].author  // → User | null  (fully typed)
posts[0].title   // → string

// hasMany — array per row
const posts = await ctx.db.from(postsTable).with({ comments: true }).select()
posts[0].comments  // → Comment[]

// Multiple relations in one call
const posts = await ctx.db.from(postsTable)
  .with({ author: true, comments: true })
  .select()
```

`.with()` is fully composable — combine freely with `.where()`, `.limit()`, `.orderBy()`, etc.

```ts
const posts = await ctx.db.from(postsTable)
  .where({ authorId: 1 })
  .with({ author: true, comments: true })
  .orderBy('id', 'DESC')
  .limit(10)
  .select()
```

### Query count

| Relations loaded | Queries issued |
|-----------------|---------------|
| 0 | 1 (main) |
| 1 | 2 (main + 1 IN) |
| N | N+1 (main + N IN) |

### Return type

`.with()` narrows the return type using `WithRelations<T, TTable, Keys>`:

```ts
type PostWithAuthor = WithRelations<Post, typeof postsTable, 'author'>
// → Post & { author: User | null }

type PostFull = WithRelations<Post, typeof postsTable, 'author' | 'comments'>
// → Post & { author: User | null; comments: Comment[] }
```

### Limitations

- `manyToMany` is not yet supported — use `loadRelation` with a manual `JOIN`.
- Only top-level relations; nested eager loading is not supported.

## See Also

- [Relation Loader](./06-relation-loader.md)
- [Batch Operations](./11-batch-operations.md)
- [SelectBuilder](./02-select-builder.md)
