import type { OakBunEvents } from './index'
import type { Logger, BaseOptions } from '../app/types'
import type { ServiceDef } from '../service/index'
import { createMinimalLogger } from '../app/logger'

export type EventCallback = (payload: unknown) => void | Promise<void>
export type EventHandlerFn<TPayload, TServices extends Record<string, unknown> = Record<never, never>> = (
  payload: TPayload,
  ctx:     { logger: Logger } & TServices,
) => void | Promise<void>

// RawHandler — (payload, ctx) called by app.events() when services are present.
// ctx is assembled by the caller (logger + instantiated services).
export type RawHandler = (payload: unknown, ctx: Record<string, unknown>) => void | Promise<void>

export interface EventHandlerDef {
  readonly _handlers:    Map<string, EventCallback>
  readonly _rawHandlers: Map<string, RawHandler>
  readonly _logger:      Logger
  readonly _services:    ReadonlyArray<ServiceDef<string, unknown>>
}

// Structural constraint — matches any TableDef regardless of its generic params
type TableLike = { name: string; _eventMap: Record<string, unknown> }

// Infer handler map type from a table's _eventMap
type EventHandlerMap<TTable extends TableLike> = Partial<{
  [K in keyof TTable['_eventMap']]: (payload: TTable['_eventMap'][K]) => void | Promise<void>
}>

// Internal type for stored handlers (payload + ctx)
type StoredHandler<TServices extends Record<string, unknown>> = (
  payload: unknown,
  ctx:     { logger: Logger } & TServices,
) => void | Promise<void>

// ── EventHandlerBuilder ───────────────────────────────────────────────────────

export class EventHandlerBuilder<
  TTable    extends TableLike,
  TServices extends Record<string, unknown> = Record<never, never>,
> {
  private _options:    BaseOptions = {}
  private _handlerMap: Map<string, StoredHandler<Record<string, unknown>>> = new Map()
  private _services:   ServiceDef<string, unknown>[] = []

  constructor(private readonly _table: TTable) {}

  options(opts: BaseOptions): this {
    this._options = opts
    return this
  }

  use<TKey extends string, TDef>(
    service: ServiceDef<TKey, TDef>,
  ): EventHandlerBuilder<TTable, TServices & Record<TKey, TDef>> {
    const next = new EventHandlerBuilder<TTable, TServices & Record<TKey, TDef>>(this._table)
    next._options    = this._options
    next._handlerMap = this._handlerMap
    next._services   = [...this._services, service as ServiceDef<string, unknown>]
    return next
  }

  on<TEvent extends string & keyof TTable['_eventMap']>(
    event:   TEvent,
    handler: (
      payload: TTable['_eventMap'][TEvent],
      ctx:     { logger: Logger } & TServices,
    ) => void | Promise<void>,
  ): this {
    this._handlerMap.set(event, handler as StoredHandler<Record<string, unknown>>)
    return this
  }

  // Fluent path — wraps all .on() handlers with logger + service injection
  build(): EventHandlerDef
  // Legacy path — builds EventHandlerDef from a plain handler map (no logger injection)
  build(handlers: EventHandlerMap<TTable>): EventHandlerDef
  build(handlers?: EventHandlerMap<TTable>): EventHandlerDef {
    const logger   = createMinimalLogger(`event:${this._table.name}`, this._options.log)
    const services = this._services

    if (handlers !== undefined) {
      const map = new Map<string, EventCallback>()
      for (const [key, fn] of Object.entries(handlers)) {
        if (fn) map.set(key, fn as EventCallback)
      }
      return {
        _handlers:    map,
        _rawHandlers: new Map(),
        _logger:      logger,
        _services:    [],
      }
    }

    // Logger-only fallback in _handlers (used when no services declared).
    // Raw handlers in _rawHandlers (used by app.events() when services are present).
    const wrapped     = new Map<string, EventCallback>()
    const rawHandlers = new Map<string, RawHandler>()
    for (const [event, handler] of this._handlerMap) {
      wrapped.set(event, (payload) =>
        handler(payload, { logger } as { logger: Logger } & Record<string, unknown>),
      )
      rawHandlers.set(event, handler as RawHandler)
    }
    return {
      _handlers:    wrapped,
      _rawHandlers: rawHandlers,
      _logger:      logger,
      _services:    services,
    }
  }
}

// ── defineEventHandler ────────────────────────────────────────────────────────

// Overload 1 — legacy table-bound (two args) → EventHandlerDef directly
export function defineEventHandler<TTable extends TableLike>(
  table:    TTable,
  handlers: EventHandlerMap<TTable>,
): EventHandlerDef

// Overload 2 — fluent builder (one table arg) → EventHandlerBuilder
export function defineEventHandler<TTable extends TableLike>(
  table: TTable,
): EventHandlerBuilder<TTable>

// Overload 3 — free (plain string keys, OakBunEvents) → EventHandlerDef
export function defineEventHandler(
  handlers: Partial<{ [K in keyof OakBunEvents]: (payload: OakBunEvents[K]) => void | Promise<void> }>,
): EventHandlerDef

export function defineEventHandler<TTable extends TableLike>(
  tableOrHandlers: TTable | Partial<Record<string, EventCallback>>,
  maybeHandlers?:  EventHandlerMap<TTable>,
): EventHandlerBuilder<TTable> | EventHandlerDef {
  // Two args → legacy table-bound overload
  if (maybeHandlers !== undefined) {
    return new EventHandlerBuilder(tableOrHandlers as TTable).build(maybeHandlers)
  }

  // One arg with `_eventMap` → TableLike → fluent builder
  if ('_eventMap' in tableOrHandlers) {
    return new EventHandlerBuilder(tableOrHandlers as TTable)
  }

  // One arg without `_eventMap` → plain handler map → free overload
  const raw = tableOrHandlers as Partial<Record<string, EventCallback>>
  const map = new Map<string, EventCallback>()
  for (const [key, fn] of Object.entries(raw)) {
    if (fn) map.set(key, fn)
  }
  return { _handlers: map, _rawHandlers: new Map(), _logger: createMinimalLogger('event'), _services: [] }
}
