import { defineTable, column } from 'oakbun'
import type { InferTable } from 'oakbun'

export const postsTable = defineTable('posts', {
  id:        column.integer().primaryKey(),
  title:     column.text(),
  body:      column.text(),
  authorId:  column.integer(),
  published: column.boolean().default(false),
  createdAt: column.timestamp().defaultFn(() => new Date()),
})
  .hook({
    beforeInsert: (data) => ({
      ...data,
      createdAt: data.createdAt ?? new Date(),
    }),
  })
  .emits({
    afterInsert: 'post.created',
    afterUpdate: 'post.updated',
  })
  .build()

export type PostTypes = InferTable<typeof postsTable>
export type Post      = PostTypes['row']
