import type { VelnAdapter } from '../adapter/types'
import type { TableDef } from '../schema/table'
import type { ModuleHookHandlers } from './types'
import type { RequestEventQueue } from '../events/index'

// ── BEFORE (executor.ts ~line 93-95):
// Automatic event firing — immediate, fire & forget:
//   if (table.events.afterInsert) {
//     this.eventBus?._emit(table.events.afterInsert, result, ctx)
//   }
//
// ── AFTER (executor.ts ~line 93-95):
// Collect into per-request queue — flushed by fetch() after onResponse:
//   if (table.events.afterInsert) {
//     queue?.collect(table.events.afterInsert, result)
//   }

export class HookExecutor {
  // tableName → ordered array of module-level handlers
  private readonly registry = new Map<string, ModuleHookHandlers<any, any>[]>()

  // Set by dbPlugin at install() — used by app.register() to build audit closures.
  // undefined until dbPlugin installs (no-DB apps never set this).
  private _adapter?: VelnAdapter

  // No EventBus held globally — queue is passed per runAfterX call
  constructor() {}

  setAdapter(adapter: VelnAdapter): void {
    this._adapter = adapter
  }

  getAdapter(): VelnAdapter | undefined {
    return this._adapter
  }

  // Called by defineModule when a .hook() is registered
  registerModuleHook<T, TCtx>(
    tableName: string,
    handlers: ModuleHookHandlers<T, TCtx>,
  ): void {
    if (!this.registry.has(tableName)) this.registry.set(tableName, [])
    this.registry.get(tableName)!.push(handlers)
  }

  // ── Before operations — can transform data, can throw to cancel ──

  async runBeforeInsert<T>(
    table: TableDef<T>,
    ctx: unknown,
    data: Partial<T>,
  ): Promise<Partial<T>> {
    let current = { ...data }

    // 1. Table-level (no ctx)
    for (const h of table.hooks) {
      if (!h.beforeInsert) continue
      const result = await h.beforeInsert(current)
      if (result != null) current = result as Partial<T>
    }

    // 2. Module-level (ctx-aware)
    for (const h of this._moduleHandlers(table.name)) {
      if (!h.beforeInsert) continue
      const result = await h.beforeInsert(ctx, current)
      if (result != null) current = result as Partial<T>
    }

    return current
  }

  async runBeforeUpdate<T>(
    table: TableDef<T>,
    ctx: unknown,
    current: T,
    patch: Partial<T>,
  ): Promise<Partial<T>> {
    let currentPatch = { ...patch }

    for (const h of table.hooks) {
      if (!h.beforeUpdate) continue
      const result = await h.beforeUpdate(current, currentPatch)
      if (result != null) currentPatch = result as Partial<T>
    }

    for (const h of this._moduleHandlers(table.name)) {
      if (!h.beforeUpdate) continue
      const result = await h.beforeUpdate(ctx, current, currentPatch)
      if (result != null) currentPatch = result as Partial<T>
    }

    return currentPatch
  }

  async runBeforeDelete<T>(table: TableDef<T>, ctx: unknown, current: T): Promise<void> {
    for (const h of table.hooks) {
      if (h.beforeDelete) await h.beforeDelete(current)
    }
    for (const h of this._moduleHandlers(table.name)) {
      if (h.beforeDelete) await h.beforeDelete(ctx, current)
    }
  }

  // ── After operations — side effects only, cannot cancel ──
  // queue: per-request RequestEventQueue, or undefined when called outside HTTP context.
  // When undefined (e.g. background jobs, tests, Phase 2 direct usage), events are dropped.

  async runAfterInsert<T>(
    table: TableDef<T>,
    ctx: unknown,
    result: T,
    input: Partial<T>,
    queue?: RequestEventQueue,
  ): Promise<void> {
    for (const h of table.hooks) {
      if (h.afterInsert) await h.afterInsert(result, input)
    }
    for (const h of this._moduleHandlers(table.name)) {
      if (h.afterInsert) await h.afterInsert(ctx, result, input)
    }
    // Collect event into request queue — flushed after onResponse, never immediately
    if (table.events.afterInsert) {
      queue?.collect(table.events.afterInsert, result)
    }
  }

  async runAfterUpdate<T>(
    table: TableDef<T>,
    ctx: unknown,
    result: T,
    before: T,
    queue?: RequestEventQueue,
  ): Promise<void> {
    for (const h of table.hooks) {
      if (h.afterUpdate) await h.afterUpdate(result, before)
    }
    for (const h of this._moduleHandlers(table.name)) {
      if (h.afterUpdate) await h.afterUpdate(ctx, result, before)
    }
    // Collect event into request queue — flushed after onResponse, never immediately
    if (table.events.afterUpdate) {
      queue?.collect(table.events.afterUpdate, { before, after: result })
    }
  }

  async runAfterDelete<T>(
    table: TableDef<T>,
    ctx: unknown,
    deleted: T,
    queue?: RequestEventQueue,
  ): Promise<void> {
    for (const h of table.hooks) {
      if (h.afterDelete) await h.afterDelete(deleted)
    }
    for (const h of this._moduleHandlers(table.name)) {
      if (h.afterDelete) await h.afterDelete(ctx, deleted)
    }
    // Collect event into request queue — flushed after onResponse, never immediately
    if (table.events.afterDelete) {
      queue?.collect(table.events.afterDelete, deleted)
    }
  }

  private _moduleHandlers(tableName: string): ModuleHookHandlers<any, any>[] {
    return this.registry.get(tableName) ?? []
  }
}
