# OakBun — Design Specification v0.1

## Philosophy

- **No magic** — every behavior is explicit and traceable
- **Type inference over manual generics** — the user never writes `<User>` manually
- **Context is the only channel** — no global imports, everything injected
- **Bun-native** — no reinventing what Bun already does perfectly
- **Single external dependency** — Zod v4 for validation, everything else plain

---

## Layer Responsibilities

| Layer        | Knows HTTP? | Knows User? | Knows DB? | Can Block? |
|--------------|-------------|-------------|-----------|------------|
| Table Hook   | ❌           | ❌           | via tx    | ✅ before* |
| Module Hook  | ❌           | via ctx     | via ctx   | ✅ before* |
| Guard        | via ctx     | via ctx     | ❌         | ✅          |
| Plugin       | ✅           | —           | —         | ❌          |
| Handler      | ✅           | via ctx     | via ctx   | ❌          |
| Service      | ❌           | ❌           | injected  | ❌          |

---

## Core Primitives

### 1. OakBunAdapter (Database Interface)

Inspired by Go's `database/sql` — a single interface, multiple backends.

```
OakBunAdapter
  .query<T>(sql, params)     → T[]
  .execute(sql, params)      → { rowsAffected }
  .transaction(fn)           → T
  .close()                   → void

Implementations:
  SQLiteAdapter   → bun:sqlite  (default, zero config)
  PostgresAdapter → Bun.SQL     (production)
  MySQLAdapter    → Bun.SQL     (later)
```

### 2. Column DSL

Phantom-typed column definitions — TypeScript infers the row type, no codegen.

```typescript
const users = defineTable('users', {
  id:        column.integer().primaryKey(),
  name:      column.text(),
  email:     column.text().unique(),
  role:      column.text().default('user'),
  createdAt: column.timestamp().defaultFn(() => new Date()),
  deletedAt: column.timestamp().nullable(),
})

type User = InferRow<typeof users>
// → { id: number; name: string; email: string; role: string; createdAt: Date; deletedAt: Date | null }
```

### 3. Hook System

Array-based, deterministic, two levels. Mongoose-style single-hook overwriting is impossible by design.

**Execution order for every DB operation:**
```
1. Table-level beforeX hooks  (no ctx, always run — timestamps, soft-delete, defaults)
2. Module-level beforeX hooks (ctx-aware — auth, ownership, validation)
3. ← SQL executes via Adapter →
4. Table-level afterX hooks   (no ctx — search index, computed fields)
5. Module-level afterX hooks  (ctx-aware — audit, cache, event emission)
```

**Hook signatures by operation:**

| Hook           | Receives                     | Can Transform | Can Cancel |
|----------------|------------------------------|---------------|------------|
| beforeInsert   | data: Partial\<T\>           | ✅ data        | ✅ throw   |
| afterInsert    | result: T, input: Partial\<T\>| ❌             | ❌          |
| beforeUpdate   | current: T, patch: Partial\<T\>| ✅ patch      | ✅ throw   |
| afterUpdate    | result: T, before: T         | ❌             | ❌          |
| beforeDelete   | current: T                   | ❌             | ✅ throw   |
| afterDelete    | deleted: T                   | ❌             | ❌          |

### 4. Events (Fire & Forget)

Emitted from afterX hooks. Buffered during transactions, flushed only on commit.

```
afterInsert hook emits 'user.created'
      ↓
EventBuffer (per-request queue)
      ↓
TX commits? → flush → subscribers run async, errors logged not thrown
TX rolls back? → discard → subscribers never called
```

### 5. Audit

Built on top of Hook System. Automatic before/after snapshots. Never at the Handler level.

```
Module registers .audit(table, { actor: ctx => ctx.user?.id, redact: ['password'] })
      ↓
Framework wraps beforeUpdate/afterUpdate with snapshot diff
      ↓
Writes to audit_log table via same adapter (same TX = atomic)
```

### 6. Plugin System (Context Pipeline)

Each plugin is three phases: install (once), request (per-request ctx extension), teardown (once).

```
createApp()
  .plugin(logger())          → ctx & { logger: Logger }
  .plugin(postgres(config))  → ctx & { db: BoundOakBunDB }
  .plugin(auth())            → ctx & { user: User | null }
```

TypeScript infers each step. No manual generics. Error if you use `ctx.db` without `postgres()` plugin.

### 7. Guard

Pure predicate. Blocks or passes. Never extends ctx.

```typescript
type Guard<TCtx> = (ctx: TCtx) => Response | null | Promise<Response | null>
// null = pass, Response = block
```

### 8. Module

Self-contained unit. Owns its routes, plugins, guards, and hooks.

```
defineModule('/documents')
  .plugin(altDb(config))          // overrides ctx.db for this module only
  .guard(requireAuth())           // blocks unauthenticated
  .hook('beforeInsert', docs, ...) // module-level hook
  .audit(docs, { actor: ... })    // automatic audit
  .get('/:id', { ... })
  .post('/', { ... })
```

---

## Build Order

```
Phase 1 — Foundation (this session)
  ✅ OakBunAdapter interface
  ✅ SQLiteAdapter (bun:sqlite, fully tested)
  ✅ PostgresAdapter (Bun.SQL, stub — no external DB needed for tests)
  ✅ Column DSL (phantom types, full inference)
  ✅ defineTable (InferRow, InferInsert)
  ✅ HookExecutor (array-based, two levels, deterministic order)

Phase 2 — Query Layer
  → OakBunDB (wraps adapter + hooks)
  → QueryBuilder (.from, .where, .select, .first, .update, .delete)
  → InsertBuilder (.into, .insert)
  → SQL generation helpers
  → Transaction support with event buffering

Phase 3 — Application Layer
  → createApp + Plugin System (context chain, type inference)
  → defineModule + Guard
  → HTTP Layer (routes, Zod body/params/query, error cascade)
  → Event Bus (fire & forget, post-commit)
  → Audit (built on hooks)

Phase 4 — DX
  → RPC Client (type-safe, no codegen)
  → create-oakbun CLI
  → @oakbun/testing utilities
```

---

## Decisions Log

| Decision | Chosen | Reason |
|---|---|---|
| Validation | Zod v4 peer dep | Only external dep, best DX |
| Error handling | Cascade: route → module → global | Hierarchical, no surprises |
| Naming | Standalone (not @liteforge) | Different domain, own identity |
| Hook overwrite | Impossible — array-based | Mongoose trauma never again |
| Adapter style | Go database/sql interface | Swap backends without changing code |
| ALS usage | Only for observability (requestId, tracing) | Not for business data |
| Events in TX | Buffered, flush on commit | Atomic — email never fires on rollback |
| Module hooks | Live at the module (not app config) | Colocation, readable |
| Guard ctx extension | Forbidden — use Plugin instead | Single responsibility |