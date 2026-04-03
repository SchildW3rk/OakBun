// Module-level hook handlers — ctx-aware, registered per module
export interface ModuleHookHandlers<T, TCtx = unknown> {
  beforeInsert?: (ctx: TCtx, data: Partial<T>) => Partial<T> | void | Promise<Partial<T> | void>
  afterInsert?:  (ctx: TCtx, result: T, input: Partial<T>) => void | Promise<void>
  beforeUpdate?: (ctx: TCtx, current: T, patch: Partial<T>) => Partial<T> | void | Promise<Partial<T> | void>
  afterUpdate?:  (ctx: TCtx, result: T, before: T) => void | Promise<void>
  beforeDelete?: (ctx: TCtx, current: T) => void | Promise<void>
  afterDelete?:  (ctx: TCtx, deleted: T) => void | Promise<void>
}

export type HookOperation =
  | 'beforeInsert' | 'afterInsert'
  | 'beforeUpdate' | 'afterUpdate'
  | 'beforeDelete' | 'afterDelete'
