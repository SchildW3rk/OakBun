import type { VelnAdapter } from '../adapter/types'
import type { SchemaMap } from '../schema/table'
import type { ModuleHookHandlers } from '../hooks/types'
import type { AuditDeclaration } from './module'
import { buildInsert } from '../db/sql'
import { applyRedact } from '../schema/audit'

// ── buildAuditHooks ───────────────────────────────────────────────────────────
// Called by app.register() for each AuditDeclaration.
// Returns ModuleHookHandlers that write directly to adapter — no ctx, no cast.
//
// actor: (ctx: TCtx) => string | null | undefined
// ctx is passed by HookExecutor at hook-call time — fully typed at the call site,
// safely typed as unknown here (this file doesn't need to know TCtx internals).
//
// Atomicity note: audit writes use the base adapter, not a TX adapter.
// This means audit rows survive even if the calling TX is rolled back.
// That is intentional: audit logs are an append-only record of attempted operations.
//
// Audit errors are caught and console.error'd — never thrown to the caller.

export function buildAuditHooks<T extends Record<string, unknown>, TCtx, S extends SchemaMap>(
  decl: AuditDeclaration<T, TCtx, S>,
  adapter: VelnAdapter,
): ModuleHookHandlers<T, unknown> {
  const { table, config } = decl
  const redactFields = (config.redact ?? []) as string[]
  const auditTable   = config.storeIn

  // before-snapshot: WeakMap keyed on the patch object.
  // Each .update() call gets a fresh patch object — the WeakMap entry is
  // GC'd when the patch goes out of scope. No global state, no leaks.
  const snapshots = new WeakMap<object, Record<string, unknown>>()

  async function writeAudit(
    operation: 'insert' | 'update' | 'delete',
    actor:     string | null,
    before:    Record<string, unknown> | null,
    after:     Record<string, unknown> | null,
  ): Promise<void> {
    const row: Record<string, unknown> = {
      tableName: table.name,
      operation,
      actor,
      before:    before !== null ? JSON.stringify(before) : null,
      after:     after  !== null ? JSON.stringify(after)  : null,
      changedAt: new Date().toISOString(),
    }
    const { sql, params } = buildInsert(auditTable.name, row)
    await adapter.execute(sql, params)
  }

  return {
    afterInsert: async (ctx, result) => {
      try {
        const after  = redactFields.length ? applyRedact(result as Record<string, unknown>, redactFields) : result as Record<string, unknown>
        const actor  = config.actor(ctx as TCtx) ?? null
        await writeAudit('insert', actor, null, after)
      } catch (err) {
        console.error('[audit] afterInsert failed:', err)
      }
    },

    beforeUpdate: async (_ctx, _current, patch) => {
      // Capture snapshot before the update.
      // patch is a unique object per .update() call — safe WeakMap key.
      if (patch !== null && typeof patch === 'object') {
        snapshots.set(patch, _current as Record<string, unknown>)
      }
    },

    afterUpdate: async (ctx, result, before) => {
      try {
        const beforeSnap = redactFields.length ? applyRedact(before as Record<string, unknown>, redactFields) : before as Record<string, unknown>
        const afterSnap  = redactFields.length ? applyRedact(result as Record<string, unknown>, redactFields) : result as Record<string, unknown>
        const actor      = config.actor(ctx as TCtx) ?? null
        await writeAudit('update', actor, beforeSnap, afterSnap)
      } catch (err) {
        console.error('[audit] afterUpdate failed:', err)
      }
    },

    afterDelete: async (ctx, deleted) => {
      try {
        const before = redactFields.length ? applyRedact(deleted as Record<string, unknown>, redactFields) : deleted as Record<string, unknown>
        const actor  = config.actor(ctx as TCtx) ?? null
        await writeAudit('delete', actor, before, null)
      } catch (err) {
        console.error('[audit] afterDelete failed:', err)
      }
    },
  }
}
