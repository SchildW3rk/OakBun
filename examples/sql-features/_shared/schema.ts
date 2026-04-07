import { defineTable, column } from 'oakbun'
import type { InferRow, TableDef, SchemaMap, BelongsToRelation, HasManyRelation } from 'oakbun'

// ── Row types ─────────────────────────────────────────────────────────────────
// Declared up-front to break the circular inference chain.
// TypeScript cannot infer the type of tables that reference each other via
// () => lambdas — we annotate explicitly to give it a stable base.

export type User    = { id: number; name: string; email: string; role: string; active: boolean; deletedAt: Date | null }
export type Post    = { id: number; title: string; body: string; authorId: number; published: boolean; deletedAt: Date | null; createdAt: Date }
export type Comment = { id: number; body: string; postId: number; authorId: number; deletedAt: Date | null }
export type Tag     = { id: number; name: string }

// ── Relation type maps ────────────────────────────────────────────────────────

type UserRelations = {
  posts:    HasManyRelation<Post>
  comments: HasManyRelation<Comment>
}
type PostRelations = {
  author:   BelongsToRelation<User>
  comments: HasManyRelation<Comment>
}
type CommentRelations = {
  post:   BelongsToRelation<Post>
  author: BelongsToRelation<User>
}

// ── Table definitions ─────────────────────────────────────────────────────────

export const usersTable = defineTable('users', {
  id:        column.integer().primaryKey(),
  name:      column.text(),
  email:     column.text(),
  role:      column.text().default('member'),   // 'member' | 'editor' | 'admin'
  active:    column.boolean().default(true),
  deletedAt: column.timestamp().nullable(),
})
  .withSoftDelete('deletedAt')
  .hasMany('posts',    () => postsTable,    'authorId')
  .hasMany('comments', () => commentsTable, 'authorId')
  .build() as unknown as TableDef<User, SchemaMap, any, UserRelations>

export const tagsTable = defineTable('tags', {
  id:   column.integer().primaryKey(),
  name: column.text(),
}).build() as unknown as TableDef<Tag, SchemaMap>

export const postsTable = defineTable('posts', {
  id:        column.integer().primaryKey(),
  title:     column.text(),
  body:      column.text(),
  authorId:  column.integer(),
  published: column.boolean().default(false),
  deletedAt: column.timestamp().nullable(),
  createdAt: column.timestamp().defaultFn(() => new Date()),
})
  .withSoftDelete('deletedAt')
  .belongsTo('author',   () => usersTable,    'authorId')
  .hasMany('comments',   () => commentsTable, 'postId')
  .build() as unknown as TableDef<Post, SchemaMap, any, PostRelations>

export const commentsTable = defineTable('comments', {
  id:        column.integer().primaryKey(),
  body:      column.text(),
  postId:    column.integer(),
  authorId:  column.integer(),
  deletedAt: column.timestamp().nullable(),
})
  .withSoftDelete('deletedAt')
  .belongsTo('post',   () => postsTable, 'postId')
  .belongsTo('author', () => usersTable, 'authorId')
  .build() as unknown as TableDef<Comment, SchemaMap, any, CommentRelations>

// Verify shapes match what InferRow would produce (compile-time sanity check)
type _CheckUser    = InferRow<typeof usersTable>    extends User    ? true : never
type _CheckPost    = InferRow<typeof postsTable>    extends Post    ? true : never
type _CheckComment = InferRow<typeof commentsTable> extends Comment ? true : never
const _: [_CheckUser, _CheckPost, _CheckComment] = [true, true, true]
void _
