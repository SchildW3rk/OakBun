import { describe, test, expect } from 'bun:test'
import { defineTable } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'
import { compareSchemas } from '../../packages/core/src/db/migrations/diff'
import type { TableDiff } from '../../packages/core/src/db/migrations/types'

const usersTable = defineTable('users', {
  id:    column.integer().primaryKey(),
  name:  column.text(),
  email: column.text().unique(),
}).build()

const postsTable = defineTable('posts', {
  id:      column.integer().primaryKey(),
  title:   column.text(),
  userId:  column.integer(),
}).build()

function makeTableDiff(name: string, columns: TableDiff['columns']): TableDiff {
  return { name, columns, indexes: [] }
}

describe('compareSchemas — added tables', () => {
  test('new table in target → addedTables', () => {
    const current = new Map<string, TableDiff>()
    const diff = compareSchemas(current, [usersTable])

    expect(diff.addedTables).toHaveLength(1)
    expect(diff.addedTables[0].name).toBe('users')
    expect(diff.droppedTables).toHaveLength(0)
    expect(diff.modifiedTables).toHaveLength(0)
  })

  test('multiple new tables → all in addedTables', () => {
    const current = new Map<string, TableDiff>()
    const diff = compareSchemas(current, [usersTable, postsTable])

    expect(diff.addedTables).toHaveLength(2)
    const names = diff.addedTables.map(t => t.name)
    expect(names).toContain('users')
    expect(names).toContain('posts')
  })
})

describe('compareSchemas — dropped tables', () => {
  test('table in current but not in target → droppedTables', () => {
    const current = new Map<string, TableDiff>([
      ['users', makeTableDiff('users', [])],
      ['old_table', makeTableDiff('old_table', [])],
    ])
    const diff = compareSchemas(current, [usersTable])

    expect(diff.droppedTables).toContain('old_table')
    expect(diff.droppedTables).not.toContain('users')
  })
})

describe('compareSchemas — added columns', () => {
  test('new column in target table → modifiedTables.addedColumns', () => {
    const current = new Map<string, TableDiff>([
      ['users', makeTableDiff('users', [
        { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true, unique: false },
        { name: 'name', type: 'TEXT', nullable: false, primaryKey: false, unique: false },
      ])],
    ])

    const diff = compareSchemas(current, [usersTable])

    expect(diff.modifiedTables).toHaveLength(1)
    const mod = diff.modifiedTables[0]
    expect(mod.name).toBe('users')
    expect(mod.addedColumns.map(c => c.name)).toContain('email')
  })
})

describe('compareSchemas — dropped columns', () => {
  test('column in current but not in target → modifiedTables.droppedColumns', () => {
    const current = new Map<string, TableDiff>([
      ['users', makeTableDiff('users', [
        { name: 'id',       type: 'INTEGER', nullable: false, primaryKey: true,  unique: false },
        { name: 'name',     type: 'TEXT',    nullable: false, primaryKey: false, unique: false },
        { name: 'email',    type: 'TEXT',    nullable: false, primaryKey: false, unique: true  },
        { name: 'old_col',  type: 'TEXT',    nullable: false, primaryKey: false, unique: false },
      ])],
    ])

    const diff = compareSchemas(current, [usersTable])

    expect(diff.modifiedTables).toHaveLength(1)
    expect(diff.modifiedTables[0].droppedColumns).toContain('old_col')
  })
})

describe('compareSchemas — no changes', () => {
  test('identical schema → empty SchemaDiff', () => {
    const current = new Map<string, TableDiff>([
      ['users', makeTableDiff('users', [
        { name: 'id',    type: 'INTEGER', nullable: false, primaryKey: true,  unique: false },
        { name: 'name',  type: 'TEXT',    nullable: false, primaryKey: false, unique: false },
        { name: 'email', type: 'TEXT',    nullable: false, primaryKey: false, unique: true  },
      ])],
    ])

    const diff = compareSchemas(current, [usersTable])

    expect(diff.addedTables).toHaveLength(0)
    expect(diff.droppedTables).toHaveLength(0)
    expect(diff.modifiedTables).toHaveLength(0)
  })
})
