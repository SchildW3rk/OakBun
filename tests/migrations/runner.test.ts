import { describe, test, expect, beforeEach } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { createMigrator, splitSqlStatements } from '../../packages/core/src/db/migrations/index'

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'veln-migrations-'))
}

async function cleanDir(dir: string) {
  await rm(dir, { recursive: true, force: true })
}

describe('splitSqlStatements', () => {
  test('splits on semicolons', () => {
    const sql = 'CREATE TABLE foo (id INTEGER); INSERT INTO foo VALUES (1)'
    expect(splitSqlStatements(sql)).toEqual([
      'CREATE TABLE foo (id INTEGER)',
      'INSERT INTO foo VALUES (1)',
    ])
  })

  test('ignores semicolons inside strings', () => {
    const sql = `INSERT INTO foo (name) VALUES ('hello; world'); INSERT INTO foo (name) VALUES ('test')`
    const stmts = splitSqlStatements(sql)
    expect(stmts).toHaveLength(2)
    expect(stmts[0]).toContain("'hello; world'")
  })

  test('handles single-line comments', () => {
    const sql = '-- comment\nCREATE TABLE foo (id INTEGER);'
    const stmts = splitSqlStatements(sql)
    expect(stmts).toHaveLength(1)
    expect(stmts[0]).toContain('CREATE TABLE foo')
  })

  test('returns empty array for blank input', () => {
    expect(splitSqlStatements('   ')).toEqual([])
    expect(splitSqlStatements('')).toEqual([])
  })

  test('handles trailing content without semicolon', () => {
    const stmts = splitSqlStatements('SELECT 1')
    expect(stmts).toEqual(['SELECT 1'])
  })
})

describe('createMigrator — run()', () => {
  test('run() on empty DB applies all migrations', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, '0001_initial.sql'), `
        CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      `)
      await writeFile(join(dir, '0002_add_email.sql'), `
        ALTER TABLE users ADD COLUMN email TEXT;
      `)

      const adapter  = new SQLiteAdapter()
      const migrator = createMigrator(adapter, { migrationsDir: dir })
      const results  = await migrator.run()

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[0].name).toBe('0001_initial.sql')
      expect(results[1].success).toBe(true)
      expect(results[1].name).toBe('0002_add_email.sql')
    } finally {
      await cleanDir(dir)
    }
  })

  test('run() is idempotent — second run applies 0 migrations', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, '0001_initial.sql'), `
        CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
      `)

      const adapter  = new SQLiteAdapter()
      const migrator = createMigrator(adapter, { migrationsDir: dir })

      const first  = await migrator.run()
      const second = await migrator.run()

      expect(first).toHaveLength(1)
      expect(first[0].success).toBe(true)
      expect(second).toHaveLength(0)
    } finally {
      await cleanDir(dir)
    }
  })

  test('run() stops on first error and does not apply subsequent migrations', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, '0001_bad.sql'), `THIS IS NOT VALID SQL !!!`)
      await writeFile(join(dir, '0002_good.sql'), `CREATE TABLE ok (id INTEGER PRIMARY KEY);`)

      const adapter  = new SQLiteAdapter()
      const migrator = createMigrator(adapter, { migrationsDir: dir })
      const results  = await migrator.run()

      expect(results).toHaveLength(1)
      expect(results[0].success).toBe(false)
      expect(results[0].error).toBeDefined()

      // 0002 was not applied
      const rows = await adapter.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='ok'`)
      expect(rows).toHaveLength(0)
    } finally {
      await cleanDir(dir)
    }
  })

  test('run() with empty migrations dir returns empty results', async () => {
    const dir = await makeTempDir()
    try {
      const adapter  = new SQLiteAdapter()
      const migrator = createMigrator(adapter, { migrationsDir: dir })
      const results  = await migrator.run()
      expect(results).toHaveLength(0)
    } finally {
      await cleanDir(dir)
    }
  })

  test('run() with non-existent dir returns empty results', async () => {
    const adapter  = new SQLiteAdapter()
    const migrator = createMigrator(adapter, { migrationsDir: '/tmp/veln-nonexistent-12345' })
    const results  = await migrator.run()
    expect(results).toHaveLength(0)
  })

  test('custom tableName is used for tracking', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, '0001_initial.sql'), `CREATE TABLE things (id INTEGER PRIMARY KEY);`)

      const adapter  = new SQLiteAdapter()
      const migrator = createMigrator(adapter, { migrationsDir: dir, tableName: 'custom_migrations' })
      await migrator.run()

      const rows = await adapter.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='custom_migrations'`)
      expect(rows).toHaveLength(1)
    } finally {
      await cleanDir(dir)
    }
  })
})

describe('createMigrator — status()', () => {
  test('status() returns pending/applied correctly', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, '0001_initial.sql'), `CREATE TABLE a (id INTEGER PRIMARY KEY);`)
      await writeFile(join(dir, '0002_second.sql'),  `CREATE TABLE b (id INTEGER PRIMARY KEY);`)

      const adapter  = new SQLiteAdapter()
      const migrator = createMigrator(adapter, { migrationsDir: dir })

      // Before run
      const before = await migrator.status()
      expect(before.every(s => s.status === 'pending')).toBe(true)

      // Run first only
      await adapter.execute(`CREATE TABLE IF NOT EXISTS "_veln_migrations" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL UNIQUE, "applied_at" TEXT NOT NULL)`)
      await adapter.execute(`CREATE TABLE a (id INTEGER PRIMARY KEY)`)
      await adapter.execute(`INSERT INTO "_veln_migrations" ("name", "applied_at") VALUES ('0001_initial.sql', ?)`, [new Date().toISOString()])

      const after = await migrator.status()
      expect(after[0].status).toBe('applied')
      expect(after[0].appliedAt).toBeInstanceOf(Date)
      expect(after[1].status).toBe('pending')
    } finally {
      await cleanDir(dir)
    }
  })
})

describe('createMigrator — rollback()', () => {
  test('rollback() removes last applied migration from tracking', async () => {
    const dir = await makeTempDir()
    try {
      await writeFile(join(dir, '0001_initial.sql'), `CREATE TABLE rolltest (id INTEGER PRIMARY KEY);`)

      const adapter  = new SQLiteAdapter()
      const migrator = createMigrator(adapter, { migrationsDir: dir })

      await migrator.run()

      const before = await migrator.status()
      expect(before[0].status).toBe('applied')

      await migrator.rollback()

      const after = await migrator.status()
      expect(after[0].status).toBe('pending')
    } finally {
      await cleanDir(dir)
    }
  })

  test('rollback() on empty history is a no-op', async () => {
    const dir = await makeTempDir()
    try {
      const adapter  = new SQLiteAdapter()
      const migrator = createMigrator(adapter, { migrationsDir: dir })
      await expect(migrator.rollback()).resolves.toBeUndefined()
    } finally {
      await cleanDir(dir)
    }
  })
})
