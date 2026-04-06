import { describe, test, expect } from 'bun:test'
import { defineTable } from '../../packages/core/src/schema/table'
import type { RelationKind } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'

// ── Shared schema (forward-declared for circular reference test) ─────────────

// usersTable declared first, references postsTable lazily
const usersTable = defineTable('users', {
  id:   column.integer().primaryKey(),
  name: column.text(),
})
  .hasMany('posts', () => postsTable, 'authorId')
  .build()

// postsTable declared after, references usersTable (already defined) and commentsTable (lazy)
const postsTable = defineTable('posts', {
  id:       column.integer().primaryKey(),
  title:    column.text(),
  authorId: column.integer(),
})
  .belongsTo('author', () => usersTable, 'authorId')
  .hasMany('comments', () => commentsTable, 'postId')
  .build()

const commentsTable = defineTable('comments', {
  id:     column.integer().primaryKey(),
  body:   column.text(),
  postId: column.integer(),
}).build()

const tagsTable = defineTable('tags', {
  id:   column.integer().primaryKey(),
  name: column.text(),
}).build()

const postTagsTable = defineTable('post_tags', {
  id:      column.integer().primaryKey(),
  postId:  column.integer(),
  tagId:   column.integer(),
}).build()

// ── Compile-time type checks ──────────────────────────────────────────────────

// RelationKind must only accept the three valid values
const _validKind: RelationKind = 'belongsTo'
const _validKind2: RelationKind = 'hasMany'
const _validKind3: RelationKind = 'manyToMany'
// @ts-expect-error — 'unknown' is not a valid RelationKind
const _badKind: RelationKind = 'unknown'

// ── relations default ─────────────────────────────────────────────────────────

describe('defineTable — relations default', () => {
  test('relations is empty object when no relations declared', () => {
    const t = defineTable('empty', { id: column.integer().primaryKey() }).build()
    expect(t.relations).toEqual({})
    expect(Object.keys(t.relations)).toHaveLength(0)
  })
})

// ── belongsTo ────────────────────────────────────────────────────────────────

describe('defineTable — .belongsTo()', () => {
  test('adds RelationMeta with kind belongsTo', () => {
    expect(postsTable.relations['author']).toBeDefined()
    expect(postsTable.relations['author']!.kind).toBe('belongsTo')
  })

  test('foreignKey is stored correctly', () => {
    expect(postsTable.relations['author']!.foreignKey).toBe('authorId')
  })

  test('getTable is a function', () => {
    expect(typeof postsTable.relations['author']!.getTable).toBe('function')
  })

  test('getTable() resolves to the correct table', () => {
    expect(postsTable.relations['author']!.getTable()).toBe(usersTable)
  })

  test('getTable() returns same reference on every call', () => {
    const rel = postsTable.relations['author']!
    expect(rel.getTable()).toBe(rel.getTable())
  })

  test('name matches the key in relations', () => {
    expect(postsTable.relations['author']!.name).toBe('author')
  })
})

// ── hasMany ───────────────────────────────────────────────────────────────────

describe('defineTable — .hasMany()', () => {
  test('adds RelationMeta with kind hasMany', () => {
    expect(usersTable.relations['posts']).toBeDefined()
    expect(usersTable.relations['posts']!.kind).toBe('hasMany')
  })

  test('foreignKey is the FK on the foreign table', () => {
    // users.hasMany(posts) → FK is posts.authorId
    expect(usersTable.relations['posts']!.foreignKey).toBe('authorId')
  })

  test('getTable() resolves to the correct table', () => {
    // usersTable was defined before postsTable — lazy getter must still work
    expect(usersTable.relations['posts']!.getTable()).toBe(postsTable)
  })
})

// ── Chaining ─────────────────────────────────────────────────────────────────

describe('defineTable — chaining multiple relations', () => {
  test('both relations present after .belongsTo().hasMany()', () => {
    expect(postsTable.relations['author']).toBeDefined()
    expect(postsTable.relations['comments']).toBeDefined()
    expect(Object.keys(postsTable.relations)).toHaveLength(2)
  })

  test('each relation has its correct kind', () => {
    expect(postsTable.relations['author']!.kind).toBe('belongsTo')
    expect(postsTable.relations['comments']!.kind).toBe('hasMany')
  })

  test('second relation does not overwrite the first', () => {
    expect(postsTable.relations['author']!.foreignKey).toBe('authorId')
    expect(postsTable.relations['comments']!.foreignKey).toBe('postId')
  })
})

// ── manyToMany ────────────────────────────────────────────────────────────────

describe('defineTable — .manyToMany()', () => {
  const postsWithTags = defineTable('posts_with_tags', {
    id:    column.integer().primaryKey(),
    title: column.text(),
  })
    .manyToMany('tags', () => tagsTable, postTagsTable, 'postId', 'tagId')
    .build()

  test('adds RelationMeta with kind manyToMany', () => {
    expect(postsWithTags.relations['tags']).toBeDefined()
    expect(postsWithTags.relations['tags']!.kind).toBe('manyToMany')
  })

  test('getTable() resolves to the correct table', () => {
    expect(postsWithTags.relations['tags']!.getTable()).toBe(tagsTable)
  })

  test('pivot metadata is stored correctly', () => {
    const rel = postsWithTags.relations['tags']!
    expect(rel.pivot).toBeDefined()
    expect(rel.pivot!.table).toBe(postTagsTable)
    expect(rel.pivot!.localKey).toBe('postId')
    expect(rel.pivot!.foreignKey).toBe('tagId')
  })
})

// ── Lazy getter — circular reference ─────────────────────────────────────────

describe('defineTable — lazy getter resolves circular references', () => {
  test('usersTable.relations[posts].getTable() === postsTable (defined after)', () => {
    // usersTable was defined before postsTable but uses lazy () => postsTable
    expect(usersTable.relations['posts']!.getTable()).toBe(postsTable)
  })

  test('postsTable.relations[author].getTable() === usersTable (defined before)', () => {
    expect(postsTable.relations['author']!.getTable()).toBe(usersTable)
  })
})

// ── build() immutability ──────────────────────────────────────────────────────

describe('defineTable — relations are immutable after build()', () => {
  test('mutating builder after build() does not affect built TableDef', () => {
    const builder = defineTable('isolated', {
      id:   column.integer().primaryKey(),
      name: column.text(),
    }).hasMany('items', () => tagsTable, 'parentId')

    const def = builder.build()
    expect(Object.keys(def.relations)).toHaveLength(1)

    // Adding another relation to the builder after build() must NOT affect def
    builder.hasMany('moreItems', () => commentsTable, 'parentId')

    expect(Object.keys(def.relations)).toHaveLength(1)
  })
})

// ── Unhappy path ──────────────────────────────────────────────────────────────

describe('defineTable — relation errors', () => {
  test('duplicate relation name throws', () => {
    expect(() =>
      defineTable('dup', { id: column.integer().primaryKey() })
        .belongsTo('author', () => usersTable, 'id')
        .belongsTo('author', () => usersTable, 'id'),  // duplicate
    ).toThrow("Relation 'author' is already defined on table 'dup'")
  })

  test('duplicate name across different kinds also throws', () => {
    expect(() =>
      defineTable('dup2', { id: column.integer().primaryKey() })
        .belongsTo('related', () => usersTable, 'id')
        .hasMany('related', () => postsTable, 'userId'),  // same name, different kind
    ).toThrow("Relation 'related' is already defined on table 'dup2'")
  })
})
