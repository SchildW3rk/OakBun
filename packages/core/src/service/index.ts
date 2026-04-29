import type { BoundOakBunDB } from '../db/index'
import type { ModelDef, ModelInstance } from '../model/index'
import type { BaseOptions } from '../app/types'
import { createMinimalLogger } from '../app/logger'

// ── Dep union — accepted by ServiceBuilder.use() ──────────────────────────

// A dependency is a ModelDef or ServiceDef.
export type Dep<TKey extends string, TDef> =
  | ModelDef<TKey, TDef>
  | ServiceDef<TKey, TDef>

// Helper — extract the key from any Dep kind
type DepKey<D>  = D extends ModelDef<infer K, unknown>  ? K
                : D extends ServiceDef<infer K, unknown> ? K
                : never

// Helper — extract the instance type from any Dep kind
type DepInst<D> = D extends ModelDef<string, infer T>   ? ModelInstance<T>
                : D extends ServiceDef<string, infer T>  ? T
                : never

// ── ServiceDef ─────────────────────────────────────────────────────────────

export interface ServiceDef<TKey extends string, TDef> {
  readonly _serviceKey: TKey
  readonly _deps:       ReadonlyArray<Dep<string, unknown>>
  readonly _options:    BaseOptions
  readonly _factory:    (deps: Record<string, unknown>) => TDef
}

// ── ServiceBuilder ─────────────────────────────────────────────────────────

export class ServiceBuilder<TKey extends string, TDeps extends Record<string, unknown>> {
  private constructor(
    private readonly _key:  TKey,
    private readonly _deps: ReadonlyArray<Dep<string, unknown>>,
    private readonly _opts: BaseOptions,
  ) {}

  static create<TKey extends string>(key: TKey): ServiceBuilder<TKey, Record<never, never>> {
    return new ServiceBuilder<TKey, Record<never, never>>(key, [], {})
  }

  use<TDep extends Dep<string, unknown>>(
    dep: TDep,
  ): ServiceBuilder<TKey, TDeps & Record<DepKey<TDep>, DepInst<TDep>>> {
    return new ServiceBuilder<TKey, TDeps & Record<DepKey<TDep>, DepInst<TDep>>>(
      this._key,
      [...this._deps, dep as Dep<string, unknown>],
      this._opts,
    )
  }

  options(opts: BaseOptions): ServiceBuilder<TKey, TDeps> {
    return new ServiceBuilder<TKey, TDeps>(
      this._key,
      this._deps,
      opts,
    )
  }

  define<TDef>(
    factory: (deps: TDeps & Record<'logger', import('../app/types').Logger>) => TDef,
  ): ServiceDef<TKey, TDef> {
    return {
      _serviceKey: this._key,
      _deps:       this._deps,
      _options:    this._opts,
      _factory:    factory as (deps: Record<string, unknown>) => TDef,
    }
  }
}

export function defineService<TKey extends string>(
  key: TKey,
): ServiceBuilder<TKey, Record<never, never>> {
  return ServiceBuilder.create(key)
}

// ── Per-request instantiation helpers ────────────────────────────────────
// Used by the framework in fetch() — not exported from core public API.

// isModelDef — runtime discriminator
function isModelDef(dep: Dep<string, unknown>): dep is ModelDef<string, unknown> {
  return '_modelName' in dep
}

// isServiceDef — runtime discriminator
function isServiceDef(dep: Dep<string, unknown>): dep is ServiceDef<string, unknown> {
  return '_serviceKey' in dep
}

// detectCircular — throws if any cycle exists in the dep graph.
// Called once at startup (first fetch). O(V+E).
export function detectCircular(services: ReadonlyArray<ServiceDef<string, unknown>>): void {
  // Build a name → ServiceDef map transitively — includes nested service deps,
  // not just the top-level services passed in.
  const byKey = new Map<string, ServiceDef<string, unknown>>()

  function collectAll(svc: ServiceDef<string, unknown>): void {
    if (byKey.has(svc._serviceKey)) return
    byKey.set(svc._serviceKey, svc)
    for (const dep of svc._deps) {
      if (isServiceDef(dep)) {
        collectAll(dep)
      }
    }
  }

  for (const svc of services) {
    collectAll(svc)
  }

  // DFS with three-color marking: 0=unvisited, 1=in-stack, 2=done
  const state = new Map<string, 0 | 1 | 2>()

  function visit(key: string, stack: string[]): void {
    const s = state.get(key) ?? 0
    if (s === 2) return
    if (s === 1) {
      const cycle = [...stack, key].join(' → ')
      throw new Error(`[oakbun] Circular dependency detected: ${cycle}`)
    }
    state.set(key, 1)
    const svc = byKey.get(key)
    if (svc) {
      for (const dep of svc._deps) {
        if (isServiceDef(dep)) {
          visit(dep._serviceKey, [...stack, key])
        }
      }
    }
    state.set(key, 2)
  }

  for (const svc of byKey.values()) {
    visit(svc._serviceKey, [])
  }
}

// instantiateServices — per-request.
// Builds all declared services (and their transitive model/service deps) with the given db.
// Returns a Record<key, instance> to be merged into ctx.
export function instantiateServices(
  services: ReadonlyArray<ServiceDef<string, unknown>>,
  db: BoundOakBunDB,
): Record<string, unknown> {
  // Cache within this request — each dep key instantiated at most once
  const cache = new Map<string, unknown>()

  function instantiateDep(dep: Dep<string, unknown>, ownerKey: string): unknown {
    if (isModelDef(dep)) {
      const key = dep._modelName
      if (cache.has(key)) return cache.get(key)
      const inst = dep._factory(db)
      cache.set(key, inst)
      return inst
    }
    if (isServiceDef(dep)) {
      const key = dep._serviceKey
      if (cache.has(key)) return cache.get(key)
      const resolvedDeps: Record<string, unknown> = {}
      // Always inject logger for the service being instantiated
      const logger = createMinimalLogger(`service:${key}`, dep._options?.log)
      resolvedDeps['logger'] = logger
      for (const d of dep._deps) {
        const depKey = isModelDef(d) ? d._modelName : d._serviceKey
        resolvedDeps[depKey] = instantiateDep(d, key)
      }
      const inst = dep._factory(resolvedDeps)
      cache.set(key, inst)
      return inst
    }
    throw new Error(`[oakbun] Unknown dependency type in service '${ownerKey}'`)
  }

  const result: Record<string, unknown> = {}
  for (const svc of services) {
    result[svc._serviceKey] = instantiateDep(svc, svc._serviceKey)
  }
  return result
}
