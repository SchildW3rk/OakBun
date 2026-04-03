/**
 * Comments Resource — defineResource showcase
 *
 * Demonstrates every override point:
 *   model.*    — custom DB queries (index newest-first, extra method byPost)
 *   service.*  — business logic layer (store enforces body length)
 *   hook       — beforeInsert / afterUpdate via .hook()
 *   guard      — requireAuth on store / update / destroy
 *   audit      — writes to audit_logs on every mutation
 *   events     — log comment.created / comment.deleted via EventBus
 *   onRequest  — per-resource lifecycle hook (adds X-Resource header)
 *   routes.*   — custom summary strings per route
 */

import { defineResource, defineEventHandler, NotFoundError, UnprocessableError } from 'oakbun'
import type { InferRow, InferInsert } from 'oakbun'
import { jwtPlugin } from '@oakbun/jwt'
import { commentsTable } from '../schema/comments'
import type { Comment, CommentTypes } from '../schema/comments'
import { auditLogs }     from '../schema/audit'
import { requireAuth }   from '../guards/auth.guard'

const SECRET = process.env.JWT_SECRET ?? 'veln-example-development-secret-change-in-production'

type CommentRow    = InferRow<typeof commentsTable>
type CommentInsert = InferInsert<typeof commentsTable>

export const commentsResource = defineResource(commentsTable, {
  prefix: '/comments',

  // ── Model overrides ─────────────────────────────────────────────────────────
  // Each override receives `db` and returns the method implementation.
  // Unoverridden methods (show, update, destroy) keep the default behaviour.
  model: {
    // Override index: use explicit select (could add ORDER BY via raw SQL)
    index: (db) => () =>
      db.from(commentsTable).select(),

    // Extra method: fetch all comments for a specific post.
    // Available as model.byPost(postId) inside service overrides below.
    byPost: (db) => (postId: number) =>
      db.from(commentsTable)
        .where({ postId })
        .select(),
  },

  // ── Service overrides ───────────────────────────────────────────────────────
  // Each override receives `{ model }` — the full model including extra methods.
  // Use this layer for business rules that sit above raw DB access.
  service: {
    // Override store: enforce minimum body length before delegating to model
    store: ({ model }) => async (data: CommentInsert) => {
      const body = (data as { body?: string }).body ?? ''
      if (body.trim().length < 3) {
        throw new UnprocessableError('Comment body too short (min 3 chars)')
      }
      return model.store(data)
    },

    // Override show: delegate to model.show (shows that you can wrap with logging etc.)
    show: ({ model }) => (id: number) => model.show(id),
  },

  // ── Route config ────────────────────────────────────────────────────────────
  // false   → route is not registered at all
  // { guard, summary } → per-route guard + OpenAPI summary
  routes: {
    index:   { summary: 'List all comments' },
    show:    { summary: 'Get comment by id' },
    store:   { guard: requireAuth, summary: 'Post a comment (auth required)' },
    update:  { guard: requireAuth, summary: 'Edit a comment (auth required)' },
    destroy: { guard: requireAuth, summary: 'Delete a comment (auth required)' },
  },
})

  // ── JWT plugin — only for this resource's routes ───────────────────────────
  .plugin(jwtPlugin(SECRET, { optional: true }))

  // ── Table hook — beforeInsert / afterUpdate ────────────────────────────────
  // Runs inside the DB transaction, before/after the SQL statement.
  .hook(commentsTable, {
    beforeInsert: (data) => ({
      ...data,
      body: (data as { body?: string }).body?.trim() ?? '',
    }),
    afterUpdate: (_before, after) => {
      console.log(`[comments] updated id=${(after as Comment).id}`)
    },
  })

  // ── Audit log ─────────────────────────────────────────────────────────────
  // Records every insert/update/delete into audit_logs automatically.
  .audit(auditLogs, {
    storeIn: auditLogs,
    actor:   (ctx) => (ctx as { user?: { sub?: string } }).user?.sub ?? null,
  })

  // ── EventBus handlers ──────────────────────────────────────────────────────
  // defineEventHandler wires table events into the bus for side-effects.
  .events(
    defineEventHandler(commentsTable)
      .on('comment.created', (comment, { logger }) => {
        logger.info('comment created', {
          id:     (comment as Comment).id,
          postId: (comment as Comment).postId,
        })
      })
      .on('comment.deleted', (comment, { logger }) => {
        logger.info('comment deleted', { id: (comment as Comment).id })
      })
      .build(),
  )

  .build()
