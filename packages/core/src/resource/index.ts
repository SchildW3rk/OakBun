import type { ZodTypeAny } from 'zod'
import type { TableDef, SchemaMap, InferRow, InferInsert } from '../schema/table'
import type { BoundOakBunDB } from '../db/index'
import type { BaseCtx, BaseOptions } from '../app/types'
import type { Guard, ErrorHandler, OnRequestHook, OnBeforeHandleHook, OnResponseHook } from '../app/types'
import type { Plugin } from '../app/plugin'
import type { AuditConfig } from '../schema/audit'
import type { ModuleHookHandlers } from '../hooks/types'
import type { ServiceDef } from '../service/index'
import type { EventHandlerDef } from '../events/handler'
import { defineModel } from '../model/index'
import { defineService } from '../service/index'
import { ModuleBuilder, defineModule } from '../app/module'
import type { OakBunModule } from '../app/module'
import { tableToZodInsert, tableToZodRow } from './zod-table'
import { NotFoundError } from './errors'

export { NotFoundError, ConflictError } from './errors'
export { tableToZodInsert, tableToZodRow } from './zod-table'

// ── Types ─────────────────────────────────────────────────────────────────────

type ResourceServiceKey<TName extends string> = `${TName}Resource`

// ── Default model methods ─────────────────────────────────────────────────────
// These are the methods the built-in model exposes by default.
// User can override any via ResourceOptions.model.

export interface DefaultModelMethods<TRow, TInsert> {
  index():                          Promise<TRow[]>
  show(id: number):                 Promise<TRow>
  store(data: TInsert):             Promise<TRow>
  update(id: number, data: Partial<TInsert>): Promise<TRow>
  destroy(id: number):              Promise<void>
}

// ResourceOptions.model — user provides (db, ...args) => result for each method override,
// plus any new methods they want to add.
// Each override replaces the default implementation entirely.
export interface ModelOverrides<TRow, TInsert> {
  index?:   (db: BoundOakBunDB) => () => Promise<TRow[]>
  show?:    (db: BoundOakBunDB) => (id: number) => Promise<TRow>
  store?:   (db: BoundOakBunDB) => (data: TInsert) => Promise<TRow>
  update?:  (db: BoundOakBunDB) => (id: number, data: Partial<TInsert>) => Promise<TRow>
  destroy?: (db: BoundOakBunDB) => (id: number) => Promise<void>
  // Extra methods — any signature
  [key: string]: ((db: BoundOakBunDB) => (...args: never[]) => unknown) | undefined
}

// ServiceOverrides — user provides ({ model }, ...args) => result for each CRUD method.
// model includes all default + custom model methods.
export type ServiceOverrides<TModel, TRow, TInsert> = {
  index?:   (deps: { model: TModel }) => () => Promise<TRow[]>
  show?:    (deps: { model: TModel }) => (id: number) => Promise<TRow>
  store?:   (deps: { model: TModel }) => (data: TInsert) => Promise<TRow>
  update?:  (deps: { model: TModel }) => (id: number, data: Partial<TInsert>) => Promise<TRow>
  destroy?: (deps: { model: TModel }) => (id: number) => Promise<void>
}

// RouteConfig — per-route options
export type RouteConfig = {
  guard?:   Guard<BaseCtx>
  summary?: string
} | false

export interface ResourceOptions<TRow, TInsert> {
  prefix?:  string
  model?:   ModelOverrides<TRow, TInsert>
  service?: ServiceOverrides<DefaultModelMethods<TRow, TInsert> & Record<string, unknown>, TRow, TInsert>
  routes?: {
    index?:   RouteConfig
    show?:    RouteConfig
    store?:   RouteConfig
    update?:  RouteConfig
    destroy?: RouteConfig
  }
}

// ── buildResourceModel ────────────────────────────────────────────────────────

function buildResourceModel<T, S extends SchemaMap>(
  table: TableDef<T, S>,
  overrides: ModelOverrides<InferRow<TableDef<T, S>>, InferInsert<TableDef<T, S>>>,
) {
  type TRow    = InferRow<TableDef<T, S>>
  type TInsert = InferInsert<TableDef<T, S>>

  const modelName = `${table.name}Model` as const

  return defineModel(modelName, table, (db) => {
    const pk = table.primaryKey as keyof TRow & string

    const index = overrides.index
      ? overrides.index(db)
      : () => db.from(table).select() as Promise<TRow[]>

    const show = overrides.show
      ? overrides.show(db)
      : async (id: number): Promise<TRow> => {
          const row = await (db.from(table).where({ [pk]: id } as Partial<TRow>).first() as Promise<TRow | null>)
          if (!row) throw new NotFoundError(`${table.name} with id ${id} not found`)
          return row
        }

    const store = overrides.store
      ? overrides.store(db)
      : (data: TInsert) => (db.into(table) as { insert(d: unknown): Promise<TRow> }).insert(data)

    const update = overrides.update
      ? overrides.update(db)
      : async (id: number, data: Partial<TInsert>): Promise<TRow> => {
          await show(id) // throws NotFoundError if missing
          await db.from(table).where({ [pk]: id } as Partial<TRow>).update(data as Partial<TRow>)
          return show(id)
        }

    const destroy = overrides.destroy
      ? overrides.destroy(db)
      : async (id: number): Promise<void> => {
          await show(id) // throws NotFoundError if missing
          await db.from(table).where({ [pk]: id } as Partial<TRow>).delete()
        }

    // Build base methods
    const methods: Record<string, unknown> = { index, show, store, update, destroy }

    // Add any extra methods from overrides
    for (const [key, factory] of Object.entries(overrides)) {
      if (!['index', 'show', 'store', 'update', 'destroy'].includes(key) && factory) {
        methods[key] = factory(db)
      }
    }

    return methods as DefaultModelMethods<TRow, TInsert> & Record<string, unknown>
  })
}

// ── buildResourceService ──────────────────────────────────────────────────────

type AnyModel = DefaultModelMethods<unknown, unknown> & Record<string, unknown>

function buildResourceService<T, S extends SchemaMap>(
  table: TableDef<T, S>,
  modelDef: ReturnType<typeof buildResourceModel<T, S>>,
  serviceOverrides: ServiceOverrides<AnyModel, InferRow<TableDef<T, S>>, InferInsert<TableDef<T, S>>>,
): ServiceDef<ResourceServiceKey<string>, DefaultModelMethods<InferRow<TableDef<T, S>>, InferInsert<TableDef<T, S>>>> {
  type TRow    = InferRow<TableDef<T, S>>
  type TInsert = InferInsert<TableDef<T, S>>

  const serviceKey = `${table.name}Resource` as ResourceServiceKey<string>
  const modelName  = modelDef._modelName

  return defineService(serviceKey)
    .use(modelDef)
    .define((deps) => {
      const model = (deps as Record<string, AnyModel>)[modelName]

      const index   = serviceOverrides.index   ? serviceOverrides.index({ model })   : () => model.index() as Promise<TRow[]>
      const show    = serviceOverrides.show    ? serviceOverrides.show({ model })    : (id: number) => model.show(id) as Promise<TRow>
      const store   = serviceOverrides.store   ? serviceOverrides.store({ model })   : (data: TInsert) => model.store(data) as Promise<TRow>
      const update  = serviceOverrides.update  ? serviceOverrides.update({ model })  : (id: number, data: Partial<TInsert>) => model.update(id, data) as Promise<TRow>
      const destroy = serviceOverrides.destroy ? serviceOverrides.destroy({ model }) : (id: number) => model.destroy(id) as Promise<void>

      return { index, show, store, update, destroy }
    }) as ServiceDef<ResourceServiceKey<string>, DefaultModelMethods<TRow, TInsert>>
}

// ── buildResourceModule ───────────────────────────────────────────────────────

function buildResourceModule<T, S extends SchemaMap>(
  prefix: string,
  table: TableDef<T, S>,
  serviceDef: ServiceDef<ResourceServiceKey<string>, DefaultModelMethods<InferRow<TableDef<T, S>>, InferInsert<TableDef<T, S>>>>,
  routeOptions: ResourceOptions<InferRow<TableDef<T, S>>, InferInsert<TableDef<T, S>>>['routes'],
): ModuleBuilder<BaseCtx> {
  const serviceKey = serviceDef._serviceKey
  const routes     = routeOptions ?? {}

  const insertSchema = tableToZodInsert(table)
  const rowSchema    = tableToZodRow(table)

  type Svc = DefaultModelMethods<InferRow<TableDef<T, S>>, InferInsert<TableDef<T, S>>>
  type Ctx = BaseCtx & Record<typeof serviceKey, Svc>

  let builder = defineModule(prefix).use(serviceDef) as unknown as ModuleBuilder<Ctx>

  function getSvc(ctx: Ctx): Svc {
    return (ctx as Record<string, unknown>)[serviceKey] as Svc
  }

  // GET / — index
  if (routes.index !== false) {
    const cfg = routes.index ?? {}
    let b = builder
    if (cfg && cfg.guard) b = b.guard(cfg.guard as Guard<Ctx>)
    b = b.route({
      method:  'GET',
      path:    '/',
      summary: (cfg && cfg.summary) ? cfg.summary : `List ${table.name}`,
      handler: async (ctx) => ctx.json(await getSvc(ctx).index()),
    })
    builder = b
  }

  // GET /:id — show
  if (routes.show !== false) {
    const cfg = routes.show ?? {}
    let b = builder
    if (cfg && cfg.guard) b = b.guard(cfg.guard as Guard<Ctx>)
    b = b.route({
      method:  'GET',
      path:    '/:id',
      summary: (cfg && cfg.summary) ? cfg.summary : `Get ${table.name} by id`,
      handler: async (ctx) => ctx.json(await getSvc(ctx).show(Number(ctx.params['id']))),
    })
    builder = b
  }

  // POST / — store
  if (routes.store !== false) {
    const cfg = routes.store ?? {}
    let b = builder
    if (cfg && cfg.guard) b = b.guard(cfg.guard as Guard<Ctx>)
    b = b.route({
      method:  'POST',
      path:    '/',
      summary: (cfg && cfg.summary) ? cfg.summary : `Create ${table.name}`,
      schema:  { body: insertSchema, response: rowSchema },
      handler: async (ctx) => ctx.json(await getSvc(ctx).store((ctx as Ctx & { body: InferInsert<TableDef<T, S>> }).body), 201),
    })
    builder = b
  }

  // PATCH /:id — update
  if (routes.update !== false) {
    const cfg = routes.update ?? {}
    let b = builder
    if (cfg && cfg.guard) b = b.guard(cfg.guard as Guard<Ctx>)
    b = b.route({
      method:  'PATCH',
      path:    '/:id',
      summary: (cfg && cfg.summary) ? cfg.summary : `Update ${table.name}`,
      schema:  { body: insertSchema.partial() },
      handler: async (ctx) => {
        const row = await getSvc(ctx).update(
          Number(ctx.params['id']),
          (ctx as Ctx & { body: Partial<InferInsert<TableDef<T, S>>> }).body,
        )
        return ctx.json(row)
      },
    })
    builder = b
  }

  // DELETE /:id — destroy
  if (routes.destroy !== false) {
    const cfg = routes.destroy ?? {}
    let b = builder
    if (cfg && cfg.guard) b = b.guard(cfg.guard as Guard<Ctx>)
    b = b.route({
      method:  'DELETE',
      path:    '/:id',
      summary: (cfg && cfg.summary) ? cfg.summary : `Delete ${table.name}`,
      handler: async (ctx) => {
        await getSvc(ctx).destroy(Number(ctx.params['id']))
        return ctx.json({ ok: true })
      },
    })
    builder = b
  }

  return builder as unknown as ModuleBuilder<BaseCtx>
}

// ── ResourceResult ────────────────────────────────────────────────────────────

export interface ResourceResult<T, S extends SchemaMap> {
  Model:   ReturnType<typeof buildResourceModel<T, S>>
  Service: ServiceDef<ResourceServiceKey<string>, DefaultModelMethods<InferRow<TableDef<T, S>>, InferInsert<TableDef<T, S>>>>
  module:  OakBunModule
}

// ── ResourceBuilder ───────────────────────────────────────────────────────────

export class ResourceBuilder<TCtx extends BaseCtx, T, S extends SchemaMap> {
  private constructor(
    private readonly _table:   TableDef<T, S>,
    private readonly _options: ResourceOptions<InferRow<TableDef<T, S>>, InferInsert<TableDef<T, S>>>,
    private readonly _builderFns: Array<(b: ModuleBuilder<BaseCtx>) => ModuleBuilder<BaseCtx>>,
  ) {}

  static create<T, S extends SchemaMap>(
    table:   TableDef<T, S>,
    options: ResourceOptions<InferRow<TableDef<T, S>>, InferInsert<TableDef<T, S>>>,
  ): ResourceBuilder<BaseCtx, T, S> {
    return new ResourceBuilder<BaseCtx, T, S>(table, options, [])
  }

  // ── Delegate to ModuleBuilder ─────────────────────────────────────────────

  options(opts: BaseOptions): ResourceBuilder<TCtx, T, S> {
    return new ResourceBuilder<TCtx, T, S>(
      this._table,
      this._options,
      [...this._builderFns, (b) => b.options(opts)],
    )
  }

  plugin<TAdd extends object>(p: Plugin<TCtx, TAdd>): ResourceBuilder<TCtx & TAdd, T, S> {
    return new ResourceBuilder<TCtx & TAdd, T, S>(
      this._table,
      this._options,
      [...this._builderFns, (b) => (b as ModuleBuilder<BaseCtx>).plugin(p as unknown as Plugin<BaseCtx, TAdd>) as unknown as ModuleBuilder<BaseCtx>],
    )
  }

  guard(g: Guard<TCtx>): ResourceBuilder<TCtx, T, S> {
    return new ResourceBuilder<TCtx, T, S>(
      this._table,
      this._options,
      [...this._builderFns, (b) => b.guard(g as Guard<BaseCtx>)],
    )
  }

  hook(table: TableDef<T, S>, handlers: ModuleHookHandlers<T, TCtx>): ResourceBuilder<TCtx, T, S> {
    return new ResourceBuilder<TCtx, T, S>(
      this._table,
      this._options,
      [...this._builderFns, (b) => b.hook(table, handlers as ModuleHookHandlers<T, BaseCtx>)],
    )
  }

  audit<AT extends Record<string, unknown>, AS extends SchemaMap>(
    auditTable: TableDef<AT, AS>,
    config: AuditConfig<TCtx, AT, AS>,
  ): ResourceBuilder<TCtx, T, S> {
    return new ResourceBuilder<TCtx, T, S>(
      this._table,
      this._options,
      [...this._builderFns, (b) => b.audit(auditTable, config as AuditConfig<BaseCtx, AT, AS>)],
    )
  }

  use<TKey extends string, TDef>(
    service: ServiceDef<TKey, TDef>,
  ): ResourceBuilder<TCtx & Record<TKey, TDef>, T, S> {
    return new ResourceBuilder<TCtx & Record<TKey, TDef>, T, S>(
      this._table,
      this._options,
      [...this._builderFns, (b) => b.use(service) as ModuleBuilder<BaseCtx>],
    )
  }

  onRequest(hook: OnRequestHook<TCtx>): ResourceBuilder<TCtx, T, S> {
    return new ResourceBuilder<TCtx, T, S>(
      this._table,
      this._options,
      [...this._builderFns, (b) => b.onRequest(hook as OnRequestHook<BaseCtx>)],
    )
  }

  onBeforeHandle(hook: OnBeforeHandleHook<TCtx>): ResourceBuilder<TCtx, T, S> {
    return new ResourceBuilder<TCtx, T, S>(
      this._table,
      this._options,
      [...this._builderFns, (b) => b.onBeforeHandle(hook as OnBeforeHandleHook<BaseCtx>)],
    )
  }

  onResponse(hook: OnResponseHook<TCtx>): ResourceBuilder<TCtx, T, S> {
    return new ResourceBuilder<TCtx, T, S>(
      this._table,
      this._options,
      [...this._builderFns, (b) => b.onResponse(hook as OnResponseHook<BaseCtx>)],
    )
  }

  onError(handler: ErrorHandler<TCtx>): ResourceBuilder<TCtx, T, S> {
    return new ResourceBuilder<TCtx, T, S>(
      this._table,
      this._options,
      [...this._builderFns, (b) => b.onError(handler as ErrorHandler<BaseCtx>)],
    )
  }

  events(handler: EventHandlerDef): ResourceBuilder<TCtx, T, S> {
    return new ResourceBuilder<TCtx, T, S>(
      this._table,
      this._options,
      [...this._builderFns, (b) => b.events(handler)],
    )
  }

  // ── .build() ─────────────────────────────────────────────────────────────

  build(): ResourceResult<T, S> {
    const prefix = this._options.prefix ?? `/${this._table.name}`
    const Model   = buildResourceModel(this._table, this._options.model ?? {})
    const Service = buildResourceService(this._table, Model, (this._options.service ?? {}) as ServiceOverrides<AnyModel, InferRow<TableDef<T, S>>, InferInsert<TableDef<T, S>>>)
    let moduleBuilder = buildResourceModule(prefix, this._table, Service, this._options.routes)
    for (const fn of this._builderFns) {
      moduleBuilder = fn(moduleBuilder)
    }
    const module = moduleBuilder.build()
    return { Model, Service, module }
  }
}

// ── defineResource — entry point ─────────────────────────────────────────────

/**
 * defineResource — generates CRUD routes, a Model, and a Service from a table definition.
 *
 * @param table   The table definition produced by `defineTable(...).build()`.
 * @param options Route prefix string or `ResourceOptions` for customization.
 *
 * @example
 * const { module } = defineResource(usersTable, '/users').build()
 * app.register(module)
 */
export function defineResource<T, S extends SchemaMap>(
  table:   TableDef<T, S>,
  options: ResourceOptions<InferRow<TableDef<T, S>>, InferInsert<TableDef<T, S>>> | string = {},
): ResourceBuilder<BaseCtx, T, S> {
  // Convenience: if options is a string, treat it as the prefix
  const opts: ResourceOptions<InferRow<TableDef<T, S>>, InferInsert<TableDef<T, S>>> =
    typeof options === 'string' ? { prefix: options } : options
  return ResourceBuilder.create(table, opts)
}
