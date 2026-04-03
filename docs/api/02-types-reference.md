---
title: "Types Reference"
category: "api"
tags: ["types", "typescript", "inference", "generics"]
related: ["Ctx Reference", "defineTable", "defineModule"]
---

# Types Reference

All types exported from the `oakbun` package. Import as needed:

```ts
import type { InferRow, InferInsert, WhereInput } from 'oakbun'
```

---

## Table Inference

### InferRow\<T\>

Infers the full row type from a table definition. All non-nullable columns are required; nullable columns are `T | null`.

```ts
import { usersTable } from './schema'
type User = InferRow<typeof usersTable>
// { id: number; name: string; email: string; createdAt: Date }
```

### InferInsert\<T\>

Infers the insert type. Columns with defaults (e.g., auto-increment primary key, `defaultNow()`) become optional.

```ts
type NewUser = InferInsert<typeof usersTable>
// { name: string; email: string; createdAt?: Date }
```

### InferUpdate\<T\>

All columns become optional — used for partial update payloads.

```ts
type UserUpdate = InferUpdate<typeof usersTable>
// { id?: number; name?: string; email?: string; createdAt?: Date }
```

### InferTable\<T\>

Infers both row and insert types together.

```ts
type UserTable = InferTable<typeof usersTable>
// { row: User; insert: NewUser }
```

### InferTableEvents\<T\>

Infers the event payload types declared via `.emits()`.

```ts
type UserEvents = InferTableEvents<typeof usersTable>
```

---

## Schema Types

### SchemaMap

A map of column names to `ColumnDef` — the raw schema passed to `defineTable`.

```ts
type SchemaMap = Record<string, ColumnDef<SqlType>>
```

### ColumnDef\<T\>

Internal column descriptor. Use `column.*` builders instead of constructing directly.

### SqlType

Union of supported SQL column types:

```ts
type SqlType = 'text' | 'integer' | 'real' | 'boolean' | 'timestamp' | 'json' | 'blob'
```

### TableDef\<TRow, TSchema\>

The fully built table object returned by `.build()`.

---

## Audit Types

### AuditTableDef

The built audit table returned by `defineAuditTable(...).build()`.

### AuditConfig\<TRow\>

Configuration passed to `.audit()` on a module builder.

```ts
interface AuditConfig<TRow> {
  storeIn: AuditTableDef
  actor:   (ctx: BaseCtx) => string | null
  redact?: (keyof TRow & string)[]
}
```

### AuditLog

Row type of a built audit table.

```ts
interface AuditLog {
  id:        number
  tableName: string
  operation: 'insert' | 'update' | 'delete'
  actor:     string | null
  before:    string | null  // JSON string | null (null on insert)
  after:     string | null  // JSON string | null (null on delete)
  changedAt: Date
}
```

---

## Query Types

### WhereInput\<TRow\>

Flexible condition type accepted by `.where()`.

```ts
type WhereInput<TRow> =
  | Partial<TRow>
  | WhereConditions<TRow>
  | ((qb: WhereBuilder<TRow>) => WhereBuilder<TRow>)
```

### WhereOp

Comparison operators for field conditions.

```ts
type WhereOp = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'LIKE' | 'IN' | 'NOT IN' | 'IS NULL' | 'IS NOT NULL'
```

### FieldCondition\<T\>

A single field condition with an operator.

```ts
interface FieldCondition<T> {
  op:    WhereOp
  value: T | T[]
}
```

### SelectOptions\<TRow\>

Options for `.select()` — internal, typically not used directly.

### QueryLog / QueryLogEntry

Per-request query tracking. Available on `ctx._queryLog`.

```ts
interface QueryLog {
  queries:  number
  totalMs:  number
  entries:  QueryLogEntry[]
}

interface QueryLogEntry {
  sql:        string
  durationMs: number
}
```

---

## Application Types

### BaseCtx

Core context available in all handlers. See [Ctx Reference](./01-ctx-reference.md) for full field documentation.

```ts
interface BaseCtx {
  req:     Request
  params:  Record<string, string>
  query:   Record<string, string | string[]>
  body?:   unknown
  json:    <T>(data: T, status?: number) => Response
  text:    (data: string, status?: number) => Response
  html:    (data: string, status?: number) => Response
  stream:  (writer: (ctrl: StreamController) => void | Promise<void>, opts?: StreamOptions) => Response
  sse:     (writer: (ctrl: SseController) => void | Promise<void>) => Response
  cookie:  CookieJar
  emit:    <K extends keyof VelnEvents>(event: K, payload: VelnEvents[K]) => void
  logger?: Logger
  db?:     BoundVelnDB
  events?: EventBus
}
```

### Guard

A function that runs before a route handler. Return a `Response` to short-circuit; return `void` to continue.

```ts
type Guard = (ctx: BaseCtx) => Response | void | Promise<Response | void>
```

### RouteHandler

A route handler function.

```ts
type RouteHandler<TCtx = BaseCtx> = (ctx: TCtx) => Response | Promise<Response>
```

### RouteSchema

Schema definition attached to a route for validation and inference.

```ts
interface RouteSchema {
  body?:   ZodType
  query?:  ZodType
  params?: ZodType
}
```

### InferCtx\<TSchema\>

Infers the narrowed `ctx` type from a `RouteSchema`.

```ts
const schema = {
  body: z.object({ name: z.string() }),
}

type Ctx = InferCtx<typeof schema>
// ctx.body is { name: string }
```

### ErrorHandler

An error handler attached to a module or the app.

```ts
type ErrorHandler = (err: unknown, ctx: BaseCtx) => Response | Promise<Response>
```

### Logger

Minimal logging interface. Compatible with `console`, `pino`, and similar.

```ts
interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
  debug(msg: string, meta?: Record<string, unknown>): void
}
```

### AuthUser

Generic user shape for auth adapters.

```ts
interface AuthUser {
  id:    string
  email: string
  [key: string]: unknown
}
```

### AuthAdapter

Interface for plugging in custom authentication strategies.

```ts
interface AuthAdapter {
  verifyToken(token: string): Promise<AuthUser | null>
  createToken(user: AuthUser): Promise<string>
}
```

---

## Event Types

### EventBusAdapter

Interface for implementing a custom event bus (e.g., Redis Pub/Sub).

```ts
interface EventBusAdapter {
  on(event: string, handler: EventHandler): void
  emit(event: string, payload: unknown): Promise<void>
  off(event: string, handler: EventHandler): void
}
```

### EventHandler

```ts
type EventHandler = (payload: unknown) => void | Promise<void>
```

### EventHandlerDef

The built event handler definition returned by `defineEventHandler(...).build()`.

### VelnEvents

Merged global event registry. Extended by table `.emits()` declarations via module augmentation.

```ts
interface VelnEvents {
  [key: string]: unknown
}
```

---

## Module Types

### VelnModule

The fully built module object returned by `defineModule(...).build()`.

### HookDeclaration

Internal structure for module-level table hooks. Not typically used directly.

### ServiceDeclaration

Internal structure describing a registered service. Not typically used directly.

### ServiceDef\<T\>

The built service definition returned by `defineService(...).build()`.

---

## Cron Types

### CronDef

The fully built cron definition returned by `defineCron(...).build()`.

### CronCtx

Context available inside cron job handlers.

```ts
interface CronCtx {
  db:      BoundVelnDB
  logger?: Logger
  [key: string]: unknown   // injected services
}
```

### CronBuildOptions

```ts
interface CronBuildOptions {
  timezone?:   string
  runOnStart?: boolean
}
```

### CronLockAdapter

Interface for distributed cron locking. Implement to prevent duplicate runs in multi-instance deployments.

```ts
interface CronLockAdapter {
  acquire(jobName: string, ttlMs: number): Promise<boolean>
  release(jobName: string): Promise<void>
}
```

The default `NoOpCronLockAdapter` always returns `true` from `acquire` — suitable for single-instance apps.

---

## Adapter Types

### VelnAdapter

The database adapter interface. Implement to support a new database backend.

```ts
interface VelnAdapter {
  execute(sql: string, params?: BindingValue[]): Promise<ExecuteResult>
  query<T>(sql: string, params?: BindingValue[]): Promise<T[]>
  transaction<T>(fn: (tx: VelnAdapter) => Promise<T>): Promise<T>
  close(): Promise<void>
}
```

### BindingValue

```ts
type BindingValue = string | number | boolean | null | Uint8Array
```

### ExecuteResult

```ts
interface ExecuteResult {
  rowsAffected: number
  lastInsertId?: number | bigint
}
```

---

## Resource Types

### ResourceResult\<TRow\>

The complete resource object returned by `defineResource(...).build()`.

### ResourceOptions

Configuration for `defineResource`.

```ts
interface ResourceOptions {
  prefix?:   string
  paginate?: boolean | { defaultLimit: number; maxLimit: number }
  guards?:   Guard[]
}
```

---

## Error Classes

All error classes extend `VelnError` and map to HTTP status codes.

| Class | Status | Usage |
|---|---|---|
| `VelnError` | — | Base class; extend for custom errors |
| `BadRequestError` | 400 | Invalid input |
| `UnauthorizedError` | 401 | Missing/invalid credentials |
| `ForbiddenError` | 403 | Insufficient permissions |
| `UnprocessableError` | 422 | Validation failure |
| `TooManyRequestsError` | 429 | Rate limit exceeded |
| `InternalError` | 500 | Unexpected server error |

```ts
throw new UnauthorizedError('Token expired')
throw new UnprocessableError('Email already in use')
```

## See Also

- [Ctx Reference](./01-ctx-reference.md)
- [defineTable / column](../core/09-define-table.md)
- [defineModule](../core/02-define-module.md)
- [Cron Jobs](../guides/07-cron-jobs.md)
