// ── @oakbun/ws ────────────────────────────────────────────────────────────────
// WebSocket support for the OakBun framework.
//
// Usage:
//   import { createWsAdapter } from '@oakbun/ws'
//   import '@oakbun/ws'  // enables defineModule().ws()
//
//   const ws = createWsAdapter()
//   app.registerWsAdapter(ws)
//
//   ws.route('/chat', {
//     open(ctx)         { ctx.ws.send('welcome') },
//     message(ctx, raw) { ctx.ws.send(raw) },
//   })

// Side-effect: patches ModuleBuilder.prototype.ws()
import './module-augment'

export { createWsAdapter, OakBunWsAdapterImpl } from './adapter'
export type { WsRateLimitConfig } from './adapter'
export type { WsCtx, WsCtxData, WsHandlers, WsRoute, WsRouteHandler, WsRouteHandlerWithSchema } from './types'
