/**
 * 05 — Soft Delete: full lifecycle
 *
 * Scenario: A user gets deactivated (soft-deleted), becomes invisible in normal
 * queries, can be inspected with .withDeleted(), and restored when needed.
 *
 * The soft-delete column (deletedAt) is set automatically — no manual timestamp.
 * Relations also respect soft delete: deleted users don't appear in joined queries.
 */

import { SQLiteAdapter } from 'oakbun/adapter/sqlite'
import { createDB, createTables, seed } from './_shared/seed'
import { usersTable, postsTable }       from './_shared/schema'

const adapter = new SQLiteAdapter()
const db      = createDB(adapter)

await createTables(adapter)
const { alice } = await seed(db)

// ── Baseline ──────────────────────────────────────────────────────────────────

const before = await db.from(usersTable).select()
console.log(`Before:  ${before.map(u => u.name).join(', ')}`)  // Alice, Bob, Charlie

// ── Soft delete ───────────────────────────────────────────────────────────────
// Sets deletedAt = NOW(). The row stays in the database.

await db.from(usersTable).softDelete().where({ id: alice.id }).execute()

const after = await db.from(usersTable).select()
console.log(`After:   ${after.map(u => u.name).join(', ')}`)   // Bob, Charlie

// ── withDeleted: opt-in to see all rows ──────────────────────────────────────

const all          = await db.from(usersTable).withDeleted().select()
const deletedAlice = all.find(u => u.id === alice.id)
console.log(`Alice deletedAt: ${deletedAlice?.deletedAt}`)  // a Date value

// ── Restore ───────────────────────────────────────────────────────────────────
// Sets deletedAt = NULL — the row reappears in normal queries.

await db.from(usersTable).restore().where({ id: alice.id }).execute()

const restored = await db.from(usersTable).select()
console.log(`Restored: ${restored.map(u => u.name).join(', ')}`)  // Alice, Bob, Charlie

// ── Soft delete in relations ──────────────────────────────────────────────────
// Delete Alice again, then load users with their posts.
// Alice won't appear in the users list, and her posts won't appear in post queries.

await db.from(usersTable).softDelete().where({ id: alice.id }).execute()

// Posts query automatically excludes posts whose author was soft-deleted?
// No — post.authorId is just a number; the posts table has its own soft delete.
// Alice's posts are still visible (they have their own deletedAt column).
const allPosts = await db.from(postsTable).select()
console.log(`Posts still visible after user soft-delete: ${allPosts.length}`)

// Soft-delete Alice's posts explicitly:
await db.from(postsTable).softDelete().where({ authorId: alice.id }).execute()

const visiblePosts = await db.from(postsTable).select()
console.log(`Posts after soft-deleting Alice's posts: ${visiblePosts.length}`)  // only Bob + Charlie

// withDeleted on posts — Alice's posts are still there
const allPostsIncDeleted = await db.from(postsTable).withDeleted().select()
console.log(`All posts (including deleted): ${allPostsIncDeleted.length}`)
