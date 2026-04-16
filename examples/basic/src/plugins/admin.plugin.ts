/**
 * adminPlugin — demonstrates the new plugin-level .guard() API
 *
 * A single guard on the plugin protects ALL contributed modules at once.
 * Guard order: plugin guard → module guard → route guard → handler
 *
 * Routes (all gated by the plugin guard):
 *   GET /admin/users     — list all users (admin only)
 *   GET /admin/posts     — list all posts (admin only)
 *   GET /admin/settings  — app settings   (admin only)
 *
 * The plugin guard checks for x-admin-token: secret header.
 * → Missing or wrong token: 401
 * → Correct token: passes through to the handlers
 */

import { definePlugin, defineModule } from 'oakbun'

// ── Guard ─────────────────────────────────────────────────────────────────────
// Applied to ALL modules in this plugin — no need to repeat on each module.

function adminGuard(ctx: { req: Request }): Response | null {
  const token = ctx.req.headers.get('x-admin-token')
  if (token !== 'secret') {
    return Response.json({ error: 'Admin access required', code: 'UNAUTHORIZED' }, { status: 401 })
  }
  return null // pass through
}

// ── Module 1: Users admin ─────────────────────────────────────────────────────

const adminUsersModule = defineModule('/admin/users')
  .meta({ tag: 'Admin', description: 'Admin — user management' })
  .route({
    method:  'GET',
    path:    '/',
    summary: 'List all users (admin)',
    handler: (ctx) => ctx.json({
      users: [
        { id: 1, name: 'Alice', email: 'alice@example.com', role: 'admin' },
        { id: 2, name: 'Bob',   email: 'bob@example.com',   role: 'user' },
        { id: 3, name: 'Carol', email: 'carol@example.com', role: 'user' },
      ],
    }),
  })
  .build()

// ── Module 2: Posts admin ─────────────────────────────────────────────────────

const adminPostsModule = defineModule('/admin/posts')
  .meta({ tag: 'Admin', description: 'Admin — post management' })
  .route({
    method:  'GET',
    path:    '/',
    summary: 'List all posts (admin)',
    handler: (ctx) => ctx.json({
      posts: [
        { id: 1, title: 'Hello World', published: true },
        { id: 2, title: 'Draft Post',  published: false },
      ],
    }),
  })
  .build()

// ── Module 3: Settings admin ──────────────────────────────────────────────────

const adminSettingsModule = defineModule('/admin/settings')
  .meta({ tag: 'Admin', description: 'Admin — app settings' })
  .route({
    method:  'GET',
    path:    '/',
    summary: 'Get app settings (admin)',
    handler: (ctx) => ctx.json({
      settings: {
        maintenanceMode: false,
        maxUploadSizeMb: 10,
        allowRegistration: true,
      },
    }),
  })
  .build()

// ── Plugin ────────────────────────────────────────────────────────────────────

export const adminPlugin = definePlugin<object>('admin')
  // All 3 modules are protected by a single plugin-level guard.
  // No need to add the guard to each module individually.
  .modules([adminUsersModule, adminPostsModule, adminSettingsModule])
  .guard(adminGuard)
  .extend(() => ({}))
