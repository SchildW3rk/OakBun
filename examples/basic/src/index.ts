/**
 * Veln Example Server
 *
 * Start:  bun run dev     (hot reload)
 *         bun run start   (production)
 *
 * Routes:
 *   GET    /health                 — health check
 *   GET    /stats                  — request counters (custom plugin demo)
 *   GET    /docs                   — Scalar API UI
 *   GET    /openapi.json           — raw OpenAPI spec
 *
 *   GET    /users                  — list all users
 *   GET    /users/:id              — get user by id
 *   POST   /users                  — create user (body: { name, email })
 *   PATCH  /users/:id              — update user
 *   DELETE /users/:id              — delete user
 *
 *   GET    /posts                  — list published posts
 *   GET    /posts/all              — list all posts
 *   GET    /posts/:id              — get post by id
 *   POST   /posts                  — create post (auth required)
 *   PATCH  /posts/:id              — update post (auth required)
 *   DELETE /posts/:id              — delete post (auth required)
 *
 *   POST   /auth/token             — get a JWT (body: { sub, role? })
 *
 *   GET    /stream/count           — SSE counter (Server-Sent Events demo)
 *
 * Auth:
 *   POST /auth/token { sub: "1", role: "admin" }
 *   → { token: "eyJ..." }
 *   Use: Authorization: Bearer <token>
 *
 * Cron jobs (Bun.cron — no external package needed):
 *   cleanup.old-drafts   — 03:00 UTC daily  (+ runOnStart)
 *   stats.report         — every minute
 *
 * JWT_SECRET env var (default: "veln-example-secret")
 */

import {
  createApp,
  dbPlugin,
  eventBusPlugin,
  rateLimitPlugin,
  bodySizeLimitPlugin,
  secureHeadersPlugin,
  scalarPlugin,
  defineEventHandler,
} from 'oakbun'
import { loggerPlugin, printRouteTree } from '@oakbun/logger'
import { signJwt } from '@oakbun/jwt'
import { z }                  from 'zod'

import { usersTable }         from './schema/users'
import { postsTable }         from './schema/posts'
import { usersModule }        from './modules/users.module'
import { postsModule }        from './modules/posts.module'
import { commentsResource }   from './resources/comments.resource'
import { timingMiddleware }   from './middleware/timing.middleware'
import { corsMiddleware }     from './middleware/cors.middleware'
import { statsPlugin }           from './plugins/stats.plugin'
import { adminPlugin }           from './plugins/admin.plugin'
import { cleanupCron }           from './crons/cleanup.cron'
import { statsReportCron }       from './crons/stats-report.cron'
import { NotificationService }   from './services/notification.service'

const PORT   = Number(process.env.PORT ?? 4560)
const SECRET = process.env.JWT_SECRET ?? 'veln-example-development-secret-change-in-production'

// ── App ───────────────────────────────────────────────────────────────────────

const app = createApp()

app
  .use(timingMiddleware())
  .use(corsMiddleware())
  .onResponse(secureHeadersPlugin())

  // Security middleware
  .onRequest(bodySizeLimitPlugin({ maxSize: 2_097_152 }))   // 2 MB
  // trustProxy: true — required when behind a reverse proxy (nginx, Caddy, etc.)
  // Without this, the default keyResolver falls back to 'unknown' → single bucket for all clients
  .onRequest(rateLimitPlugin({ windowMs: 60_000, max: 200, trustProxy: true }))

  // Plugins — order matters: logger → events → db → stats (stats requires db)
  .plugin(loggerPlugin())
  .plugin(eventBusPlugin())
  .plugin(dbPlugin({ adapter: 'sqlite' }))
  .plugin(statsPlugin)
  .plugin(adminPlugin)

  // Cron jobs — scheduled via Bun.cron (native, no external package)
  .cron(cleanupCron)
  .cron(statsReportCron)

  // Global error handler
  .onError((err, ctx) => {
    const e = err as Error & { status?: number; code?: string; issues?: unknown[] }
    const status = e.status ?? 500
    return ctx.json({ error: e.message, code: e.code ?? 'INTERNAL_ERROR', issues: e.issues }, status)
  })

// ── Core routes ───────────────────────────────────────────────────────────────

app.get('/health', (ctx) => ctx.json({
  ok:      true,
  version: '1.0.0',
  ts:      new Date().toISOString(),
}))

// Stats endpoint — uses ctx.stats from custom plugin
app.get('/stats', (ctx: any) => ctx.json(ctx.stats.all()))

// ── Auth ──────────────────────────────────────────────────────────────────────
// Minimal token endpoint — for testing. Not for production use.

app.post(
  '/auth/token',
  { body: z.object({ sub: z.string(), role: z.string().default('user') }), response: z.object({ token: z.string() }) },
  async (ctx) => {
    const token = await signJwt(
      { sub: ctx.body.sub, role: ctx.body.role, exp: Math.floor(Date.now() / 1000) + 86_400 },
      SECRET,
    )
    return ctx.json({ token })
  },
)

// ── SSE Demo ──────────────────────────────────────────────────────────────────
// Server-Sent Events — streams a counter to the client every 500 ms.

app.get('/stream/count', (ctx) =>
  ctx.sse(async (sse) => {
    for (let i = 1; i <= 5; i++) {
      await sse.event('count', { n: i })
      await new Promise((r) => setTimeout(r, 500))
    }
    await sse.event('done', { total: 5 })
  }),
)

// ── Modules ───────────────────────────────────────────────────────────────────

app.register(usersModule)
app.register(postsModule)
app.register(commentsResource.module)

// ── Event Handlers ────────────────────────────────────────────────────────────
// defineEventHandler wires table-level events into the EventBus.
// Side-effects (logging, emails, etc.) belong here — not on the bus directly.

app.events(
  defineEventHandler(usersTable)
    .options({ log: { level: 'info', mask: ['email'] } })
    .use(NotificationService)
    .on('user.created', async (user, { logger, NotificationService: notify }) => {
      logger.info('created', { id: user.id, email: user.email })
      await notify.sendWelcome(user.id)
    })
    .on('user.updated', ({ before, after }, { logger }) => {
      logger.info('updated', { id: after.id, from: before.name, to: after.name })
    })
    .on('user.deleted', (user, { logger }) => {
      logger.info('deleted', { id: user.id })
    })
    .build()
)

app.events(
  defineEventHandler(postsTable)
    .options({ log: { level: 'info' } })
    .on('post.created', (post, { logger }) => {
      logger.info('created', { id: post.id, title: post.title })
    })
    .on('post.updated', ({ after }, { logger }) => {
      logger.info('updated', { id: after.id, published: after.published })
    })
    .build()
)

// ── Scalar Docs ───────────────────────────────────────────────────────────────

app.register(scalarPlugin(app, {
  path:    '/docs',
  title:   'Veln Example API',
  version: '1.0.0',
  cache:   true,
}))

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, (port) => {
  console.log(printRouteTree(app.getRoutes(), {
    title:   'Veln Example',
    version: 'v1.0.0',
    port,
  }))
})
