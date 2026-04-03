import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineModule } from '../../packages/core/src/app/module'
import { dbPlugin, loggerPlugin } from '../../packages/core/src/app/plugin'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { defineAuditTable } from '../../packages/core/src/schema/audit'
import { column } from '../../packages/core/src/schema/column'

// ── Shared tables ────────────────────────────────────────────────────────────

const usersTable = defineTable('audit_users', {
  id:    column.integer().primaryKey(),
  name:  column.text(),
  email: column.text(),
}).build()

const auditLogs = defineAuditTable('audit_audit_logs').build()

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeApp(actor: string | null = 'u-1') {
  const adapter = new SQLiteAdapter()
  await adapter.execute(toCreateTableSql(usersTable))
  await adapter.execute(toCreateTableSql(auditLogs))

  const app = createApp().plugin(loggerPlugin())
  app.plugin(dbPlugin(adapter, app.hooks))

  return { app, adapter }
}

async function allAuditRows(adapter: SQLiteAdapter) {
  const rows = await adapter.query<Record<string, unknown>>('SELECT * FROM "audit_audit_logs"')
  return rows.map((r) => ({
    ...r,
    before: r['before'] ? JSON.parse(r['before'] as string) : null,
    after:  r['after']  ? JSON.parse(r['after']  as string) : null,
  }))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('.audit() — afterInsert writes audit row', () => {
  test('insert creates audit row with operation=insert', async () => {
    const { app, adapter } = await makeApp()

    const mod = defineModule('/users')
      .audit(usersTable, {
        storeIn: auditLogs,
        actor:   (_ctx) => 'u-1',
      })
      .post('/', async (ctx) => {
        const body = await ctx.req.json() as { name: string; email: string }
        const user = await ctx.db!.into(usersTable).insert(body)
        return ctx.json(user, 201)
      })
      .build()
    app.register(mod)

    const res = await app.fetch(new Request('http://localhost/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'alice@test.com' }),
    }))
    expect(res.status).toBe(201)

    // Wait for async audit write
    await new Promise((r) => setTimeout(r, 30))

    const rows = await allAuditRows(adapter)
    expect(rows.length).toBe(1)
    expect(rows[0]!.tableName).toBe('audit_users')
    expect(rows[0]!.operation).toBe('insert')
    expect(rows[0]!.actor).toBe('u-1')
    expect(rows[0]!.before).toBeNull()
    expect((rows[0]!.after as any).name).toBe('Alice')
  })
})

describe('.audit() — afterUpdate writes audit row with before/after', () => {
  test('update creates audit row with both before and after snapshots', async () => {
    const { app, adapter } = await makeApp()

    const mod = defineModule('/users')
      .audit(usersTable, {
        storeIn: auditLogs,
        actor:   (_ctx) => 'u-1',
      })
      .post('/', async (ctx) => {
        const body = await ctx.req.json() as { name: string; email: string }
        const user = await ctx.db!.into(usersTable).insert(body)
        await ctx.db!.from(usersTable).where({ id: user.id as any }).update({ name: 'Alice Updated' })
        return ctx.json({ ok: true })
      })
      .build()
    app.register(mod)

    await app.fetch(new Request('http://localhost/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'alice@test.com' }),
    }))

    await new Promise((r) => setTimeout(r, 30))

    const rows = await allAuditRows(adapter)
    const updateRow = rows.find((r) => r.operation === 'update')
    expect(updateRow).toBeDefined()
    expect((updateRow!.before as any).name).toBe('Alice')
    expect((updateRow!.after as any).name).toBe('Alice Updated')
  })
})

describe('.audit() — afterDelete writes audit row', () => {
  test('delete creates audit row with before snapshot and null after', async () => {
    const { app, adapter } = await makeApp()

    const mod = defineModule('/users')
      .audit(usersTable, {
        storeIn: auditLogs,
        actor:   (_ctx) => 'u-1',
      })
      .post('/', async (ctx) => {
        const user = await ctx.db!.into(usersTable).insert({ name: 'Bob', email: 'bob@test.com' })
        await ctx.db!.from(usersTable).where({ id: user.id as any }).delete()
        return ctx.json({ ok: true })
      })
      .build()
    app.register(mod)

    await app.fetch(new Request('http://localhost/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }))

    await new Promise((r) => setTimeout(r, 30))

    const rows = await allAuditRows(adapter)
    const deleteRow = rows.find((r) => r.operation === 'delete')
    expect(deleteRow).toBeDefined()
    expect((deleteRow!.before as any).name).toBe('Bob')
    expect(deleteRow!.after).toBeNull()
  })
})

describe('.audit() — redact', () => {
  test('redacted fields replaced with [REDACTED] in snapshots', async () => {
    const { app, adapter } = await makeApp()

    const mod = defineModule('/users')
      .audit(usersTable, {
        storeIn: auditLogs,
        actor:   (_ctx) => 'u-1',
        redact:  ['email'],
      })
      .post('/', async (ctx) => {
        const body = await ctx.req.json() as { name: string; email: string }
        const user = await ctx.db!.into(usersTable).insert(body)
        await ctx.db!.from(usersTable).where({ id: user.id as any }).update({ name: 'Alice 2' })
        return ctx.json({ ok: true })
      })
      .build()
    app.register(mod)

    await app.fetch(new Request('http://localhost/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'alice@secret.com' }),
    }))

    await new Promise((r) => setTimeout(r, 30))

    const rows = await allAuditRows(adapter)

    // Insert row: after.email should be redacted
    const insertRow = rows.find((r) => r.operation === 'insert')
    expect(insertRow).toBeDefined()
    expect((insertRow!.after as any).email).toBe('[REDACTED]')
    expect((insertRow!.after as any).name).toBe('Alice')

    // Update row: before.email and after.email both redacted
    const updateRow = rows.find((r) => r.operation === 'update')
    expect(updateRow).toBeDefined()
    expect((updateRow!.before as any).email).toBe('[REDACTED]')
    expect((updateRow!.after as any).email).toBe('[REDACTED]')
  })
})

describe('.audit() — actor', () => {
  test('null actor stored as null', async () => {
    const { app, adapter } = await makeApp()

    const mod = defineModule('/users')
      .audit(usersTable, {
        storeIn: auditLogs,
        actor:   (_ctx) => null,
      })
      .post('/', async (ctx) => {
        await ctx.db!.into(usersTable).insert({ name: 'Anon', email: 'anon@test.com' })
        return ctx.json({ ok: true })
      })
      .build()
    app.register(mod)

    await app.fetch(new Request('http://localhost/users', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }))

    await new Promise((r) => setTimeout(r, 30))

    const rows = await allAuditRows(adapter)
    expect(rows[0]!.actor).toBeNull()
  })
})

describe('.audit() — error isolation', () => {
  test('audit write failure does not propagate to handler', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))
    // intentionally NOT creating the audit_audit_logs table — writes will fail
    // no loggerPlugin here: the expected SQLiteError would be printed to stderr
    // and counted as an error by the test runner

    const app = createApp()
    app.plugin(dbPlugin(adapter, app.hooks))

    const mod = defineModule('/users')
      .audit(usersTable, {
        storeIn:  auditLogs,
        actor:    (_ctx) => 'u-1',
        onError:  () => {},  // silence expected SQLiteError — no stderr, no bun error count
      })
      .post('/', async (ctx) => {
        const body = await ctx.req.json() as { name: string; email: string }
        const user = await ctx.db!.into(usersTable).insert(body)
        return ctx.json(user, 201)
      })
      .build()
    app.register(mod)

    // Handler should still succeed even though audit write fails
    const res = await app.fetch(new Request('http://localhost/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'a@b.com' }),
    }))
    // The insert itself succeeds — handler returns 201
    expect(res.status).toBe(201)
  })
})

describe('.audit() — defineAuditTable with extra fields', () => {
  test('extra fields can be inserted via ctx.db', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))

    const extendedAudit = defineAuditTable('audit_extended', {
      requestId: column.text().nullable(),
    }).build()
    await adapter.execute(toCreateTableSql(extendedAudit))

    const app = createApp().plugin(loggerPlugin())
    app.plugin(dbPlugin(adapter, app.hooks))

    const mod = defineModule('/users')
      .audit(usersTable, {
        storeIn: extendedAudit,
        actor:   (_ctx) => 'u-ext',
      })
      .post('/', async (ctx) => {
        await ctx.db!.into(usersTable).insert({ name: 'Ext', email: 'ext@test.com' })
        return ctx.json({ ok: true })
      })
      .build()
    app.register(mod)

    await app.fetch(new Request('http://localhost/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }))

    await new Promise((r) => setTimeout(r, 30))

    const rows = await adapter.query<Record<string, unknown>>('SELECT * FROM "audit_extended"')
    expect(rows.length).toBe(1)
    expect(rows[0]!['actor']).toBe('u-ext')
    expect(rows[0]!['operation']).toBe('insert')
  })
})
