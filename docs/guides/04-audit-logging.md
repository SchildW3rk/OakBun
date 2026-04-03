---
title: "Audit Logging"
category: "guides"
tags: ["audit", "logging", "compliance", "history"]
related: ["defineTable", "defineModule", "Hooks & Events"]
---

# Audit Logging

OakBun's audit system records before/after snapshots of database rows for every write operation. Logs are stored in a dedicated audit table.

## Setup

### 1. Define the Audit Table

```ts
import { defineAuditTable } from 'oakbun'

export const auditLogs = defineAuditTable('audit_logs').build()
// Creates a table with: id, tableName, operation, actor, before, after, changedAt
```

With extra columns:

```ts
export const auditLogs = defineAuditTable('audit_logs', {
  ipAddress: column.text().nullable(),
  userAgent: column.text().nullable(),
}).build()
```

### 2. Create the Table in the Database

```sql
-- migrations/0002_audit.sql
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
  "tableName"  TEXT NOT NULL,
  "operation"  TEXT NOT NULL,
  "actor"      TEXT,
  "before"     TEXT,
  "after"      TEXT,
  "changedAt"  TIMESTAMP NOT NULL
);
```

### 3. Attach Audit to a Module

```ts
defineModule('/users')
  .plugin(jwtPlugin(process.env.JWT_SECRET!, { optional: true }))
  .audit(usersTable, {
    storeIn: auditLogs,
    actor:   (ctx) => ctx.jwtUser?.sub ?? null,
  })
  .build()
```

## AuditConfig

| Field | Type | Description |
|---|---|---|
| `storeIn` | `AuditTableDef` | The audit table to write to |
| `actor` | `(ctx) => string \| null` | Extract actor ID from context |
| `redact` | `(keyof TRow & string)[]` | Fields to redact in audit logs |

## Redacting Sensitive Fields

Sensitive data (passwords, tokens) should be redacted before storage:

```ts
.audit(usersTable, {
  storeIn: auditLogs,
  actor:   (ctx) => ctx.jwtUser?.sub ?? null,
  redact:  ['password', 'token', 'secret'],
})
```

Redacted fields are replaced with `'[REDACTED]'` in both `before` and `after` snapshots.

## AuditLog Type

```ts
interface AuditLog {
  id:         number
  tableName:  string
  operation:  'insert' | 'update' | 'delete'
  actor:      string | null
  before:     string | null  // JSON string | null (null on insert)
  after:      string | null  // JSON string | null (null on delete)
  changedAt:  Date
}
```

## Querying the Audit Log

```ts
.get('/audit', async (ctx) => {
  const logs = await ctx.db.from(auditLogs)
    .where({ tableName: 'users' })
    .orderBy('changedAt', 'DESC')
    .limit(100)
    .select()

  return ctx.json(logs.map((log) => ({
    ...log,
    before: log.before ? JSON.parse(log.before) : null,
    after:  log.after  ? JSON.parse(log.after)  : null,
  })))
})
```

## defineAuditTable Signature

```ts
function defineAuditTable<S extends SchemaMap>(
  name: string,
  extraSchema?: S,
): TableBuilder<InferRow<BaseAuditSchema & S>, BaseAuditSchema & S>
```

## See Also

- [defineTable / column](../core/09-define-table.md)
- [defineModule](../core/02-define-module.md)
- [Hooks & Events](./03-hooks-and-events.md)
