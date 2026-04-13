---
"oakbun": minor
---

feat(schema): add `.name()` to column builder for camelCase ↔ snake_case mapping

Use `.name('sql_column_name')` on any column to set an explicit SQL column name
independent of the TypeScript property key. OakBun transparently maps between the
two in INSERT, SELECT, UPDATE, DELETE, and WHERE conditions.

```ts
export const usersTable = defineTable('users', {
  passwordHash: column.text().name('password_hash'),
  createdAt:    column.timestamp().name('created_at').defaultFn(() => new Date()),
}).build()

// INSERT uses "password_hash", SELECT returns { passwordHash: '...' }
// .where({ passwordHash: '...' }) → WHERE "password_hash" = ?
```

Closes #6
