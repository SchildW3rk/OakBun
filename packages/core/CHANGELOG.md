# Changelog

## 0.4.0

### Minor Changes

- d266dfe: feat(schema): add `.name()` to column builder for camelCase ↔ snake_case mapping

  Use `.name('sql_column_name')` on any column to set an explicit SQL column name
  independent of the TypeScript property key. OakBun transparently maps between the
  two in INSERT, SELECT, UPDATE, DELETE, and WHERE conditions.

  ```ts
  export const usersTable = defineTable("users", {
    passwordHash: column.text().name("password_hash"),
    createdAt: column
      .timestamp()
      .name("created_at")
      .defaultFn(() => new Date()),
  }).build();

  // INSERT uses "password_hash", SELECT returns { passwordHash: '...' }
  // .where({ passwordHash: '...' }) → WHERE "password_hash" = ?
  ```

  Closes #6

## 0.3.0

### Minor Changes

- a9da1d2: feat(cli): pass `ctx` with `db` and `adapter` to custom command actions

  `defineCommand().action()` now receives a second argument `ctx: CommandContext`
  with a `BoundVelnDB` instance and the raw adapter, both resolved from `oak.config.ts`.

  ```ts
  export default defineCommand("seed")
    .description("Seed the database")
    .action(async (args, ctx) => {
      await ctx.db.into(usersTable).insert({ email: args.email });
    });
  ```

  Closes #2

## 0.2.2

### Patch Changes

- 3fd8bf4: fix(cli): load oak.config.ts instead of veln.config.ts, use config.adapter directly, and scan \*.db files

  - `loadConfig()` now checks `oak.config.ts` / `oak.config.js` first (veln.config.\* kept for backwards compat)
  - `loadAdapter()` uses `config.adapter` directly if provided in config
  - Glob extended from `*.sqlite` to `*.{sqlite,db}`
  - `VelnConfig` now has an `adapter` field

## 0.2.1

### Patch Changes

- 7d16807: fix(cli): remove duplicate shebang that caused syntax error when using `bunx oak` or `node_modules/.bin/oak`

## 0.2.0

### Minor Changes

- Add SQL features: eager loading, subquery DSL, soft delete, distinct/union, batch ops examples

  **New features:**

  - **Eager loading** — `.with({ author: true, comments: true })` on `SelectBuilder` loads relations in N+1 queries (1 per relation), fully typed via `WithRelations<T, ...>`
  - **Subquery DSL** — `.columns('id').subquery()` returns a `SubqueryResult<Col, T>` usable in `WHERE IN` / `NOT IN` conditions; `buildSubquery()` exported
  - **Soft delete** — `.withSoftDelete('deletedAt')` on `TableBuilder`; automatic `IS NULL` filter in all queries; `.softDelete()`, `.restore()`, `.withDeleted()` on `SelectBuilder`; soft-delete aware relation loading
  - **Distinct** — `.distinct()` on `SelectBuilder` emits `SELECT DISTINCT`
  - **Union** — `.union()` / `.unionAll()` on `ColumnRestrictedBuilder` returns `UnionBuilder<T>`; `.subquery()` on `UnionBuilder` for use in `WHERE IN`
  - **`HookExecutor` exported** from public index for standalone (non-HTTP) usage

  **Bug fixes:**

  - `loadRelation` / `loadRelationOne` name-based overloads: `TableDef<unknown>` → `TableDef<any>` — concrete tables with non-never `primaryKey` are now assignable
  - `generateMigration` / `compareSchemas`: same fix for `tables` / `target` params
  - `app.plugin()` return value must be captured to get the typed `ctx.db` — fixed in all `sql-features/src` examples

  **Examples:**

  Seven new standalone scripts in `examples/sql-features/` covering every feature with realistic scenarios and full console output.

## 0.1.1

### Patch Changes

- 45d5217: Fix d.ts generation and add error-handling callbacks

  - Split tsup config in sub-packages so `dist/index.d.ts` is emitted at the correct path (was `dist/pkg/src/index.d.ts` due to cross-package `paths` resolution)
  - Add `onError` callback to `EventBus`, `CronBuildOptions`, `AuditConfig` and `onInternalError` to `createApp` for silent error handling in tests
  - Add `logger: { disabled: true }` to Better Auth in auth-flow tests to suppress internal password error logging

All notable changes to this project will be documented in this file.
See [Changesets](https://github.com/changesets/changesets) for more information.
