import { column } from './column'
import { defineTable } from './table'
import type { SchemaMap, TableDef, InferRow, TableBuilder } from './table'

// ── Base audit fields — internal, never exported ────────────────────────────
// Users must not depend on this shape directly; they extend via defineAuditTable().

const _baseAuditFields = {
  id:        column.integer().primaryKey(),
  tableName: column.text(),
  operation: column.text(),           // 'insert' | 'update' | 'delete'
  actor:     column.text().nullable(),
  before:    column.text().nullable(), // JSON string | null (null on insert)
  after:     column.text().nullable(), // JSON string | null (null on delete)
  changedAt: column.timestamp().defaultFn(() => new Date()),
} as const

type BaseAuditSchema = typeof _baseAuditFields

// ── Public API ───────────────────────────────────────────────────────────────
// defineAuditTable() = defineTable() with base audit fields pre-merged.
// Users can add custom fields:
//   export const auditLogs = defineAuditTable('audit_logs', {
//     requestId: column.text().nullable(),
//   }).build()

export function defineAuditTable<S extends SchemaMap = Record<never, never>>(
  name: string,
  extraSchema?: S,
): TableBuilder<InferRow<BaseAuditSchema & S>, BaseAuditSchema & S> {
  const merged = { ..._baseAuditFields, ...(extraSchema ?? {}) } as BaseAuditSchema & S
  return defineTable(name, merged)
}

// AuditTableDef — base shape (no extra fields). Useful as a parameter type
// when a function accepts any audit table regardless of custom fields.
export type AuditTableDef<S extends SchemaMap = BaseAuditSchema> =
  TableDef<InferRow<BaseAuditSchema & S>, BaseAuditSchema & S>

// AuditLog — base row type (no extra fields). Extend via InferRow<typeof myAuditTable>
// for tables with custom fields.
export type AuditLog = InferRow<BaseAuditSchema>

// ── AuditConfig — passed to .audit() on ModuleBuilder ───────────────────────

export interface AuditConfig<TCtx, TRow, S extends SchemaMap = BaseAuditSchema> {
  /** The audit table to write into. */
  storeIn: AuditTableDef<S>
  /** Extract actor identifier from request context. Return null for anonymous. */
  actor: (ctx: TCtx) => string | null | undefined
  /** Field names to replace with '[REDACTED]' in before/after snapshots. */
  redact?: (keyof TRow & string)[]
}

// ── applyRedact — internal helper ───────────────────────────────────────────
// Replaces specified fields with '[REDACTED]' in a shallow clone.
// Never removes fields — '[REDACTED]' is distinguishable from absent/null.

export function applyRedact<T extends Record<string, unknown>>(
  row: T,
  fields: string[],
): T {
  if (fields.length === 0) return row
  const copy = { ...row } as Record<string, unknown>
  for (const f of fields) {
    if (f in copy) copy[f] = '[REDACTED]'
  }
  return copy as T
}
