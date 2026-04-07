import { describe, test, expect } from 'bun:test'
import { defineTable } from '../../packages/core/src/schema/table'
import { column }      from '../../packages/core/src/schema/column'

const usersTable = defineTable('users', {
  id:        column.integer().primaryKey(),
  name:      column.text(),
  deletedAt: column.timestamp().nullable(),
})
  .withSoftDelete('deletedAt')
  .build()

const postsTable = defineTable('posts', {
  id:    column.integer().primaryKey(),
  title: column.text(),
}).build()

describe('withSoftDelete — TableDef', () => {
  test('sets softDeleteColumn on TableDef', () => {
    expect(usersTable.softDeleteColumn).toBe('deletedAt')
  })

  test('softDeleteColumn is null when not configured', () => {
    expect(postsTable.softDeleteColumn).toBeNull()
  })

  test('chainable — withSoftDelete before belongsTo', () => {
    const t = defineTable('comments', {
      id:        column.integer().primaryKey(),
      body:      column.text(),
      deletedAt: column.timestamp().nullable(),
      userId:    column.integer(),
    })
      .withSoftDelete('deletedAt')
      .belongsTo('user', () => usersTable, 'userId')
      .build()

    expect(t.softDeleteColumn).toBe('deletedAt')
    expect(t.relations['user']).toBeDefined()
  })

  test('chainable — belongsTo before withSoftDelete', () => {
    const t = defineTable('comments', {
      id:        column.integer().primaryKey(),
      body:      column.text(),
      deletedAt: column.timestamp().nullable(),
      userId:    column.integer(),
    })
      .belongsTo('user', () => usersTable, 'userId')
      .withSoftDelete('deletedAt')
      .build()

    expect(t.softDeleteColumn).toBe('deletedAt')
    expect(t.relations['user']).toBeDefined()
  })

  test('chainable with hasMany', () => {
    let postsRef: typeof postsWithSoft
    const t = defineTable('users', {
      id:        column.integer().primaryKey(),
      deletedAt: column.timestamp().nullable(),
    })
      .withSoftDelete('deletedAt')
      .hasMany('posts', () => postsRef, 'authorId')
      .build()

    const postsWithSoft = defineTable('posts', {
      id:       column.integer().primaryKey(),
      authorId: column.integer(),
    }).build()

    postsRef = postsWithSoft
    expect(t.softDeleteColumn).toBe('deletedAt')
  })

  test('build() throws when softDeleteColumn not in schema', () => {
    expect(() =>
      defineTable('users', {
        id:   column.integer().primaryKey(),
        name: column.text(),
      })
        .withSoftDelete('deletedAt' as 'id')  // force the type to something valid-looking
        .build(),
    ).toThrow(/withSoftDelete: column 'deletedAt' is not defined/)
  })

  test('softDeleteColumn is preserved through emits()', () => {
    const t = defineTable('users', {
      id:        column.integer().primaryKey(),
      deletedAt: column.timestamp().nullable(),
    })
      .withSoftDelete('deletedAt')
      .emits({ afterInsert: 'user.created' })
      .build()

    expect(t.softDeleteColumn).toBe('deletedAt')
  })
})
