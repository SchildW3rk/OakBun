import type { OnRequestHook } from './types'
import { createOnRequest } from './types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HealthCheck {
  (): Promise<{ ok: boolean; details?: Record<string, unknown> }>
}

export interface HealthPluginOptions {
  /** Path for the liveness endpoint. Default: '/health' */
  path?: string
  /** Path for the readiness endpoint. Default: '/ready' */
  readyPath?: string
  /** Named checks to run for the readiness endpoint. */
  checks?: Record<string, HealthCheck>
}

// ── Plugin ────────────────────────────────────────────────────────────────────

/**
 * healthPlugin — adds /health and /ready endpoints for Kubernetes/load balancers.
 *
 * Usage:
 *   const health = healthPlugin({ checks: { db: async () => ({ ok: true }) } })
 *   app.onRequest(health.onRequest)
 *
 * GET /health  → 200 { status: 'ok', uptime: number }
 *   Always returns 200. Use for liveness probes (is the process alive?).
 *
 * GET /ready   → 200 { status: 'ready', checks: { db: { ok: true } } }
 *               → 503 { status: 'not_ready', checks: { db: { ok: false, error: '...' } } }
 *   Runs all checks. Use for readiness probes (is the service ready to serve traffic?).
 *
 * The health endpoints are intercepted in the onRequest phase — before auth plugins run.
 */
export interface HealthPlugin {
  onRequest: OnRequestHook
}

export function healthPlugin(options: HealthPluginOptions = {}): HealthPlugin {
  const healthPath = options.path      ?? '/health'
  const readyPath  = options.readyPath ?? '/ready'
  const checks     = options.checks    ?? {}

  const onRequest: OnRequestHook = createOnRequest(async (ctx) => {
    const url    = new URL(ctx.req.url)
    const path   = url.pathname
    const method = ctx.req.method.toUpperCase()

    if (method !== 'GET') return

    // GET /health — liveness probe
    if (path === healthPath) {
      return Response.json({ status: 'ok', uptime: process.uptime() }, { status: 200 })
    }

    // GET /ready — readiness probe
    if (path === readyPath) {
      const checkNames   = Object.keys(checks)
      const checkResults: Record<string, { ok: boolean; details?: Record<string, unknown>; error?: string }> = {}
      let allOk = true

      for (const name of checkNames) {
        try {
          const result = await checks[name]!()
          checkResults[name] = { ok: result.ok, ...(result.details ? { details: result.details } : {}) }
          if (!result.ok) allOk = false
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          checkResults[name] = { ok: false, error: message }
          allOk = false
        }
      }

      if (allOk) {
        return Response.json({ status: 'ready', checks: checkResults }, { status: 200 })
      } else {
        return Response.json({ status: 'not_ready', checks: checkResults }, { status: 503 })
      }
    }
  })

  return { onRequest }
}
