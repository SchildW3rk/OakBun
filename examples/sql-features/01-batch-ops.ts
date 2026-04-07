/**
 * 01 — Batch Operations: insertMany / updateMany
 *
 * Scenario: Bulk-import users from a list, then promote a subset of them.
 * insertMany fires one query regardless of row count.
 * updateMany wraps every update in a transaction — all succeed or all roll back.
 */

import { SQLiteAdapter } from 'oakbun/adapter/sqlite'
import { createDB, createTables, seed } from './_shared/seed'
import { usersTable }                   from './_shared/schema'
import type { User }                    from './_shared/schema'

const adapter = new SQLiteAdapter()
const db      = createDB(adapter)

await createTables(adapter)
await seed(db)

// ── insertMany: one round-trip for any number of rows ─────────────────────────

const newUsers = await db.into(usersTable).insertMany([
  { name: 'Dana',  email: 'dana@example.com',  role: 'member' },
  { name: 'Eve',   email: 'eve@example.com',   role: 'member' },
  { name: 'Frank', email: 'frank@example.com', role: 'member' },
])

// Return type is fully typed — no cast needed
const names: string[] = newUsers.map((u: User) => u.name)
console.log(`Inserted ${newUsers.length} users in 1 query: ${names.join(', ')}`)

// ── updateMany: transaction — all succeed or none do ─────────────────────────

const promoted = await db.from(usersTable).updateMany(
  newUsers.map((u: User) => ({ id: u.id, role: 'editor' as const })),
)

console.log(`Promoted to editor: ${promoted.map((u: User) => u.name).join(', ')}`)

const editors = await db.from(usersTable).where({ role: 'editor' }).select()
// Bob (seeded as editor) + Dana + Eve + Frank
console.log(`Total editors now: ${editors.length}`)

// ── updateMany rollback on unknown id ────────────────────────────────────────
// If any row is missing the entire transaction rolls back — no partial writes.

try {
  await db.from(usersTable).updateMany([
    { id: newUsers[0]!.id, role: 'admin' },
    { id: 999_999,          role: 'admin' },  // does not exist → throws
  ])
} catch {
  const dana = await db.from(usersTable).where({ id: newUsers[0]!.id }).first()
  console.log(`Dana's role after failed batch: ${dana?.role}`)  // still 'editor'
}
