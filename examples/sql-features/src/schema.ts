import { defineTable, column } from 'oakbun'
import type { InferTable } from 'oakbun'

// ── Users ─────────────────────────────────────────────────────────────────────

export const usersTable = defineTable('users', {
  id:        column.integer().primaryKey(),
  name:      column.text(),
  email:     column.text().unique(),
  role:      column.text().default('user'),
  createdAt: column.timestamp().defaultFn(() => new Date()),
}).build()

export type UserTypes = InferTable<typeof usersTable>
export type User      = UserTypes['row']

// ── Posts ─────────────────────────────────────────────────────────────────────

export const postsTable = defineTable('posts', {
  id:        column.integer().primaryKey(),
  title:     column.text(),
  authorId:  column.integer(),
  published: column.boolean().default(false),
  views:     column.integer().default(0),
  createdAt: column.timestamp().defaultFn(() => new Date()),
}).build()

export type PostTypes = InferTable<typeof postsTable>
export type Post      = PostTypes['row']

// ── Orders ─────────────────────────────────────────────────────────────────────
// Used for aggregation examples (GROUP BY, SUM, AVG, etc.)

export const ordersTable = defineTable('orders', {
  id:       column.integer().primaryKey(),
  userId:   column.integer(),
  amount:   column.integer(),
  status:   column.text(),  // 'paid' | 'pending' | 'refunded'
}).build()

export type OrderTypes = InferTable<typeof ordersTable>
export type Order      = OrderTypes['row']
