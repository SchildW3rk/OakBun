import { VelnDB, HookExecutor, toCreateTableSql } from 'oakbun'
import type { BoundVelnDB, VelnAdapter } from 'oakbun'
import { usersTable, postsTable, commentsTable, tagsTable } from './schema'

/**
 * Create a BoundVelnDB for standalone scripts.
 * No hooks are registered so hook callbacks never fire — fine for examples.
 */
export function createDB(adapter: VelnAdapter): BoundVelnDB {
  return new VelnDB(adapter, new HookExecutor()).withCtx({})
}

/** Create all tables needed by the examples. */
export async function createTables(adapter: VelnAdapter) {
  await adapter.execute(toCreateTableSql(usersTable))
  await adapter.execute(toCreateTableSql(postsTable))
  await adapter.execute(toCreateTableSql(commentsTable))
  await adapter.execute(toCreateTableSql(tagsTable))
}

/**
 * Insert a consistent dataset used by all examples.
 * Returns created entities so examples can reference them by id.
 */
export async function seed(db: BoundVelnDB) {
  const [alice, bob, charlie] = await db.into(usersTable).insertMany([
    { name: 'Alice',   email: 'alice@example.com',   role: 'admin'  },
    { name: 'Bob',     email: 'bob@example.com',     role: 'editor' },
    { name: 'Charlie', email: 'charlie@example.com', role: 'member' },
  ])

  const [postA, postB, postC, postD] = await db.into(postsTable).insertMany([
    { title: 'Hello OakBun',   body: 'Getting started with the framework.', authorId: alice.id,   published: true  },
    { title: 'Draft Post',     body: 'Work in progress...',                 authorId: alice.id,   published: false },
    { title: "Bob's Guide",    body: 'How to write efficient queries.',      authorId: bob.id,     published: true  },
    { title: 'Charlie Writes', body: 'A member perspective.',               authorId: charlie.id, published: true  },
  ])

  const comments = await db.into(commentsTable).insertMany([
    { body: 'Great post!',  postId: postA.id, authorId: bob.id     },
    { body: 'Nice work.',   postId: postA.id, authorId: charlie.id },
    { body: 'Thanks!',      postId: postC.id, authorId: alice.id   },
  ])

  return { alice, bob, charlie, postA, postB, postC, postD, comments }
}
