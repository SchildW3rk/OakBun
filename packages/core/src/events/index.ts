import type { PendingEvent } from '../db/index'

export type EventHandler = (payload: unknown, ctx: unknown) => Promise<void> | void

// ── RequestEventQueue ────────────────────────────────────────────────────────
// Per-request buffer. HookExecutor collects events here instead of emitting
// immediately. fetch() flushes the queue after onResponse — guaranteeing that
// events never fire on guard block, handler error, or rollback.

export class RequestEventQueue {
  private readonly buffer: PendingEvent[] = []

  collect(name: string, payload: unknown): void {
    this.buffer.push({ name, payload })
  }

  async flush(ctx: unknown, bus: EventBusAdapter | InMemoryEventBus): Promise<void> {
    const events = this.buffer.splice(0)
    for (const e of events) {
      if ('_emit' in bus) {
        (bus as InMemoryEventBus)._emit(e.name, e.payload, ctx)
      } else {
        await bus.emit(e.name, e.payload)
      }
    }
  }

  /** Drain — returns collected events and clears the buffer.
   *  Used by the TX path to hand events off to TransactionResult. */
  drain(): PendingEvent[] {
    return this.buffer.splice(0)
  }

  /** Number of buffered events — useful in tests. */
  get size(): number {
    return this.buffer.length
  }
}

// VelnEvents — opt-in Declaration Merging escape hatch.
//
// STAGING NOTE (Phase 3 → Phase 4):
// app.on() currently accepts `event: string` because module registration erases
// the Table's generic types. InferTableEvents<T, M> is already fully defined in
// schema/table.ts — Phase 4 will wire it into app.on() via a typed overload that
// accepts Table references directly, making this Declaration Merging unnecessary
// for Table-derived events. Use VelnEvents only for events without a Table source
// (e.g. 'app.started', 'request.error').
export interface VelnEvents {}

export type EventBusErrorHandler = (event: string, error: unknown) => void

export interface EventBusOptions {
  /** Called when an event handler throws. Defaults to console.error. */
  onError?: EventBusErrorHandler
}

/**
 * EventBusAdapter — minimal interface for event bus implementations.
 *
 * Default: InMemoryEventBus (single-process, zero latency)
 *
 * For multi-worker deployments: BroadcastChannelAdapter (@oakbun/broadcast, roadmap)
 * For multi-server deployments: RedisAdapter (@oakbun/redis, roadmap)
 *
 * NOTE: EventBus is single-process by default. Events fired on instance A
 * will NOT reach instance B without a distributed adapter.
 */
export interface EventBusAdapter {
  on(event: string, handler: (payload: unknown) => void): void
  emit(event: string, payload: unknown): Promise<void>
}

export class InMemoryEventBus {
  private readonly handlers = new Map<string, EventHandler[]>()
  private readonly _onError: EventBusErrorHandler

  constructor(options?: EventBusOptions) {
    this._onError = options?.onError ??
      ((event, err) => console.error(`[EventBus] Error in handler for "${event}":`, err))
  }

  // Typed overload for events declared via VelnEvents Declaration Merging
  on<K extends keyof VelnEvents>(
    event: K,
    handler: (payload: VelnEvents[K], ctx: unknown) => Promise<void> | void,
  ): this
  // String fallback — Phase 4 will add a Table-reference overload here that uses
  // InferTableEvents<T, M> directly, making Declaration Merging unnecessary for
  // Table-derived events.
  on(event: string, handler: EventHandler): this
  on(event: string, handler: EventHandler): this {
    if (!this.handlers.has(event)) this.handlers.set(event, [])
    this.handlers.get(event)!.push(handler)
    return this
  }

  // _emit — internal. fire & forget — errors in handlers are caught by onError, never thrown.
  // Only HookExecutor and flush() call this. Underscore signals "not for user-code".
  _emit(event: string, payload: unknown, ctx: unknown): void {
    const handlers = this.handlers.get(event) ?? []
    for (const h of handlers) {
      // Wrap in Promise constructor to catch both sync throws and async rejections
      new Promise<void>((resolve) => resolve(h(payload, ctx) as void)).catch((err) =>
        this._onError(event, err)
      )
    }
  }

  // EventBusAdapter.emit — ctx-free emit for external adapter compatibility.
  // Calls _emit with undefined ctx — handlers that need ctx are registered via on() directly.
  async emit(event: string, payload: unknown): Promise<void> {
    this._emit(event, payload, undefined)
  }

  // flush pending events after transaction commit
  async flush(events: PendingEvent[], ctx: unknown): Promise<void> {
    for (const e of events) {
      this._emit(e.name, e.payload, ctx)
    }
  }
}

/** @deprecated Use InMemoryEventBus instead. EventBus will be removed in a future version. */
export const EventBus = InMemoryEventBus
export type EventBus = InMemoryEventBus
