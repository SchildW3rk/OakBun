// ── Module Augmentation — adds .ws() to ModuleBuilder ────────────────────────
// Import this file (or '@oakbun/ws') to enable defineModule().ws() in your app.
//
// Usage:
//   import '@oakbun/ws'  // side-effect enables .ws() on ModuleBuilder
//
//   const mod = defineModule('/chat')
//     .ws('/room/:id', { open(ctx) { ... } })
//     .build()

import type { WsRouteHandler } from './types'
import { normalizeWsHandler } from './types'

// Augment the public ModuleBuilder class via the 'oakbun' package entrypoint.
// Targeting the public API (not an internal path) makes this stable against
// internal refactors in @oakbun/core.
declare module 'oakbun' {
  interface ModuleBuilder<TCtx, TPrefix extends string, TRoutes> {
    ws<TMsg = unknown>(path: string, handler: WsRouteHandler<TMsg>): ModuleBuilder<TCtx, TPrefix, TRoutes>
  }
}

// Runtime: inject .ws() onto ModuleBuilder.prototype once.
// The any cast is unavoidable here — TypeScript module augmentation extends only
// the declared type, not the runtime prototype. The runtime patch is intentionally
// guarded with an existence check to prevent double-patching.
import { ModuleBuilder } from 'oakbun'

if (!(ModuleBuilder.prototype as any).ws) {
  ;(ModuleBuilder.prototype as any).ws = function <TMsg>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this: any,
    path: string,
    handler: WsRouteHandler<TMsg>,
  ) {
    const { messageSchema, handlers } = normalizeWsHandler(handler)
    const route = { path, messageSchema, handlers, _module: null }
    // clone() is protected — accessible from this augmentation since we're
    // operating on the prototype where TypeScript's access checks don't apply.
    return (this as any).clone({ wsRoutes: [...(this as any)._state.wsRoutes, route] })
  }
}
