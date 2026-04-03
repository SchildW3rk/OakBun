/**
 * healthExtendedPlugin — Spec 04 typed module context showcase
 *
 * Demonstrates both Option B (defineModule<TCtx>) and Option A (.modules(factory))
 * from Spec 04 — Typed Module Context.
 *
 * What this plugin does:
 *   - ctx.buildInfo  — version + uptime info on every request
 *   - GET /system/health  — basic health endpoint  (Option B: typed via defineModule<TCtx>)
 *   - GET /system/info    — build-info endpoint    (Option B: ctx.buildInfo typed, no cast)
 *   - GET /system/status  — status endpoint        (Option A: factory arg carries the type)
 *
 * Register once:
 *   app.plugin(healthExtendedPlugin)
 *
 * No separate app.register() call needed — .modules([...]) handles it.
 */

import { definePlugin, defineModule } from 'oakbun'
import type { BaseCtx } from 'oakbun'
import { z } from 'zod'

const startedAt = Date.now()

interface BuildInfo {
  version: string
  uptime:  number
  env:     string
}

// The full ctx type this plugin contributes
type HealthCtx = BaseCtx & { buildInfo: BuildInfo }

// ── Option B: defineModule<TCtx> — typed handlers without any `as` casts ──────
//
// Passing HealthCtx as the generic tells TypeScript that every handler in this
// module receives a ctx with ctx.buildInfo already typed. No cast needed.
//
// This is a pure compile-time feature — zero runtime overhead.
// Response schema for /health — demonstrates Spec 05 flat body/response on .route()
const HealthResponse = z.object({
  ok: z.boolean(),
  ts: z.string(),
})

// Body + response schemas for /ping — demonstrates validation on .route()
const PingBody     = z.object({ message: z.string().optional() })
const PingResponse = z.object({ pong: z.boolean(), echo: z.string().optional() })

const systemModule = defineModule<HealthCtx>('/system')
  .meta({ tag: 'System', description: 'System info routes (contributed by healthExtendedPlugin)' })
  // Spec 05: flat `response` schema — RouteMap updated, docs generated from schema
  .route({
    method:    'GET',
    path:      '/health',
    response:  HealthResponse,
    docs:      { summary: 'Health check' },
    handler:   (_ctx) => _ctx.json({ ok: true, ts: new Date().toISOString() }),
  })
  .route({
    method:  'GET',
    path:    '/info',
    docs:    { summary: 'Build info' },
    // ctx.buildInfo is fully typed — no `as` cast needed (Option B in action)
    handler: (ctx) => ctx.json(ctx.buildInfo),
  })
  .route({
    method:  'GET',
    path:    '/status',
    docs:    { summary: 'Status check' },
    // ctx.buildInfo typed via HealthCtx generic — no cast needed
    handler: (ctx) => ctx.json({
      ok:      true,
      uptime:  ctx.buildInfo.uptime,
      version: ctx.buildInfo.version,
    }),
  })
  // Spec 05: body + response via schema:{} wrapper (provides handler contextual typing)
  .route({
    method:   'POST',
    path:     '/ping',
    schema:   { body: PingBody, response: PingResponse },
    docs:     { summary: 'Ping endpoint — echoes message back' },
    handler:  (ctx) => ctx.json({ pong: true, echo: ctx.body.message }),
  })
  .build()

// ── Option A: .modules(factory) — typed ctx via factory argument ──────────────
//
// The factory receives a typed ctx so TypeScript infers the correct type for
// handlers defined inside the returned modules. The factory is called ONCE at
// plugin-registration time with a dummy empty object — the argument is NEVER
// used for actual request handling. Its sole purpose is compile-time type
// inference. The (_ctx: HealthCtx) parameter makes the available type explicit
// for anyone reading this as a reference.
//
// Use this form when you prefer to co-locate module definitions with the plugin
// that declares their ctx extension.
const healthExtendedPlugin = definePlugin<{ buildInfo: BuildInfo }>('healthExtended')
  // Option A factory — _ctx carries HealthCtx for inference, never used at runtime
  .modules((_ctx: HealthCtx) => [systemModule])
  // Extend ctx — buildInfo available in every route handler above
  .extend(() => ({
    buildInfo: {
      version: process.env.npm_package_version ?? '0.0.0',
      uptime:  Math.floor((Date.now() - startedAt) / 1000),
      env:     process.env.NODE_ENV ?? 'development',
    },
  }))

export { healthExtendedPlugin }
