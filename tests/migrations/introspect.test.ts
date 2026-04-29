import { describe, test, expect } from 'bun:test'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { introspectSchema } from '../../packages/core/src/db/migrations/introspect'

describe('introspectSchema — SQLite', () => {
  test('returns empty map for empty DB', async () => {
    const adapter = new SQLiteAdapter()
    const schema  = await introspectSchema(adapter)
    expect(schema.size).toBe(0)
  })

  test('ignores internal tables (_oakbun_migrations, sqlite_sequence)', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(`
      CREATE TABLE "_oakbun_migrations" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL UNIQUE,
        "applied_at" TEXT NOT NULL
      )
    `)
    const schema = await introspectSchema(adapter)
    expect(schema.has('_oakbun_migrations')).toBe(false)
    expect(schema.size).toBe(0)
  })

  test('reads table columns correctly', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(`
      CREATE TABLE "users" (
        "id"    INTEGER PRIMARY KEY AUTOINCREMENT,
        "name"  TEXT NOT NULL,
        "email" TEXT NOT NULL UNIQUE
      )
    `)

    const schema = await introspectSchema(adapter)
    expect(schema.has('users')).toBe(true)

    const users = schema.get('users')!
    expect(users.columns).toHaveLength(3)

    const id = users.columns.find(c => c.name === 'id')!
    expect(id.primaryKey).toBe(true)
    expect(id.type).toBe('INTEGER')

    const name = users.columns.find(c => c.name === 'name')!
    expect(name.nullable).toBe(false)
    expect(name.type).toBe('TEXT')
  })

  test('reads multiple tables', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(`CREATE TABLE "users" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL)`)
    await adapter.execute(`CREATE TABLE "posts" ("id" INTEGER PRIMARY KEY, "title" TEXT NOT NULL, "user_id" INTEGER NOT NULL)`)

    const schema = await introspectSchema(adapter)
    expect(schema.has('users')).toBe(true)
    expect(schema.has('posts')).toBe(true)
  })

  test('maps column types correctly', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(`
      CREATE TABLE "typed" (
        "id"    INTEGER PRIMARY KEY,
        "label" TEXT NOT NULL,
        "score" REAL NOT NULL,
        "data"  BLOB
      )
    `)

    const schema = await introspectSchema(adapter)
    const typed  = schema.get('typed')!

    expect(typed.columns.find(c => c.name === 'id')!.type).toBe('INTEGER')
    expect(typed.columns.find(c => c.name === 'label')!.type).toBe('TEXT')
    expect(typed.columns.find(c => c.name === 'score')!.type).toBe('REAL')
    expect(typed.columns.find(c => c.name === 'data')!.type).toBe('BLOB')
  })

  test('nullable column is detected', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(`
      CREATE TABLE "nulls" (
        "id"       INTEGER PRIMARY KEY,
        "required" TEXT NOT NULL,
        "optional" TEXT
      )
    `)

    const schema = await introspectSchema(adapter)
    const nulls  = schema.get('nulls')!

    expect(nulls.columns.find(c => c.name === 'required')!.nullable).toBe(false)
    expect(nulls.columns.find(c => c.name === 'optional')!.nullable).toBe(true)
  })
})
