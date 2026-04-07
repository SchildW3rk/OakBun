/**
 * 07 — Combined: Content-Moderation Workflow
 *
 * Realistic scenario: a moderation dashboard that loads published posts from
 * active admins or editors, with their authors and comments, then performs
 * moderation actions (soft-delete a post, bulk-publish drafts).
 *
 * Features used:
 *   - Subquery + UNION for the privileged-user set
 *   - .with() for eager loading (3 queries, not N+1)
 *   - Soft delete (automatic IS NULL filter on postsTable)
 *   - updateMany for bulk-publish
 */

import { SQLiteAdapter } from 'oakbun/adapter/sqlite'
import { createDB, createTables, seed } from './_shared/seed'
import { usersTable, postsTable }       from './_shared/schema'

const adapter = new SQLiteAdapter()
const db      = createDB(adapter)

await createTables(adapter)
const { alice } = await seed(db)

// ── Step 1: Subquery for active admins + editors ──────────────────────────────
// Two role groups → UNION → subquery. One compound SELECT, no extra round-trip.

const activePrivilegedIds = db
  .from(usersTable).columns('id').where({ active: true, role: 'admin' })
  .union(
    db.from(usersTable).columns('id').where({ active: true, role: 'editor' }),
  )
  .subquery()

// ── Step 2: Load matching posts with relations ────────────────────────────────
// Soft delete is applied automatically — deleted posts never appear.
// 3 queries total: posts + authors + comments.

const posts = await db
  .from(postsTable)
  .where({
    published: true,
    authorId:  { op: 'IN', value: activePrivilegedIds },
  })
  .with({ author: true, comments: true })
  .orderBy('createdAt', 'DESC')
  .limit(10)
  .select()

console.log(`Found ${posts.length} post(s) from privileged authors:`)
for (const post of posts) {
  const commentCount = post.comments.length
  const authorName   = post.author?.name ?? 'unknown'
  console.log(`  "${post.title}" by ${authorName} — ${commentCount} comment(s)`)
}

// ── Step 3: Moderate — soft-delete the first post ────────────────────────────

if (posts.length > 0) {
  const target = posts[0]!
  await db.from(postsTable).softDelete().where({ id: target.id }).execute()
  console.log(`Moderated: "${target.title}" is now hidden`)

  // Verify it's gone from the normal query
  const visible = await db.from(postsTable).where({ published: true }).select()
  console.log(`Visible posts after moderation: ${visible.length}`)
}

// ── Step 4: Bulk-publish Alice's drafts ──────────────────────────────────────
// All rows succeed or none do — updateMany is transactional.

const aliceDrafts = await db
  .from(postsTable)
  .where({ published: false, authorId: alice.id })
  .select()

if (aliceDrafts.length > 0) {
  await db.from(postsTable).updateMany(
    aliceDrafts.map(p => ({ id: p.id, published: true as const })),
  )
  console.log(`Published ${aliceDrafts.length} draft(s) for Alice`)
} else {
  console.log('No drafts to publish')
}

// ── Step 5: Final state ───────────────────────────────────────────────────────

const allVisible = await db.from(postsTable).select()
console.log(`Final visible post count: ${allVisible.length}`)
