import type { BoundOakBunDB } from '../db/index'
import type { TableDef, SchemaMap } from '../schema/table'
import type { Logger, BaseOptions } from '../app/types'
import { createMinimalLogger } from '../app/logger'

// ModelInstance — the user's factory result merged with { db: BoundOakBunDB }.
// .db gives direct raw access: UserModel.db.into(usersTable).insert(...)
export type ModelInstance<TDef> = TDef & { readonly db: BoundOakBunDB }

// ModelDef — carries the name (= dep key) + factory.
// Never holds a db reference — instantiated per-request via .use().
export interface ModelDef<TName extends string, TDef> {
  readonly _modelName: TName
  readonly _factory:   (db: BoundOakBunDB) => ModelInstance<TDef>
}

// ── ModelBuilder ──────────────────────────────────────────────────────────────

export class ModelBuilder<TName extends string, TTable> {
  private _opts: BaseOptions = {}

  constructor(
    private readonly _name:  TName,
    private readonly _table: TTable,
  ) {}

  options(opts: BaseOptions): this {
    this._opts = opts
    return this
  }

  define<TDef extends object>(
    factory: (db: BoundOakBunDB, ctx: { logger: Logger }) => TDef,
  ): ModelDef<TName, TDef> {
    const name = this._name
    const opts = this._opts
    return {
      _modelName: name,
      _factory: (db: BoundOakBunDB): ModelInstance<TDef> => {
        const logger = createMinimalLogger(`model:${name}`, opts.log)
        return { ...factory(db, { logger }), db }
      },
    }
  }
}

// ── defineModel — entry point ─────────────────────────────────────────────────
//
// Two call forms:
//   Builder (new):  defineModel(name, table)
//                     .options({ log: { level: 'debug' } })
//                     .define((db, { logger }) => ({ ... }))
//
//   Direct (compat): defineModel(name, table, (db) => ({ ... }))
//                    The 3-arg form is kept for existing code. Extra { logger } arg
//                    is injected but callers that ignore it continue to work.

export function defineModel<
  TName extends string,
  TTable,
>(
  name:  TName,
  table: TTable,
): ModelBuilder<TName, TTable>

export function defineModel<
  TName extends string,
  TTable,
  TDef extends object,
>(
  name:    TName,
  table:   TTable,
  factory: (db: BoundOakBunDB, ctx: { logger: Logger }) => TDef,
): ModelDef<TName, TDef>

export function defineModel<
  TName extends string,
  TTable,
  TDef extends object,
>(
  name:     TName,
  table:    TTable,
  factory?: (db: BoundOakBunDB, ctx: { logger: Logger }) => TDef,
): ModelBuilder<TName, TTable> | ModelDef<TName, TDef> {
  if (factory !== undefined) {
    // Direct (compat) form — wrap in builder immediately
    return new ModelBuilder<TName, TTable>(name, table).define(factory)
  }
  return new ModelBuilder<TName, TTable>(name, table)
}
