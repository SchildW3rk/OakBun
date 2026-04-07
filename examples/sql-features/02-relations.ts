/**
 * 02 — Name-based loadRelation
 *
 * Scenario: Load published posts, then fetch authors and comments as separate
 * batch queries (DataLoader pattern). One IN-query per relation — never N+1.
 *
 * Shows both the explicit signature (fk column + target table) and the
 * name-based signature (relation name declared on the schema).
 */

import { SQLiteAdapter } from 'oakbun/adapter/sqlite'
import { createDB, createTables, seed } from './_shared/seed'
import { postsTable }                   from './_shared/schema'
import type { User, Comment }           from './_shared/schema'

const adapter = new SQLiteAdapter()
const db      = createDB(adapter)

await createTables(adapter)
const { postA } = await seed(db)

const posts = await db.from(postsTable).where({ published: true }).select()

// ── Explicit form (still works — backwards compatible) ────────────────────────
// Useful when the relation isn't declared on the schema.

import { usersTable, commentsTable } from './_shared/schema'

const authorMapExplicit = await db.loadRelationOne(posts, 'authorId', usersTable, 'id')
console.log(`Author of first post (explicit): ${authorMapExplicit.get(postA.authorId)?.name}`)

// ── Name-based form — reads belongsTo / hasMany metadata from the schema ──────
// postsTable.belongsTo('author', ..., 'authorId') means:
//   loadRelationOne(posts, 'author', postsTable) → same result, less ceremony.

const authorMap   = await db.loadRelationOne(posts, 'author',   postsTable)
const commentsMap = await db.loadRelation(posts,    'comments', postsTable)

// Build enriched result — fully typed, no casts
const enriched = posts.map(post => ({
  ...post,
  author:   authorMap.get(post.authorId) as User | undefined,
  comments: commentsMap.get(post.id)     as Comment[] ?? [],
}))

for (const post of enriched) {
  const commentCount = post.comments.length
  console.log(`"${post.title}" by ${post.author?.name ?? 'unknown'} — ${commentCount} comment(s)`)
}

// loadRelation on users → their posts (hasMany)
const users          = await db.from(usersTable).select()
// Explicit form — typed Map<number, Post[]> — useful when you need the array length
const postsByAuthor = await db.loadRelation(users, 'id', postsTable, 'authorId')

for (const user of users) {
  const count = postsByAuthor.get(user.id)?.length ?? 0
  console.log(`${user.name} has ${count} post(s)`)
}
