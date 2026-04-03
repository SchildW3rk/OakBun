import { defineTable, column } from 'oakbun'
import type { InferTable } from 'oakbun'

export const usersTable = defineTable('users', {
  id:        column.integer().primaryKey(),
  name:      column.text(),
  email:     column.text().unique(),
  role:      column.text().default('user'),
  createdAt: column.timestamp().defaultFn(() => new Date()),
})
  .hook({
    beforeInsert: (data) => ({
      ...data,
      createdAt: data.createdAt ?? new Date(),
    }),
  })
  .emits({
    afterInsert: 'user.created',
    afterUpdate: 'user.updated',
    afterDelete: 'user.deleted',
  })
  .build()

export type UserTypes = InferTable<typeof usersTable>
export type User      = UserTypes['row']
