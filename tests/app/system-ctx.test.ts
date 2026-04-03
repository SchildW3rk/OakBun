import { describe, test, expect } from 'bun:test'
import { createSystemCtx } from '../../packages/core/src/app/system-ctx'
import { VelnDB } from '../../packages/core/src/db/index'
import { HookExecutor } from '../../packages/core/src/hooks/executor'
import { SQLiteAdapter } from '../../packages/core/src/adapter/sqlite'
import { defineTable, toCreateTableSql } from '../../packages/core/src/schema/table'
import { defineAuditTable } from '../../packages/core/src/schema/audit'
import { buildAuditHooks } from '../../packages/core/src/app/audit-wiring'
import { column } from '../../packages/core/src/schema/column'
import type { BaseCtx } from '../../packages/core/src/app/types'

// ── Shared schema ─────────────────────────────────────────────────────────────

const usersTable = defineTable('sc_users', {
  id:    column.integer().primaryKey(),
  name:  column.text(),
  email: column.text(),
}).build()

const auditLogs = defineAuditTable('sc_audit').build()

// ── Happy path ────────────────────────────────────────────────────────────────

describe('createSystemCtx — happy path', () => {
  test('returns a valid BaseCtx without extra', () => {
    const ctx = createSystemCtx()
    // All BaseCtx fields present
    expect(ctx.req).toBeInstanceOf(Request)
    expect(ctx.params).toEqual({})
    expect(ctx.query).toEqual({})
    expect(typeof ctx.json).toBe('function')
    expect(typeof ctx.text).toBe('function')
    expect(typeof ctx.html).toBe('function')
  })

  test('ctx.req.url is the sentinel URL — no crash', () => {
    const ctx = createSystemCtx()
    expect(ctx.req.url).toBe('http://system.local/background')
  })

  test('ctx.json() returns correct Response', async () => {
    const ctx = createSystemCtx()
    const res = ctx.json({ ok: true }, 201)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(res.headers.get('Content-Type')).toContain('application/json')
  })

  test('ctx.text() returns correct Response', async () => {
    const ctx = createSystemCtx()
    const res = ctx.text('hello', 200)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello')
  })

  test('ctx.html() returns correct Response with Content-Type', async () => {
    const ctx = createSystemCtx()
    const res = ctx.html('<h1>hi</h1>', 200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
  })

  test('createSystemCtx({ user }) merges extra fields', () => {
    const ctx = createSystemCtx({ user: { id: 'system', role: 'admin' } })
    expect(ctx.user.id).toBe('system')
    expect(ctx.user.role).toBe('admin')
    // BaseCtx fields still present
    expect(ctx.req).toBeInstanceOf(Request)
  })

  test('type: createSystemCtx() satisfies BaseCtx', () => {
    const ctx: BaseCtx = createSystemCtx()
    expect(ctx).toBeDefined()
  })

  test('db.withCtx(systemCtx) works — no error', () => {
    const adapter = new SQLiteAdapter()
    const hooks   = new HookExecutor()
    const db      = new VelnDB(adapter, hooks)
    const ctx     = createSystemCtx({ user: { id: 'system', role: 'admin' } })
    const bound   = db.withCtx(ctx)
    expect(bound).toBeDefined()
  })

  test('insert via systemCtx — hook receives ctx.user.id', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))

    const hooks = new HookExecutor()
    let capturedUserId: string | undefined

    hooks.registerModuleHook(usersTable.name, {
      afterInsert: async (ctx, _result) => {
        const c = ctx as { user?: { id: string } }
        capturedUserId = c.user?.id
      },
    })

    const db    = new VelnDB(adapter, hooks)
    const ctx   = createSystemCtx({ user: { id: 'system', role: 'admin' } })
    const bound = db.withCtx(ctx)

    await bound.into(usersTable).insert({ name: 'System User', email: 'sys@veln.dev' })

    expect(capturedUserId).toBe('system')
  })

  test('audit hook writes actor: "system" via systemCtx', async () => {
    const adapter = new SQLiteAdapter()
    await adapter.execute(toCreateTableSql(usersTable))
    await adapter.execute(toCreateTableSql(auditLogs))

    const hooks = new HookExecutor()

    // Wire audit hooks the same way app.register() does
    const auditDecl = {
      table:  usersTable,
      config: {
        storeIn: auditLogs,
        actor:   (ctx: { user?: { id: string } }) => ctx.user?.id ?? null,
      },
    }
    const auditHandlers = buildAuditHooks(auditDecl, adapter)
    hooks.registerModuleHook(usersTable.name, auditHandlers)

    const db    = new VelnDB(adapter, hooks)
    const ctx   = createSystemCtx({ user: { id: 'system', role: 'admin' } })
    const bound = db.withCtx(ctx)

    await bound.into(usersTable).insert({ name: 'System User', email: 'sys@veln.dev' })

    const rows = await adapter.query<Record<string, unknown>>('SELECT * FROM "sc_audit"')
    expect(rows.length).toBe(1)
    expect(rows[0]!['actor']).toBe('system')
    expect(rows[0]!['operation']).toBe('insert')
    expect(rows[0]!['tableName']).toBe('sc_users')
  })
})

// ── Unhappy path ──────────────────────────────────────────────────────────────

describe('createSystemCtx — unhappy path', () => {
  test('ctx.req.url is readable — no crash even if hook reads it', () => {
    const ctx = createSystemCtx()
    // simulate a hook reading ctx.req.url
    expect(() => ctx.req.url).not.toThrow()
    expect(ctx.req.url).toBe('http://system.local/background')
  })

  test('ctx without dbPlugin has no ctx.db — no crash, just undefined', () => {
    const ctx = createSystemCtx()
    // db is optional on BaseCtx — absent means no dbPlugin
    expect(ctx.db).toBeUndefined()
  })

  test('withCtx() works with systemCtx — BoundVelnDB created successfully', () => {
    const adapter = new SQLiteAdapter()
    const hooks   = new HookExecutor()
    const db      = new VelnDB(adapter, hooks)
    const ctx     = createSystemCtx()
    // No throw — withCtx accepts unknown, systemCtx satisfies it
    expect(() => db.withCtx(ctx)).not.toThrow()
  })
})
