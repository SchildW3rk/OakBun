import type { BaseCtx, Logger, BaseOptions } from './types'
import type { VelnAdapter } from '../adapter/types'
import type { HookExecutor } from '../hooks/executor'
import type { EventBus } from '../events/index'
import type { BoundVelnDB } from '../db/index'
import type { VelnModule } from './module'
import { createMinimalLogger } from './logger'
import { type AdapterConfig, resolveAdapter as resolveAdapterConfig } from '../adapter/resolve'

/** A single navigation item contributed by a plugin via .nav(). */
export interface NavItem {
  label:     string
  route:     string
  icon?:     string
  order?:    number
  children?: NavItem[]
}

// ── ModulesInput — Option A (Spec 04) ────────────────────────────────────────
//
// .modules() now accepts either a plain array OR a factory function.
//
// Factory form:  .modules((ctx: TCtx) => [myModule])
//
// Purpose: the factory's argument type gives TypeScript the correct ctx for
// modules defined inside it — purely a compile-time convenience.
//
// IMPORTANT: the factory is called at plugin-build time with a dummy empty
// object. The factory's argument is NEVER used for actual request handling —
// it exists only to let TypeScript infer the correct ctx type for the modules
// returned. The resulting VelnModule[] is extracted once and stored as a plain
// array, identical to the non-factory case.
export type ModulesInput<TCtx> = VelnModule[] | ((ctx: TCtx) => VelnModule[])

export interface Plugin<TCtx, TAdd extends object> {
  name: string
  /**
   * Optional list of plugin names that must be registered before this plugin.
   * app.plugin() validates this at registration time and throws PLUGIN_MISSING_DEP
   * if a required plugin is not yet registered.
   *
   * Example: eventBusPlugin sets requires: ['db'] to enforce registration order.
   */
  requires?: string[]
  /**
   * Optional list of modules this plugin contributes.
   * app.plugin() calls app.register() on each entry automatically.
   *
   * Can also be set to a factory function for typed ctx inference (Option A, Spec 04).
   * The factory is called once with a dummy ctx to extract the module list —
   * it is NEVER called at request time.
   */
  modules?: VelnModule[]
  /**
   * Optional permission gate for all routes contributed via .modules().
   * app.plugin() checks ctx.user before running plugin.request() for those routes.
   * User must have at least one of the listed permissions — checked via AuthAdapter.hasPermission().
   * No user → 401. User without any matching permission → 403.
   */
  permissions?: string[]
  /**
   * Optional nav items contributed by this plugin.
   * GET /nav returns these filtered by the plugin's permissions for the current user.
   */
  nav?: NavItem[]
  // install receives the app's HookExecutor so plugins can register hooks into it.
  // Most plugins ignore it — only dbPlugin uses it to wire itself into the app.
  install?: (hooks: HookExecutor) => Promise<void> | void
  request: (ctx: TCtx) => Promise<TCtx & TAdd> | (TCtx & TAdd)
  teardown?: () => Promise<void> | void
}

// ── PluginBuilder — fluent builder for definePlugin() ─────────────────────────

export class PluginBuilder<TAdd extends object> {
  private _options:     BaseOptions  = {}
  private _requires:    string[]     = []
  private _modules:     VelnModule[] = []
  private _permissions: string[]     = []
  private _nav:         NavItem[]    = []

  constructor(private readonly _name: string) {}

  options(opts: BaseOptions): this {
    this._options = opts
    return this
  }

  requires(deps: string[]): this {
    this._requires = deps
    return this
  }

  // Option A (Spec 04): accepts a plain array OR a factory function.
  //
  // Factory form:  .modules((ctx: BaseCtx & TAdd) => [myModule])
  //
  // The factory receives a typed ctx so TypeScript can infer the correct ctx
  // type for handlers defined inside the returned modules. This is a pure
  // compile-time feature — the factory is called ONCE here (at plugin-build
  // time) with a dummy empty object to extract the VelnModule[]. The dummy
  // argument is NEVER used for actual request handling and carries no real data.
  // The result is stored as a plain VelnModule[], identical to the array form.
  modules(input: ModulesInput<BaseCtx & TAdd>): this {
    if (typeof input === 'function') {
      // Call factory with a dummy ctx to extract the module array.
      // IMPORTANT: The factory's argument is never used at request time —
      // its sole purpose is to give TypeScript the correct ctx type.
      // We cast the empty object so the runtime call succeeds without `any`.
      this._modules = input({} as BaseCtx & TAdd)
    } else {
      this._modules = input
    }
    return this
  }

  permission(perm: string | string[]): this {
    this._permissions = Array.isArray(perm) ? perm : [perm]
    return this
  }

  nav(items: NavItem | NavItem[]): this {
    this._nav = Array.isArray(items) ? items : [items]
    return this
  }

  // Shorthand: only need to provide a request() factory. Returns Plugin directly (not a factory fn).
  extend(
    fn: (ctx: BaseCtx) => Promise<TAdd> | TAdd,
  ): Plugin<BaseCtx, TAdd> {
    const logger      = createMinimalLogger(`plugin:${this._name}`, this._options.log)
    const name        = this._name
    const requires    = this._requires.length    > 0 ? this._requires    : undefined
    const modules     = this._modules.length     > 0 ? this._modules     : undefined
    const permissions = this._permissions.length > 0 ? this._permissions : undefined
    const nav         = this._nav.length         > 0 ? this._nav         : undefined
    return {
      name,
      requires,
      modules,
      permissions,
      nav,
      install:  undefined,
      request:  async (ctx) => {
        logger.debug('request', { plugin: name })
        return { ...ctx, ...await fn(ctx) }
      },
      teardown: undefined,
    }
  }

  // Full control — install + request + teardown.
  build(def: {
    install?:  (hooks: HookExecutor) => Promise<void> | void
    request:   (ctx: BaseCtx) => Promise<TAdd> | TAdd
    teardown?: () => Promise<void> | void
  }): Plugin<BaseCtx, TAdd> {
    const logger      = createMinimalLogger(`plugin:${this._name}`, this._options.log)
    const name        = this._name
    const requires    = this._requires.length    > 0 ? this._requires    : undefined
    const modules     = this._modules.length     > 0 ? this._modules     : undefined
    const permissions = this._permissions.length > 0 ? this._permissions : undefined
    const nav         = this._nav.length         > 0 ? this._nav         : undefined
    return {
      name,
      requires,
      modules,
      permissions,
      nav,
      install:  def.install,
      request:  async (ctx) => {
        logger.debug('request', { plugin: name })
        return { ...ctx, ...await def.request(ctx) }
      },
      teardown: def.teardown,
    }
  }
}

/**
 * definePlugin — creates a named plugin that extends the request context.
 *
 * @param name  Unique plugin name. Used for deduplication — a plugin with the same
 *              name is installed at most once per app instance.
 *
 * @example
 * const tenantPlugin = definePlugin<{ tenantId: string }>('tenant')
 *   .request((ctx) => ({ tenantId: ctx.req.headers.get('x-tenant-id') ?? 'default' }))
 *   .build()
 * app.plugin(tenantPlugin)
 */
export function definePlugin<TAdd extends object = object>(
  name: string,
): PluginBuilder<TAdd> {
  return new PluginBuilder<TAdd>(name)
}

// createPlugin — factory helper that merges TAdd into ctx internally.
// The user-supplied request() only needs to return TAdd (not { ...ctx, ...TAdd }).
// The framework spreads ctx internally so user code stays clean.
// @deprecated Use definePlugin() for the fluent builder API.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createPlugin<TAdd extends object>(
  name: string,
  definition: {
    install?:  () => Promise<void> | void
    request:   (ctx: BaseCtx) => Promise<TAdd> | TAdd
    teardown?: () => Promise<void> | void
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): () => Plugin<any, TAdd> {
  return () => ({
    name,
    install:  definition.install ? () => definition.install!() : undefined,
    request:  async (ctx) => ({ ...ctx, ...await definition.request(ctx) }),
    teardown: definition.teardown,
  })
}

// loggerPlugin — adds ctx.logger
// Generic over TCtx so it composes correctly in a plugin chain that already has other fields.
export function loggerPlugin<TCtx extends BaseCtx>(): Plugin<TCtx, { logger: Logger }> {
  const logger: Logger = {
    info:  (msg, ...args) => console.log(`[INFO]  ${msg}`, ...args),
    warn:  (msg, ...args) => console.warn(`[WARN]  ${msg}`, ...args),
    error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
    debug: (msg, ...args) => console.log(`[DEBUG] ${msg}`, ...args),
  }
  return {
    name: 'logger',
    request: (ctx) => ({ ...ctx, logger }),
  }
}

// eventBusPlugin — adds ctx.events
// IMPORTANT: register BEFORE dbPlugin — withCtx(ctx) in dbPlugin snapshots the ctx at
// request time, so ctx.events must already be present for module hooks to access it.
//
// Calling with no argument auto-creates an EventBus. Access it via plugin.bus:
//   const eventsPlugin = eventBusPlugin()
//   app.plugin(eventsPlugin)
//   eventsPlugin.bus.on('user.created', handler)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function eventBusPlugin(bus?: EventBus): Plugin<any, { events: EventBus }> & { bus: EventBus } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const resolvedBus: EventBus = bus ?? new (require('../events/index') as typeof import('../events/index')).EventBus()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plugin: Plugin<any, { events: EventBus }> & { bus: EventBus } = {
    name: 'eventBus',
    bus: resolvedBus,
    request: (ctx) => ({ ...ctx, events: resolvedBus }),
  }
  return plugin
}

// ── DbPluginConfig — declarative adapter creation ─────────────────────────────

export type DbPluginConfig = AdapterConfig | VelnAdapter

export interface DbLogOptions {
  /** Whether query logging is enabled. Default: false. */
  enabled: boolean
  /** Emit a warning for queries that exceed this threshold in milliseconds. */
  slowQueryMs?: number
  /** Log level used for query logging. Default: 'debug'. */
  level?: 'debug' | 'info' | 'warn'
  /** Custom per-query callback. Receives the full QueryLogEntry for each query. */
  onQuery?: (entry: import('../adapter/types').QueryLogEntry) => void
}

// dbPlugin — adds ctx.db as a BoundVelnDB scoped to the request ctx.
// The HookExecutor is NOT created here — it is received from the app via install(hooks).
// This ensures module hook registrations (app.register()) and DB operations share the same executor.
// IMPORTANT: register AFTER eventBusPlugin/loggerPlugin — withCtx(ctx) snapshots the full
// ctx at request time, so ctx.events and ctx.logger must already be on ctx before db binds.
export function dbPlugin<TCtx extends BaseCtx>(
  config: DbPluginConfig,
  log?: DbLogOptions,
): Plugin<TCtx, { db: BoundVelnDB }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { VelnDB } = require('../db/index') as typeof import('../db/index')
  let velnDB: InstanceType<typeof import('../db/index').VelnDB> | null = null

  // Build a global onQuery handler if logging is enabled.
  // This is set once on the adapter and called for every query across all requests.
  // For per-request handling (slow query logging, query counters), see BoundVelnDB.
  let globalOnQuery: ((entry: import('../adapter/types').QueryLogEntry) => void) | undefined
  if (log?.enabled) {
    const slowMs  = log.slowQueryMs
    const level   = log.level ?? 'debug'
    const custom  = log.onQuery
    globalOnQuery = (entry) => {
      const prefix = `[veln:db] ${entry.type} (${entry.durationMs.toFixed(2)}ms)`
      if (slowMs !== undefined && entry.durationMs >= slowMs) {
        console.warn(`[veln:db] SLOW QUERY (${entry.durationMs.toFixed(2)}ms): ${entry.sql}`)
      } else {
        if (level === 'info')  console.log(`${prefix} ${entry.sql}`)
        else if (level === 'warn') console.warn(`${prefix} ${entry.sql}`)
        else console.debug(`${prefix} ${entry.sql}`)
      }
      custom?.(entry)
    }
  } else if (log?.onQuery) {
    // enabled is false but a custom handler was supplied — wire it anyway
    globalOnQuery = log.onQuery
  }

  return {
    name: 'db',
    install: (hooks) => {
      const adapter = resolveAdapterConfig(config)
      if (globalOnQuery) adapter.onQuery = globalOnQuery
      hooks.setAdapter(adapter)
      velnDB = new VelnDB(adapter, hooks)
    },
    request: (ctx) => {
      if (!velnDB) throw new Error('[veln] dbPlugin not installed — call app.plugin(dbPlugin(...)) before fetch()')
      // Read the per-request QueryLog injected by fetch() via ctx._queryLog.
      // When N+1 detection is enabled, fetch() creates a QueryLog and attaches it
      // to the base ctx before plugins run. dbPlugin reads it here and passes it
      // to BoundVelnDB so each query increments the log's counters.
      const queryLog = (ctx as unknown as Record<string, unknown>)['_queryLog'] as
        import('../db/index').QueryLog | undefined
      return { ...ctx, db: velnDB.withCtx(ctx, ctx._requestQueue, queryLog) }
    },
  }
}
