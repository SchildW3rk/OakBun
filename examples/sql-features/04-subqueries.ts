/**
 * 04 — Subquery DSL: .columns(col).subquery() in WHERE IN / NOT IN
 *
 * Scenario: Find posts written by active users using a correlated subquery.
 * The subquery is built lazily — no query runs until it's used in a WHERE clause.
 * The outer query executes as one round-trip: SELECT ... WHERE authorId IN (SELECT id ...).
 */

import { SQLiteAdapter } from 'oakbun/adapter/sqlite'
import { createDB, createTables, seed } from './_shared/seed'
import { usersTable, postsTable }       from './_shared/schema'
import type { SubqueryResult }          from 'oakbun'

const adapter = new SQLiteAdapter()
const db      = createDB(adapter)

await createTables(adapter)
const { alice } = await seed(db)

// ── Subquery: ids of all active users ─────────────────────────────────────────
// .columns('id') → ColumnRestrictedBuilder
// .subquery()    → SubqueryResult<'id', number> — no query runs here

const activeUserIds: SubqueryResult<'id', number> = db
  .from(usersTable)
  .where({ active: true })
  .columns('id')
  .subquery()

// ── IN subquery: posts by active users — single round-trip ───────────────────

const activePosts = await db
  .from(postsTable)
  .where({ authorId: { op: 'IN', value: activeUserIds } })
  .select()

console.log(`Posts by active users: ${activePosts.length}`)  // 4 (all seeded posts)

// ── NOT IN: exclude a specific user's posts ───────────────────────────────────
// Deactivate Alice so her posts are excluded via NOT IN.

await db.from(usersTable).where({ id: alice.id }).update({ active: false })

const inactiveUserIds: SubqueryResult<'id', number> = db
  .from(usersTable)
  .where({ active: false })
  .columns('id')
  .subquery()

const nonInactivePosts = await db
  .from(postsTable)
  .where({ authorId: { op: 'NOT IN', value: inactiveUserIds } })
  .select()

// Alice had 2 posts — NOT IN excludes them; Bob + Charlie = 2 posts remain
console.log(`Posts excluding inactive authors: ${nonInactivePosts.length}`)

// ── Subquery combined with .with() ────────────────────────────────────────────
// Subqueries compose naturally with eager loading — only matching rows get
// their relations fetched.

const activeIds: SubqueryResult<'id', number> = db
  .from(usersTable)
  .where({ active: true })
  .columns('id')
  .subquery()

const postsWithAuthors = await db
  .from(postsTable)
  .where({ authorId: { op: 'IN', value: activeIds } })
  .with({ author: true })
  .select()

// author is User | null — fully typed, no cast
console.log(`First author (via subquery + eager): ${postsWithAuthors[0]?.author?.name}`)
