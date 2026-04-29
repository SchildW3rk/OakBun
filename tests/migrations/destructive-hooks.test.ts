import { describe, test, expect } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SQLiteAdapter }   from '../../packages/core/src/adapter/sqlite'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column }          from '../../packages/core/src/schema/column'
import { generateMigration } from '../../packages/core/src/db/migrations/generator'
import { createMigrator }  from '../../packages/core/src/db/migrations/index'

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'oakbun-destr-'))
}

async function cleanDir(dir: string) {
  await rm(dir, { recursive: true, force: true })
}

// ── Part 1: allowDestructive — generator output ──────────────────────────────

describe('generateMigration — allowDestructive', () => {
  test('default (false) — column drop generates comment, not SQL', async () => {
    const dir = await makeTempDir()
    try {
      // Create DB with "old_col" present, then generate migration without it
      const adapter = new SQLiteAdapter()
      await adapter.execute(`CREATE TABLE "users" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL, "old_col" TEXT)`)

      const usersTable = defineTable('users', {
        id:   column.integer().primaryKey(),
        name: column.text(),
        // old_col intentionally absent
      }).build()

      const result = await generateMigration({
        tables:        [usersTable],
        adapter,
        migrationsDir: dir,
        name:          'drop_col',
      })

      expect(result.isEmpty).toBe(false)
      // Should contain a WARNING comment, not actual ALTER TABLE DROP COLUMN
      expect(result.sql).toContain('-- WARNING:')
      expect(result.sql).toContain('DROP COLUMN')
      expect(result.sql).not.toMatch(/^ALTER TABLE/m)
    } finally {
      await cleanDir(dir)
    }
  })

  test('allowDestructive: true — column drop generates real ALTER TABLE', async () => {
    const dir = await makeTempDir()
    try {
      const adapter = new SQLiteAdapter()
      await adapter.execute(`CREATE TABLE "users" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL, "old_col" TEXT)`)

      const usersTable = defineTable('users', {
        id:   column.integer().primaryKey(),
        name: column.text(),
      }).build()

      const result = await generateMigration({
        tables:           [usersTable],
        adapter,
        migrationsDir:    dir,
        name:             'drop_col',
        allowDestructive: true,
      })

      expect(result.isEmpty).toBe(false)
      expect(result.sql).not.toContain('-- WARNING:')
      expect(result.sql).toContain(`ALTER TABLE "users" DROP COLUMN "old_col"`)
    } finally {
      await cleanDir(dir)
    }
  })

  test('allowDestructive: true — column type change generates ALTER TABLE ALTER COLUMN', async () => {
    const dir = await makeTempDir()
    try {
      const adapter = new SQLiteAdapter()
      // old schema: amount is INTEGER, new schema: amount is REAL
      await adapter.execute(`CREATE TABLE "orders" ("id" INTEGER PRIMARY KEY, "amount" INTEGER NOT NULL)`)

      const ordersTable = defineTable('orders', {
        id:     column.integer().primaryKey(),
        amount: column.real(),  // changed from integer to real
      }).build()

      const result = await generateMigration({
        tables:           [ordersTable],
        adapter,
        migrationsDir:    dir,
        name:             'change_type',
        allowDestructive: true,
      })

      expect(result.isEmpty).toBe(false)
      expect(result.sql).not.toContain('-- WARNING:')
      expect(result.sql).toContain(`ALTER TABLE "orders" ALTER COLUMN "amount" TYPE`)
    } finally {
      await cleanDir(dir)
    }
  })

  test('allowDestructive: false — type change generates comment block', async () => {
    const dir = await makeTempDir()
    try {
      const adapter = new SQLiteAdapter()
      await adapter.execute(`CREATE TABLE "orders" ("id" INTEGER PRIMARY KEY, "amount" INTEGER NOT NULL)`)

      const ordersTable = defineTable('orders', {
        id:     column.integer().primaryKey(),
        amount: column.real(),
      }).build()

      const result = await generateMigration({
        tables:           [ordersTable],
        adapter,
        migrationsDir:    dir,
        name:             'change_type',
        allowDestructive: false,
      })

      expect(result.isEmpty).toBe(false)
      expect(result.sql).toContain('-- WARNING:')
      expect(result.sql).toContain('requires manual migration')
      expect(result.sql).not.toContain('ALTER COLUMN')
    } finally {
      await cleanDir(dir)
    }
  })

  test('additive migrations are unaffected by allowDestructive flag', async () => {
    const dir = await makeTempDir()
    try {
      const adapter = new SQLiteAdapter()
      await adapter.execute(`CREATE TABLE "users" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL)`)

      const usersTable = defineTable('users', {
        id:    column.integer().primaryKey(),
        name:  column.text(),
        email: column.text().nullable(),  // new column — additive
      }).build()

      const result = await generateMigration({
        tables:           [usersTable],
        adapter,
        migrationsDir:    dir,
        name:             'add_email',
        allowDestructive: true,
      })

      expect(result.isEmpty).toBe(false)
      expect(result.sql).toContain('ADD COLUMN "email"')
      expect(result.sql).not.toContain('DROP COLUMN')
    } finally {
      await cleanDir(dir)
    }
  })

  test('allowDestructive: true — dropped table generates DROP TABLE IF EXISTS', async () => {
    const dir = await makeTempDir()
    try {
      const adapter = new SQLiteAdapter()
      // DB has "old_table", new schema does not
      await adapter.execute(`CREATE TABLE "old_table" ("id" INTEGER PRIMARY KEY)`)
      await adapter.execute(`CREATE TABLE "users" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL)`)

      const usersTable = defineTable('users', {
        id:   column.integer().primaryKey(),
        name: column.text(),
      }).build()

      const result = await generateMigration({
        tables:           [usersTable],  // old_table not in schema → dropped
        adapter,
        migrationsDir:    dir,
        name:             'drop_table',
        allowDestructive: true,
      })

      expect(result.isEmpty).toBe(false)
      expect(result.sql).toContain(`DROP TABLE IF EXISTS "old_table"`)
      expect(result.sql).not.toContain('-- WARNING:')
    } finally {
      await cleanDir(dir)
    }
  })
})

// ── Part 2: Migration Hooks ───────────────────────────────────────────────────

describe('createMigrator — onBeforeMigrate / onAfterMigrate / onError hooks', () => {
  test('onBeforeMigrate called with name and sql before each migration', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, '0001_create_users.sql'), `
        CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      `)

      const beforeCalls: { name: string; sql: string }[] = []
      const adapter = new SQLiteAdapter()

      const migrator = createMigrator(adapter, {
        migrationsDir:   dir,
        onBeforeMigrate: (m) => { beforeCalls.push({ name: m.name, sql: m.sql }) },
      })

      await migrator.run()

      expect(beforeCalls).toHaveLength(1)
      expect(beforeCalls[0]!.name).toBe('0001_create_users.sql')
      expect(beforeCalls[0]!.sql).toContain('CREATE TABLE users')
    } finally {
      await cleanDir(dir)
    }
  })

  test('onAfterMigrate called with name, sql, and durationMs >= 0', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, '0001_create_users.sql'), `
        CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      `)

      const afterCalls: { name: string; durationMs: number }[] = []
      const adapter = new SQLiteAdapter()

      const migrator = createMigrator(adapter, {
        migrationsDir:  dir,
        onAfterMigrate: (m) => { afterCalls.push({ name: m.name, durationMs: m.durationMs }) },
      })

      await migrator.run()

      expect(afterCalls).toHaveLength(1)
      expect(afterCalls[0]!.name).toBe('0001_create_users.sql')
      expect(afterCalls[0]!.durationMs).toBeGreaterThanOrEqual(0)
      expect(isFinite(afterCalls[0]!.durationMs)).toBe(true)
    } finally {
      await cleanDir(dir)
    }
  })

  test('onBeforeMigrate fires before onAfterMigrate — correct order', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, '0001_init.sql'), `
        CREATE TABLE test (id INTEGER PRIMARY KEY);
      `)

      const order: string[] = []
      const adapter = new SQLiteAdapter()

      const migrator = createMigrator(adapter, {
        migrationsDir:   dir,
        onBeforeMigrate: () => { order.push('before') },
        onAfterMigrate:  () => { order.push('after') },
      })

      await migrator.run()

      expect(order).toEqual(['before', 'after'])
    } finally {
      await cleanDir(dir)
    }
  })

  test('hooks called once per migration when multiple pending', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, '0001_create_users.sql'), `CREATE TABLE users (id INTEGER PRIMARY KEY);`)
      await writeFile(join(dir, '0002_create_posts.sql'), `CREATE TABLE posts (id INTEGER PRIMARY KEY);`)

      const beforeNames: string[] = []
      const afterNames:  string[] = []
      const adapter = new SQLiteAdapter()

      const migrator = createMigrator(adapter, {
        migrationsDir:   dir,
        onBeforeMigrate: (m) => { beforeNames.push(m.name) },
        onAfterMigrate:  (m) => { afterNames.push(m.name) },
      })

      await migrator.run()

      expect(beforeNames).toEqual(['0001_create_users.sql', '0002_create_posts.sql'])
      expect(afterNames).toEqual(['0001_create_users.sql', '0002_create_posts.sql'])
    } finally {
      await cleanDir(dir)
    }
  })

  test('onError called when migration SQL is invalid', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, '0001_bad.sql'), `THIS IS NOT VALID SQL;`)

      const errorCalls: { name: string; error: Error }[] = []
      const adapter = new SQLiteAdapter()

      const migrator = createMigrator(adapter, {
        migrationsDir: dir,
        onError:       (m) => { errorCalls.push({ name: m.name, error: m.error }) },
      })

      const results = await migrator.run()

      expect(results).toHaveLength(1)
      expect(results[0]!.success).toBe(false)
      expect(errorCalls).toHaveLength(1)
      expect(errorCalls[0]!.name).toBe('0001_bad.sql')
      expect(errorCalls[0]!.error).toBeInstanceOf(Error)
    } finally {
      await cleanDir(dir)
    }
  })

  test('onError not called on successful migration', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, '0001_ok.sql'), `CREATE TABLE ok (id INTEGER PRIMARY KEY);`)

      let errorCalled = false
      const adapter = new SQLiteAdapter()

      const migrator = createMigrator(adapter, {
        migrationsDir: dir,
        onError:       () => { errorCalled = true },
      })

      await migrator.run()

      expect(errorCalled).toBe(false)
    } finally {
      await cleanDir(dir)
    }
  })

  test('no hooks set — no error thrown', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, '0001_init.sql'), `CREATE TABLE items (id INTEGER PRIMARY KEY);`)
      const adapter = new SQLiteAdapter()

      const migrator = createMigrator(adapter, { migrationsDir: dir })
      const results = await migrator.run()

      expect(results).toHaveLength(1)
      expect(results[0]!.success).toBe(true)
    } finally {
      await cleanDir(dir)
    }
  })

  test('onAfterMigrate sql payload matches original migration SQL', async () => {
    const dir = await makeTempDir()
    try {
      const migrationSql = `CREATE TABLE check_table (id INTEGER PRIMARY KEY, val TEXT);`
      await writeFile(join(dir, '0001_check.sql'), migrationSql)

      let capturedSql = ''
      const adapter = new SQLiteAdapter()

      const migrator = createMigrator(adapter, {
        migrationsDir:  dir,
        onAfterMigrate: (m) => { capturedSql = m.sql },
      })

      await migrator.run()

      expect(capturedSql).toContain('CREATE TABLE check_table')
    } finally {
      await cleanDir(dir)
    }
  })
})
