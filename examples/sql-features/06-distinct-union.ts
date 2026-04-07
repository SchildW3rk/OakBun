/**
 * 06 — Distinct + Union
 *
 * Scenario: Find unique roles in the system, then build a privileged-user set
 * from two role groups using UNION (deduplicates) or UNION ALL (keeps dupes).
 *
 * Union as a subquery lets you use the combined set in a WHERE IN clause
 * without a separate round-trip.
 */

import { SQLiteAdapter } from 'oakbun/adapter/sqlite'
import { createDB, createTables, seed } from './_shared/seed'
import { usersTable, postsTable }       from './_shared/schema'

const adapter = new SQLiteAdapter()
const db      = createDB(adapter)

await createTables(adapter)
await seed(db)

// ── Distinct: unique roles across all users ───────────────────────────────────
// .columns('role', 'role') is multi-col form → SelectBuilder → .distinct() → .select()
// Single-col .columns('role') would return ColumnRestrictedBuilder (for subqueries only).

const roles = await db
  .from(usersTable)
  .distinct()
  .columns('role', 'id')   // pick two cols so we stay on SelectBuilder
  .select()

const uniqueRoles = [...new Set(roles.map(r => r.role))]
console.log(`Unique roles: ${uniqueRoles.join(', ')}`)  // admin, editor, member

// ── Distinct + where ──────────────────────────────────────────────────────────

const activeEditorRoles = await db
  .from(usersTable)
  .where({ active: true, role: 'editor' })
  .distinct()
  .select()

console.log(`Active editors: ${activeEditorRoles.map(u => u.name).join(', ')}`)

// ── Union: admin OR editor ids — deduplicates ─────────────────────────────────
// Each side uses .columns('id') → ColumnRestrictedBuilder → .union()

const privilegedIds = await db
  .from(usersTable).columns('id').where({ role: 'admin' })
  .union(
    db.from(usersTable).columns('id').where({ role: 'editor' }),
  )
  .select()

console.log(`Privileged user IDs: ${privilegedIds.map(r => r.id).join(', ')}`)

// ── Union with orderBy + limit ────────────────────────────────────────────────

const topTwo = await db
  .from(usersTable).columns('id').where({ role: 'admin' })
  .union(
    db.from(usersTable).columns('id').where({ role: 'editor' }),
  )
  .orderBy('id', 'ASC')
  .limit(2)
  .select()

console.log(`Top 2 privileged IDs: ${topTwo.map(r => r.id).join(', ')}`)

// ── Union as subquery in WHERE IN ─────────────────────────────────────────────
// No extra round-trip — the UNION becomes a subquery in the outer WHERE.

const privilegedIdsSub = db
  .from(usersTable).columns('id').where({ role: 'admin' })
  .union(
    db.from(usersTable).columns('id').where({ role: 'editor' }),
  )
  .subquery()

const privilegedPosts = await db
  .from(postsTable)
  .where({ authorId: { op: 'IN', value: privilegedIdsSub } })
  .select()

console.log(`Posts by admins/editors: ${privilegedPosts.length}`)

// ── UNION ALL: keeps duplicates ───────────────────────────────────────────────
// Useful when you need the full multiset (e.g. counting appearances per role).

const withDupes = await db
  .from(usersTable).columns('id').where({ role: 'admin' })
  .unionAll(
    db.from(usersTable).columns('id').where({ role: 'editor' }),
  )
  .select()

console.log(`UNION ALL row count (may include dupes): ${withDupes.length}`)
