/**
 * 03 — Eager Loading with .with()
 *
 * Scenario: Fetch posts together with their author and comments in one call.
 * .with() always issues exactly N+1 queries regardless of row count:
 *   1 × posts + 1 × authors + 1 × comments = 3 queries total.
 *
 * Return type is fully inferred — author and comments are typed without casts.
 */

import { SQLiteAdapter } from 'oakbun/adapter/sqlite'
import { createDB, createTables, seed } from './_shared/seed'
import { postsTable }                   from './_shared/schema'
import type { User, Comment }           from './_shared/schema'

const adapter = new SQLiteAdapter()
const db      = createDB(adapter)

await createTables(adapter)
await seed(db)

// ── Fetch posts + author + comments in 3 queries ──────────────────────────────

const posts = await db
  .from(postsTable)
  .where({ published: true })
  .with({ author: true, comments: true })
  .select()

// TypeScript knows the shape — no cast needed
const firstAuthor:   User      = posts[0]!.author!
const firstComments: Comment[] = posts[0]!.comments

console.log(`"${posts[0]!.title}" by ${firstAuthor.name} — ${firstComments.length} comment(s)`)

// ── Combined with orderBy + limit ─────────────────────────────────────────────

const recent = await db
  .from(postsTable)
  .where({ published: true })
  .orderBy('createdAt', 'DESC')
  .limit(3)
  .with({ author: true })
  .select()

console.log(`Top 3 posts by: ${recent.map(p => p.author?.name ?? 'unknown').join(', ')}`)

// ── selectOne equivalent: .with() + .first() ─────────────────────────────────
// .first() returns T | null — useful for detail-page lookups.

const post = await db
  .from(postsTable)
  .where({ id: posts[0]!.id })
  .with({ author: true, comments: true })
  .first()

if (post) {
  console.log(`Detail: "${post.title}" by ${post.author?.name} — ${post.comments.length} comment(s)`)
}
