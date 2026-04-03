import type { VelnWsAdapter, WsRouteShape, BaseCtx } from 'oakbun'
import type { Plugin } from '../../core/src/app/plugin'
import { matchPath } from '../../core/src/app/router'
import { VelnError } from '../../core/src/errors/index'
import type { WsCtx, WsCtxData, WsRoute, WsRouteHandler } from './types'
import { normalizeWsHandler } from './types'

// ── WS message rate-limit config ─────────────────────────────────────────────

export interface WsRateLimitConfig {
  /** Maximum messages per window per connection. Default: 60 */
  max?: number
  /** Window duration in milliseconds. Default: 1000 (1 second) */
  windowMs?: number
}

interface RateLimitState {
  count: number
  resetAt: number
}

// ── VelnWsAdapterImpl ─────────────────────────────────────────────────────────

export class VelnWsAdapterImpl implements VelnWsAdapter {
  // WS route store — keyed by registered path pattern (e.g. '/chat', '/rooms/:id')
  private readonly _routes: Map<string, WsRoute> = new Map()

  // Per-connection rate-limit state — WeakMap so entries are GC'd when ws closes
  private readonly _rateLimitMap: WeakMap<object, RateLimitState> = new WeakMap()
  private readonly _rateLimitMax: number
  private readonly _rateLimitWindowMs: number

  constructor(rateLimit?: WsRateLimitConfig) {
    this._rateLimitMax      = rateLimit?.max      ?? 60
    this._rateLimitWindowMs = rateLimit?.windowMs ?? 1000
  }

  registerRoute(path: string, route: WsRouteShape): void {
    this._routes.set(path, route as WsRoute)
  }

  getRoute(path: string): WsRoute | undefined {
    return this._routes.get(path)
  }

  /**
   * ws() — register a typed WebSocket route on this adapter.
   *
   * Usage:
   *   const ws = createWsAdapter()
   *   app.registerWsAdapter(ws)
   *
   *   ws.route('/chat', {
   *     open(ctx)         { ctx.ws.send('welcome') },
   *     message(ctx, raw) { ctx.ws.send(raw) },
   *   })
   *
   *   // With Zod message schema:
   *   ws.route('/chat', {
   *     message: z.object({ text: z.string() }),
   *     handlers: { message(ctx) { ctx.data.text } },
   *   })
   */
  route<TMsg = unknown>(path: string, handler: WsRouteHandler<TMsg>): this {
    const { messageSchema, handlers } = normalizeWsHandler(handler)
    this._routes.set(path, { path, messageSchema, handlers, _module: null })
    return this
  }

  // ── handleUpgrade ────────────────────────────────────────────────────────────
  // Called from Core's fetch() when an HTTP Upgrade: websocket request arrives.
  // Runs the plugin chain, builds ws.data, and calls server.upgrade().
  // Returns null on successful upgrade (caller returns undefined to Bun).
  // Returns a Response on error or if no route matches.

  async handleUpgrade(
    req: Request,
    // @ts-ignore — Bun's Server generic signature differs across bun-types versions
    server: import('bun').Server,
    baseCtx: BaseCtx,
    plugins: ReadonlyArray<Plugin<any, any>>,
    installedRef: { value: boolean },
    installedModulePlugins: Set<string>,
  ): Promise<Response | null> {
    const url = new URL(req.url)
    const pathname = url.pathname

    // Find matching WS route
    let matchedRoute: WsRoute | null = null
    let wsParams: Record<string, string | undefined> = {}

    for (const [, wsRoute] of this._routes) {
      const result = matchPath(wsRoute.path, pathname)
      if (result !== null) {
        matchedRoute = wsRoute
        wsParams = result.params
        break
      }
    }

    if (matchedRoute === null) {
      return new Response('Not Found', { status: 404 })
    }

    // Run plugin chain to build full ctx (gives ctx.user, ctx.db, etc.)
    let wsCtx: Record<string, unknown> = { ...baseCtx }
    const wsMod = matchedRoute._module as { plugins: Plugin<any, any>[] } | null

    // Lazy plugin install — may have already run on first HTTP request
    if (!installedRef.value) {
      installedRef.value = true
      for (const plugin of plugins) {
        if (plugin.install) await plugin.install((baseCtx as any)._hooks)
      }
    }

    try {
      for (const plugin of plugins) {
        // @ts-ignore — wsCtx satisfies BaseCtx at runtime
        Object.assign(wsCtx, await plugin.request(wsCtx as BaseCtx))
      }
      if (wsMod) {
        for (const plugin of wsMod.plugins) {
          if (plugin.install && !installedModulePlugins.has(plugin.name)) {
            installedModulePlugins.add(plugin.name)
            await plugin.install((baseCtx as any)._hooks)
          }
          // @ts-ignore — wsCtx satisfies BaseCtx at runtime
          Object.assign(wsCtx, await plugin.request(wsCtx as BaseCtx))
        }
      }
    } catch (err) {
      // Plugin error during upgrade — return HTTP error response
      if (err instanceof VelnError) {
        return Response.json(
          { error: err.name, code: err.code, message: err.message },
          { status: err.status },
        )
      }
      if (
        err instanceof Error &&
        typeof (err as any).status === 'number' &&
        typeof (err as any).code === 'string'
      ) {
        const e = err as Error & { status: number; code: string }
        return Response.json(
          { error: e.name, code: e.code, message: e.message },
          { status: e.status },
        )
      }
      return Response.json(
        { error: 'Internal Server Error', code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        { status: 500 },
      )
    }

    // Build params — filter out undefined values
    const definedParams: Record<string, string> = {}
    for (const [k, v] of Object.entries(wsParams)) {
      if (v !== undefined) definedParams[k] = v
    }

    // Stash everything in ws.data so callbacks can access it
    const wsData: WsCtxData = {
      _wsPath: matchedRoute.path,
      params:  definedParams,
      query:   (wsCtx.query as Record<string, string | string[]>) ?? {},
      user:    wsCtx.user as any,
      db:      wsCtx.db as any,
    }

    const upgraded = server.upgrade(req, { data: wsData })
    if (upgraded) return null  // success — caller returns undefined to Bun
    return new Response('WebSocket upgrade failed', { status: 426 })
  }

  // ── getWebsocketConfig ────────────────────────────────────────────────────────
  // Returns the Bun websocket handler config. Passed to Bun.serve().

  getWebsocketConfig(): import('bun').WebSocketHandler<Record<string, unknown>> {
    return {
      open: (ws: import('bun').ServerWebSocket<WsCtxData>) => {
        const route = this._routes.get(ws.data._wsPath)
        if (!route?.handlers.open) return
        const ctx = this._buildCtx(ws, undefined)
        Promise.resolve(route.handlers.open(ctx)).catch((err) =>
          console.error('[veln:ws] open handler error:', err),
        )
      },

      message: (ws: import('bun').ServerWebSocket<WsCtxData>, raw: string | Uint8Array) => {
        // ── Per-connection rate-limit ─────────────────────────────────────────
        const now = Date.now()
        const state = this._rateLimitMap.get(ws)
        if (state && now < state.resetAt) {
          state.count++
          if (state.count > this._rateLimitMax) {
            ws.send(JSON.stringify({ error: 'RATE_LIMITED', code: 'RATE_LIMITED', message: 'Too many messages — slow down' }))
            return
          }
        } else {
          this._rateLimitMap.set(ws, { count: 1, resetAt: now + this._rateLimitWindowMs })
        }
        // ─────────────────────────────────────────────────────────────────────

        const route = this._routes.get(ws.data._wsPath)
        if (!route?.handlers.message) return

        let data: unknown = raw
        if (route.messageSchema) {
          // Gate 1: JSON parse — syntax error
          if (typeof raw !== 'string') {
            ws.send(JSON.stringify({ error: 'WS_PARSE_ERROR', code: 'WS_PARSE_ERROR', message: 'Binary frames are not supported with a message schema' }))
            return
          }
          let parsed: unknown
          try {
            parsed = JSON.parse(raw)
          } catch {
            ws.send(JSON.stringify({ error: 'WS_PARSE_ERROR', code: 'WS_PARSE_ERROR', message: 'Message is not valid JSON' }))
            return
          }

          // Gate 2: Zod validation — structure/type error
          const result = route.messageSchema.safeParse(parsed)
          if (!result.success) {
            ws.send(JSON.stringify({ error: 'VALIDATION_ERROR', code: 'VALIDATION_ERROR', issues: result.error.issues }))
            return
          }
          data = result.data
        }

        const ctx = this._buildCtx(ws, data)
        Promise.resolve(route.handlers.message(ctx, raw)).catch((err) =>
          console.error('[veln:ws] message handler error:', err),
        )
      },

      close: (ws: import('bun').ServerWebSocket<WsCtxData>, code: number, reason: string) => {
        const route = this._routes.get(ws.data._wsPath)
        if (!route?.handlers.close) return
        const ctx = this._buildCtx(ws, undefined)
        Promise.resolve(route.handlers.close(ctx, code, reason)).catch((err) =>
          console.error('[veln:ws] close handler error:', err),
        )
      },

      drain: (ws: import('bun').ServerWebSocket<WsCtxData>) => {
        const route = this._routes.get(ws.data._wsPath)
        if (!route?.handlers.drain) return
        const ctx = this._buildCtx(ws, undefined)
        Promise.resolve(route.handlers.drain(ctx)).catch((err) =>
          console.error('[veln:ws] drain handler error:', err),
        )
      },
    } as import('bun').WebSocketHandler<Record<string, unknown>>
  }

  // ── _buildCtx ────────────────────────────────────────────────────────────────

  private _buildCtx(ws: import('bun').ServerWebSocket<WsCtxData>, data: unknown): WsCtx<any> {
    return {
      params: ws.data.params,
      query:  ws.data.query,
      ws,
      data,
      user:   ws.data.user,
      db:     ws.data.db,
    }
  }
}

// ── createWsAdapter ───────────────────────────────────────────────────────────

/**
 * createWsAdapter() — creates a VelnWsAdapter for use with Veln apps.
 *
 * Usage:
 *   import { createWsAdapter } from '@oakbun/ws'
 *   app.registerWsAdapter(createWsAdapter())
 *
 *   app.ws('/chat', {
 *     open(ctx)         { ctx.ws.send('welcome') },
 *     message(ctx, raw) { ctx.ws.send(raw) },
 *   })
 */
export function createWsAdapter(rateLimit?: WsRateLimitConfig): VelnWsAdapterImpl {
  return new VelnWsAdapterImpl(rateLimit)
}
