import { describe, test, expect } from 'bun:test'
import { defineModel } from '../../packages/core/src/model/index'
import { defineService } from '../../packages/core/src/service/index'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { dbPlugin } from '../../packages/core/src/app/plugin'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { column } from '../../packages/core/src/schema/column'
import { z } from 'zod'

// ── Schema ─────────────────────────────────────────────────────────────────

const usersTable = defineTable('it_users', {
  id:    column.integer().primaryKey(),
  name:  column.text(),
  email: column.text(),
}).build()

// ── Model ──────────────────────────────────────────────────────────────────

const UserModel = defineModel('UserModel', usersTable, (db) => ({
  findByEmail: (email: string) =>
    db.from(usersTable).where({ email } as { email: string }).first(),
  findById: (id: number) =>
    db.from(usersTable).where({ id } as { id: number }).first(),
  findAll: () =>
    db.from(usersTable).select(),
}))

// ── Services ───────────────────────────────────────────────────────────────

const welcomeLog: string[] = []

const NotificationService = defineService('NotificationService')
  .use(UserModel)
  .define(({ UserModel }) => ({
    sendWelcome: async (userId: number): Promise<void> => {
      const user = await UserModel.findById(userId)
      if (user) welcomeLog.push(`welcome:${user.name}`)
    },
  }))

const UserService = defineService('users')
  .use(UserModel)
  .use(NotificationService)
  .define(({ UserModel, NotificationService }) => ({
    createUser: async (data: { name: string; email: string }) => {
      const exists = await UserModel.findByEmail(data.email)
      if (exists) {
        const err = new Error('Email already taken')
        ;(err as Error & { status?: number }).status = 409
        throw err
      }
      const user = await UserModel.db.into(usersTable).insert(data)
      await NotificationService.sendWelcome(user.id)
      return user
    },
    findAll: () => UserModel.findAll(),
  }))

// ── App factory ────────────────────────────────────────────────────────────

function makeApp() {
  const adapter = new SQLiteAdapter()

  const mod = defineModule('/api')
    .use(UserService)
    .route({
      method:  'POST',
      path:    '/users',
      summary: 'Create user',
      schema: {
        body:     z.object({ name: z.string().min(1), email: z.string().email() }),
        response: z.object({ id: z.number(), name: z.string() }),
      },
      handler: async (ctx) => {
        const user = await ctx.users.createUser(ctx.body)
        return ctx.json(user, 201)
      },
    })
    .get('/users', async (ctx) => {
      const users = await ctx.users.findAll()
      return ctx.json(users)
    })
    .onError((err, ctx) => {
      const e = err as Error & { status?: number }
      return ctx.json({ error: e.message }, e.status ?? 500)
    })
    .build()

  const app = createApp().plugin(dbPlugin(adapter))
  app.register(mod)
  return { app, adapter }
}

// ── Integration tests ──────────────────────────────────────────────────────

describe('Service integration — happy path', () => {
  test('full flow: POST /api/users → 201 + correct body', async () => {
    const { app, adapter } = makeApp()
    await adapter.execute(toCreateTableSql(usersTable))

    const res = await app.fetch(new Request('http://localhost/api/users', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: 'Alice', email: 'alice@integration.dev' }),
    }))

    expect(res.status).toBe(201)
    const body = await res.json() as { id: number; name: string }
    expect(body.name).toBe('Alice')
    expect(typeof body.id).toBe('number')
  })

  test('GET /api/users returns list after insert', async () => {
    const { app, adapter } = makeApp()
    await adapter.execute(toCreateTableSql(usersTable))

    await app.fetch(new Request('http://localhost/api/users', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: 'Bob', email: 'bob@integration.dev' }),
    }))

    const res = await app.fetch(new Request('http://localhost/api/users'))
    expect(res.status).toBe(200)
    const users = await res.json() as unknown[]
    expect(users.length).toBe(1)
  })

  test('service-in-service: UserService → NotificationService → UserModel', async () => {
    welcomeLog.length = 0
    const { app, adapter } = makeApp()
    await adapter.execute(toCreateTableSql(usersTable))

    await app.fetch(new Request('http://localhost/api/users', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: 'Carol', email: 'carol@integration.dev' }),
    }))

    expect(welcomeLog).toContain('welcome:Carol')
  })

  test('email already taken → 409 via onError', async () => {
    const { app, adapter } = makeApp()
    await adapter.execute(toCreateTableSql(usersTable))

    await app.fetch(new Request('http://localhost/api/users', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: 'Dave', email: 'dave@integration.dev' }),
    }))

    const dup = await app.fetch(new Request('http://localhost/api/users', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: 'Dave2', email: 'dave@integration.dev' }),
    }))

    expect(dup.status).toBe(409)
    const body = await dup.json() as { error: string }
    expect(body.error).toBe('Email already taken')
  })

  test('ctx.users.createUser() — typed end-to-end (no unknown in handler)', async () => {
    const { app, adapter } = makeApp()
    await adapter.execute(toCreateTableSql(usersTable))

    // If this compiles, ctx.users.createUser() is fully typed
    // @ts-expect-error — missing email proves ctx.users.createUser is typed (not unknown)
    const _bad: ReturnType<typeof UserService._factory> = null

    const res = await app.fetch(new Request('http://localhost/api/users', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: 'Eve', email: 'eve@integration.dev' }),
    }))
    expect(res.status).toBe(201)
  })
})

describe('Service integration — unhappy path', () => {
  test('invalid body (missing email) → 422', async () => {
    const { app, adapter } = makeApp()
    await adapter.execute(toCreateTableSql(usersTable))

    const res = await app.fetch(new Request('http://localhost/api/users', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: 'Frank' }),
    }))
    expect(res.status).toBe(422)
  })
})
