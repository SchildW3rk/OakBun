import { describe, test, expect } from 'bun:test'
import { SQLiteAdapter }    from '../../packages/core/src/adapter/sqlite'
import { HookExecutor }     from '../../packages/core/src/hooks/executor'
import { VelnDB }           from '../../packages/core/src/db/index'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column }           from '../../packages/core/src/schema/column'
import { buildUnion }       from '../../packages/core/src/db/sql'

// ── Schema ──────────────────────────────────────────────────────────────────

const usersTable = defineTable('users', {
  id:        column.integer().primaryKey(),
  name:      column.text(),
  role:      column.text(),
  deletedAt: column.timestamp().nullable(),
})
  .withSoftDelete('deletedAt')
  .build()

const adminsTable = defineTable('admins', {
  id:   column.integer().primaryKey(),
  name: column.text(),
}).build()

// ── Helper ───────────────────────────────────────────────────────────────────

async function makeDB() {
  const adapter = new SQLiteAdapter()
  await adapter.execute(toCreateTableSql(usersTable))
  await adapter.execute(toCreateTableSql(adminsTable))

  // Users: Alice(1), Bob(2), Carol(3, deleted)
  await adapter.execute(`INSERT INTO "users" ("name", "role", "deletedAt") VALUES (?, ?, ?)`, ['Alice', 'user', null])
  await adapter.execute(`INSERT INTO "users" ("name", "role", "deletedAt") VALUES (?, ?, ?)`, ['Bob', 'mod', null])
  await adapter.execute(`INSERT INTO "users" ("name", "role", "deletedAt") VALUES (?, ?, ?)`, ['Carol', 'user', '2024-01-01T00:00:00.000Z'])

  // Admins: Dave(1), Eve(2)
  await adapter.execute(`INSERT INTO "admins" ("name") VALUES (?)`, ['Dave'])
  await adapter.execute(`INSERT INTO "admins" ("name") VALUES (?)`, ['Eve'])

  const hooks = new HookExecutor()
  return new VelnDB(adapter, hooks).withCtx({})
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildUnion — SQL generation', () => {
  test('combines two parts with UNION', () => {
    const { sql } = buildUnion(
      [
        { sql: 'SELECT "id" FROM "users"', params: [] },
        { sql: 'SELECT "id" FROM "admins"', params: [] },
      ],
      'UNION',
    )
    expect(sql).toBe('SELECT "id" FROM "users" UNION SELECT "id" FROM "admins"')
  })

  test('combines two parts with UNION ALL', () => {
    const { sql } = buildUnion(
      [
        { sql: 'SELECT "id" FROM "users"', params: [] },
        { sql: 'SELECT "id" FROM "admins"', params: [] },
      ],
      'UNION ALL',
    )
    expect(sql).toBe('SELECT "id" FROM "users" UNION ALL SELECT "id" FROM "admins"')
  })

  test('merges params in order: left first, right second', () => {
    const { params } = buildUnion(
      [
        { sql: 'SELECT "id" FROM "users" WHERE "active" = ?', params: [true] },
        { sql: 'SELECT "id" FROM "admins" WHERE "active" = ?', params: [false] },
      ],
      'UNION',
    )
    expect(params).toEqual([true, false])
  })

  test('appends ORDER BY when provided', () => {
    const { sql } = buildUnion(
      [
        { sql: 'SELECT "id" FROM "a"', params: [] },
        { sql: 'SELECT "id" FROM "b"', params: [] },
      ],
      'UNION',
      { orderBy: { col: 'id', dir: 'ASC' } },
    )
    expect(sql).toContain('ORDER BY "id" ASC')
  })

  test('appends LIMIT when provided', () => {
    const { sql } = buildUnion(
      [
        { sql: 'SELECT "id" FROM "a"', params: [] },
        { sql: 'SELECT "id" FROM "b"', params: [] },
      ],
      'UNION',
      { limit: 10 },
    )
    expect(sql).toContain('LIMIT 10')
  })

  test('three parts', () => {
    const { sql } = buildUnion(
      [
        { sql: 'SELECT "id" FROM "a"', params: [] },
        { sql: 'SELECT "id" FROM "b"', params: [] },
        { sql: 'SELECT "id" FROM "c"', params: [] },
      ],
      'UNION',
    )
    expect(sql).toBe('SELECT "id" FROM "a" UNION SELECT "id" FROM "b" UNION SELECT "id" FROM "c"')
  })

  test('throws when fewer than 2 parts', () => {
    expect(() =>
      buildUnion([{ sql: 'SELECT 1', params: [] }], 'UNION'),
    ).toThrow('buildUnion: at least 2 parts required')
  })
})

describe('ColumnRestrictedBuilder — .union() / .unionAll()', () => {
  test('.union() SQL contains UNION keyword', async () => {
    const db = await makeDB()
    const union = db.from(usersTable).withDeleted().columns('id')
      .union(db.from(adminsTable).columns('id'))
    const sub = union.subquery()
    expect(sub._sql).toContain('UNION')
    expect(sub._sql).not.toContain('UNION ALL')
  })

  test('.unionAll() SQL contains UNION ALL', async () => {
    const db = await makeDB()
    const union = db.from(usersTable).withDeleted().columns('id')
      .unionAll(db.from(adminsTable).columns('id'))
    const sub = union.subquery()
    expect(sub._sql).toContain('UNION ALL')
  })

  test('.union() subquery() wraps in parentheses', async () => {
    const db = await makeDB()
    const sub = db.from(usersTable).withDeleted().columns('id')
      .union(db.from(adminsTable).columns('id'))
      .subquery()
    expect(sub._sql.startsWith('(')).toBe(true)
    expect(sub._sql.endsWith(')')).toBe(true)
  })

  test('.union() with .where() on both sides', async () => {
    const db = await makeDB()
    const sub = db.from(usersTable).withDeleted().columns('id').where({ role: 'user' })
      .union(db.from(adminsTable).columns('id'))
      .subquery()
    expect(sub._sql).toContain('WHERE')
    expect(sub._sql).toContain('UNION')
  })

  test('soft delete filter applies to left side', async () => {
    const db = await makeDB()
    const sub = db.from(usersTable).columns('id')
      .union(db.from(adminsTable).columns('id'))
      .subquery()
    // Left side (users) has soft delete → IS NULL filter
    expect(sub._sql).toContain('"deletedAt" IS NULL')
    // Right side (admins) has no soft delete → no IS NULL
    const rightSide = sub._sql.split('UNION')[1]
    expect(rightSide).not.toContain('IS NULL')
  })

  test('three-way union via chaining', async () => {
    const db = await makeDB()
    const threeTable = defineTable('extra', {
      id: column.integer().primaryKey(),
    }).build()

    const sub = db.from(usersTable).withDeleted().columns('id')
      .union(db.from(adminsTable).columns('id'))
      .union(db.from(usersTable).withDeleted().columns('id'))
      .subquery()

    const unionCount = (sub._sql.match(/UNION/g) ?? []).length
    expect(unionCount).toBe(2)
  })

  describe('end-to-end select()', () => {
    test('.union().select() returns combined distinct rows', async () => {
      const db = await makeDB()
      // users ids: 1,2 (Carol soft-deleted); admins ids: 1,2
      // UNION deduplicates → {id:1}, {id:2}
      const rows = await db.from(usersTable).columns('id')
        .union(db.from(adminsTable).columns('id'))
        .select()
      expect(rows).toHaveLength(2)
    })

    test('.unionAll().select() keeps duplicates', async () => {
      const db = await makeDB()
      // users: 2 rows (not deleted); admins: 2 rows → 4 total
      const rows = await db.from(usersTable).columns('id')
        .unionAll(db.from(adminsTable).columns('id'))
        .select()
      expect(rows).toHaveLength(4)
    })

    test('.union().limit().select() applies limit', async () => {
      const db = await makeDB()
      const rows = await db.from(usersTable).withDeleted().columns('id')
        .union(db.from(adminsTable).columns('id'))
        .limit(1)
        .select()
      expect(rows).toHaveLength(1)
    })

    test('.union().orderBy().select() applies order', async () => {
      const db = await makeDB()
      // names from users and admins
      const rows = await db.from(usersTable).withDeleted().columns('name')
        .union(db.from(adminsTable).columns('name'))
        .orderBy('name', 'ASC')
        .select()
      const names = rows.map((r) => r['name'] as string)
      expect(names).toEqual([...names].sort())
    })
  })

  describe('union as subquery in WHERE IN', () => {
    test('.union().subquery() usable in WHERE IN', async () => {
      const db = await makeDB()
      // Get posts by user id=1 OR admin id=1 (same value here)
      const allIds = db.from(usersTable).columns('id').where({ role: 'user' })
        .union(db.from(adminsTable).columns('id'))
        .subquery()

      // Use in another query
      const users = await db.from(usersTable).withDeleted()
        .where({ id: { op: 'IN', value: allIds } })
        .select()
      // id=1 (Alice, user) and id=2 (Bob, not role user) — admins provide id=1,2 → all non-deleted users
      expect(users.length).toBeGreaterThan(0)
    })
  })
})
