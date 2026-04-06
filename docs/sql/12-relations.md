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

## See Also

- [Relation Loader](./06-relation-loader.md)
- [Batch Operations](./11-batch-operations.md)
- [SelectBuilder](./02-select-builder.md)
