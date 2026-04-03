import { defineTable, column } from 'oakbun'
import type { InferTable } from 'oakbun'

export const commentsTable = defineTable('comments', {
  id:        column.integer().primaryKey(),
  postId:    column.integer(),
  authorId:  column.integer(),
  body:      column.text(),
  createdAt: column.timestamp().defaultFn(() => new Date()),
})
  .hook({
    beforeInsert: (data) => ({
      ...data,
      createdAt: data.createdAt ?? new Date(),
    }),
  })
  .emits({
    afterInsert: 'comment.created',
    afterUpdate: 'comment.updated',
    afterDelete: 'comment.deleted',
  })
  .build()

export type CommentTypes = InferTable<typeof commentsTable>
export type Comment      = CommentTypes['row']
