import { describe, test, expect } from 'bun:test'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { defineTable } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'
import { generateMigration } from '../../packages/core/src/db/migrations/generator'

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'veln-gen-'))
}

async function cleanDir(dir: string) {
  await rm(dir, { recursive: true, force: true })
}

const usersTable = defineTable('users', {
  id:    column.integer().primaryKey(),
  name:  column.text(),
  email: column.text().unique(),
}).build()

describe('generateMigration — new table', () => {
  test('generates CREATE TABLE sql for a new table', async () => {
    const dir     = await makeTempDir()
    const adapter = new SQLiteAdapter()
    try {
      const result = await generateMigration({
        tables:        [usersTable],
        adapter,
        migrationsDir: dir,
        name:          'initial',
      })

      expect(result.isEmpty).toBe(false)
      expect(result.filename).toBe('0001_initial.sql')
      expect(result.sql).toContain('CREATE TABLE IF NOT EXISTS "users"')
      expect(result.sql).toContain('"id" INTEGER PRIMARY KEY')
      expect(result.sql).toContain('"name" TEXT NOT NULL')
    } finally {
      await cleanDir(dir)
    }
  })

  test('writes the file to migrationsDir', async () => {
    const dir     = await makeTempDir()
    const adapter = new SQLiteAdapter()
    try {
      await generateMigration({
        tables:        [usersTable],
        adapter,
        migrationsDir: dir,
        name:          'initial',
      })

      const files = await readdir(dir)
      expect(files).toContain('0001_initial.sql')
    } finally {
      await cleanDir(dir)
    }
  })
})

describe('generateMigration — added column', () => {
  test('generates ALTER TABLE ADD COLUMN for new column', async () => {
    const dir     = await makeTempDir()
    const adapter = new SQLiteAdapter()
    try {
      // Create the table in the DB so introspect sees only id + name
      await adapter.execute(`CREATE TABLE "users" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL)`)

      const result = await generateMigration({
        tables:        [usersTable],
        adapter,
        migrationsDir: dir,
        name:          'add_email',
      })

      expect(result.isEmpty).toBe(false)
      expect(result.sql).toContain('ALTER TABLE "users" ADD COLUMN')
      expect(result.sql).toContain('"email"')
    } finally {
      await cleanDir(dir)
    }
  })
})

describe('generateMigration — dropped table', () => {
  test('generates commented DROP TABLE for removed table', async () => {
    const dir     = await makeTempDir()
    const adapter = new SQLiteAdapter()
    try {
      // DB has users + old_table, target only has users
      await adapter.execute(`CREATE TABLE "users" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL, "email" TEXT NOT NULL UNIQUE)`)
      await adapter.execute(`CREATE TABLE "old_table" ("id" INTEGER PRIMARY KEY)`)

      const result = await generateMigration({
        tables:        [usersTable],
        adapter,
        migrationsDir: dir,
        name:          'remove_old',
      })

      expect(result.isEmpty).toBe(false)
      expect(result.sql).toContain('-- WARNING: DROP TABLE "old_table"')
    } finally {
      await cleanDir(dir)
    }
  })
})

describe('generateMigration — no changes', () => {
  test('isEmpty: true when schema matches DB', async () => {
    const dir     = await makeTempDir()
    const adapter = new SQLiteAdapter()
    try {
      await adapter.execute(`CREATE TABLE "users" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL, "email" TEXT NOT NULL UNIQUE)`)

      const result = await generateMigration({
        tables:        [usersTable],
        adapter,
        migrationsDir: dir,
        name:          'noop',
      })

      expect(result.isEmpty).toBe(true)
      expect(result.sql).toBe('')

      // No file written
      const files = await readdir(dir)
      expect(files).toHaveLength(0)
    } finally {
      await cleanDir(dir)
    }
  })
})

describe('generateMigration — filename numbering', () => {
  test('increments number based on existing files', async () => {
    const dir     = await makeTempDir()
    const adapter = new SQLiteAdapter()

    const postsTable = defineTable('posts', {
      id:    column.integer().primaryKey(),
      title: column.text(),
    }).build()

    try {
      // First migration
      const r1 = await generateMigration({
        tables:        [usersTable],
        adapter,
        migrationsDir: dir,
        name:          'initial',
      })
      expect(r1.filename).toBe('0001_initial.sql')

      // Apply it so DB sees users table
      await adapter.execute(`CREATE TABLE "users" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL, "email" TEXT NOT NULL UNIQUE)`)

      // Second migration
      const r2 = await generateMigration({
        tables:        [usersTable, postsTable],
        adapter,
        migrationsDir: dir,
        name:          'add_posts',
      })
      expect(r2.filename).toBe('0002_add_posts.sql')
    } finally {
      await cleanDir(dir)
    }
  })
})
