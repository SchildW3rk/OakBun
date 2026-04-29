import { describe, test, expect, beforeEach } from 'bun:test'
import { SQLiteAdapter } from '../../../packages/core/src/adapter/sqlite'
import { createOakBunDbAdapter } from '../src/adapter.js'
import { createAuthTables } from '../src/migrate.js'

function makeAdapter() {
  const oakbun = new SQLiteAdapter()
  const db = createOakBunDbAdapter(oakbun)({})
  return { oakbun, db }
}

type DBAdapter = ReturnType<ReturnType<typeof createOakBunDbAdapter>>

describe('createOakBunDbAdapter', () => {
  let oakbun: SQLiteAdapter
  let db: DBAdapter

  beforeEach(async () => {
    const inst = makeAdapter()
    oakbun = inst.oakbun
    db = inst.db
    await createAuthTables(oakbun)
  })

  // Helper: create a user without specifying id (factory generates it)
  async function createUser(email: string, name: string): Promise<Record<string, unknown>> {
    const now = new Date()
    // createAdapterFactory generates the id — we don't supply one
    return db.create<Record<string, unknown>>({
      model: 'user',
      data: {
        name,
        email,
        emailVerified: false,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
    })
  }

  test('create returns a user with generated id', async () => {
    const user = await createUser('alice@example.com', 'Alice')
    expect(user).toBeDefined()
    expect(user['id']).toBeTruthy()
    expect(user['email']).toBe('alice@example.com')
  })

  test('findOne by email returns user', async () => {
    await createUser('alice@example.com', 'Alice')

    const found = await db.findOne<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'email', value: 'alice@example.com' }],
    })
    expect(found).not.toBeNull()
    expect(found?.['email']).toBe('alice@example.com')
    expect(found?.['name']).toBe('Alice')
  })

  test('findOne returns null when not found', async () => {
    const found = await db.findOne({
      model: 'user',
      where: [{ field: 'email', value: 'nobody@example.com' }],
    })
    expect(found).toBeNull()
  })

  test('findMany with where filter', async () => {
    await createUser('a@x.com', 'Alice')
    await createUser('b@x.com', 'Bob')
    await createUser('c@x.com', 'Charlie')

    const users = await db.findMany<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'email', operator: 'ends_with', value: '@x.com' }],
      limit: 100,
    })
    expect(users.length).toBe(3)
  })

  test('findMany with limit and offset', async () => {
    await createUser('a@x.com', 'A')
    await createUser('b@x.com', 'B')
    await createUser('c@x.com', 'C')

    const page = await db.findMany<Record<string, unknown>>({
      model: 'user',
      limit: 2,
      offset: 1,
    })
    expect(page.length).toBe(2)
  })

  test('update returns updated user', async () => {
    const user = await createUser('orig@x.com', 'Original')
    const userId = user['id'] as string

    const updated = await db.update<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'id', value: userId }],
      update: { name: 'Updated' },
    })
    expect(updated?.['name']).toBe('Updated')
  })

  test('updateMany updates multiple rows', async () => {
    await createUser('um1@x.com', 'Old1')
    await createUser('um2@x.com', 'Old2')

    const count = await db.updateMany({
      model: 'user',
      where: [{ field: 'email', operator: 'ends_with', value: '@x.com' }],
      update: { name: 'Renamed' },
    })
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('delete removes row', async () => {
    const user = await createUser('del@x.com', 'DeleteMe')
    const userId = user['id'] as string

    await db.delete({ model: 'user', where: [{ field: 'id', value: userId }] })

    const found = await db.findOne({ model: 'user', where: [{ field: 'id', value: userId }] })
    expect(found).toBeNull()
  })

  test('deleteMany removes multiple rows and returns count', async () => {
    await createUser('dm1@del.com', 'D1')
    await createUser('dm2@del.com', 'D2')

    const count = await db.deleteMany({
      model: 'user',
      where: [{ field: 'email', operator: 'ends_with', value: '@del.com' }],
    })
    expect(count).toBe(2)
  })

  test('count returns correct number', async () => {
    await createUser('cnt1@cnt.com', 'C1')
    await createUser('cnt2@cnt.com', 'C2')

    const total = await db.count({
      model: 'user',
      where: [{ field: 'email', operator: 'ends_with', value: '@cnt.com' }],
    })
    expect(total).toBe(2)
  })

  test('count without where counts all rows', async () => {
    await createUser('all1@all.com', 'A1')
    await createUser('all2@all.com', 'A2')

    const total = await db.count({ model: 'user' })
    expect(total).toBeGreaterThanOrEqual(2)
  })

  test('boolean emailVerified: false stores as 0 in SQLite', async () => {
    // createAdapterFactory converts boolean → 0/1 before calling our adapter
    const user = await createUser('bool@test.com', 'BoolTest')
    const userId = user['id'] as string

    // Check raw SQLite storage
    const raw = await oakbun.query<Record<string, unknown>>(
      'SELECT "emailVerified" FROM "user" WHERE "id" = ?',
      [userId],
    )
    // Should be stored as 0 (integer) since supportsBooleans: false
    expect(raw[0]?.['emailVerified']).toBe(0)
  })

  test('Date stored as ISO string in SQLite', async () => {
    // createAdapterFactory converts Date → ISO string before calling our adapter
    const user = await createUser('date@test.com', 'DateTest')
    const userId = user['id'] as string

    const raw = await oakbun.query<Record<string, unknown>>(
      'SELECT "createdAt" FROM "user" WHERE "id" = ?',
      [userId],
    )
    // Should be stored as a string
    expect(typeof raw[0]?.['createdAt']).toBe('string')
  })
})
