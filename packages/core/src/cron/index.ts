import type { BoundVelnDB } from '../db/index'
import type { ServiceDef } from '../service/index'
import type { Logger, LogOptions } from '../app/types'
import { createMinimalLogger } from '../app/logger'

// ── CronCtx ───────────────────────────────────────────────────────────────────

export interface CronCtx {
  db: BoundVelnDB
  [key: string]: unknown
}

// Re-export LogLevel for consumers
export type { LogLevel } from '../app/logger'

// ── Expression Shortcuts ──────────────────────────────────────────────────────

const CRON_SHORTCUTS: Record<string, string> = {
  '@minute':   '* * * * *',
  '@hourly':   '0 * * * *',
  '@daily':    '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly':   '0 0 * * 0',
  '@monthly':  '0 0 1 * *',
  '@yearly':   '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
}

export function resolveExpression(expr: string): string {
  return CRON_SHORTCUTS[expr] ?? expr
}

// ── CronLockAdapter ───────────────────────────────────────────────────────────

/**
 * CronLockAdapter — prevents duplicate job execution across multiple instances.
 *
 * Default: NoOpCronLockAdapter (always acquires — suitable for single-instance deployments)
 *
 * For multi-instance deployments, implement this interface with Redis SET NX EX
 * or a similar distributed lock mechanism.
 *
 * WARNING: TTL must exceed the maximum expected job duration.
 * Consider implementing a lock heartbeat for long-running jobs.
 *
 * @example
 * createApp({ cronLock: new RedisCronLockAdapter(redisClient) })
 */
export interface CronLockAdapter {
  acquire(jobName: string, ttlMs: number): Promise<boolean>
  release(jobName: string): Promise<void>
}

export class NoOpCronLockAdapter implements CronLockAdapter {
  async acquire(_jobName: string, _ttlMs: number): Promise<boolean> {
    return true  // always acquire — single-process default
  }
  async release(_jobName: string): Promise<void> {
    // no-op
  }
}

// ── CronDef — sealed result, produced by CronBuilder ─────────────────────────

export interface CronDef<TServices extends Record<string, unknown> = Record<never, never>> {
  readonly _name:       string
  readonly _expression: string
  readonly _timezone:   string | undefined
  readonly _runOnStart: boolean
  readonly _ttlMs:      number | undefined
  readonly _logger:     Logger
  readonly _mode:       'process' | 'os'
  readonly _handler:    ((ctx: CronCtx & TServices, logger: Logger) => Promise<void> | void) | undefined
  readonly _services:   ReadonlyArray<ServiceDef<string, unknown>>
  readonly _script:     string | undefined
  readonly _onError:    ((err: unknown) => void) | undefined

  // .use() on a sealed CronDef is kept for backwards-compat and for app.register()
  // service-merging (which spreads + re-binds). It erases the TServices type
  // (returns CronDef without param) because merging happens at runtime, not statically.
  use<TKey extends string, TDef>(
    service: ServiceDef<TKey, TDef>,
  ): CronDef<TServices & Record<TKey, TDef>>
}

// ── CronBuildOptions — timezone / runOnStart passed to defineCron() ───────────

export interface CronBuildOptions {
  timezone?:   string
  runOnStart?: boolean
  ttlMs?:      number
  log?:        LogOptions
  onError?:    (err: unknown) => void
}

// ── CronBuilder — fluent builder returned by defineCron() ─────────────────────
// TServices accumulates via .use(). Call .handler() or .os() to seal into CronDef.

export interface CronBuilder<TServices extends Record<string, unknown>> {
  // Set timezone / runOnStart / log — returns the same builder for continued chaining
  options(opts: CronBuildOptions): CronBuilder<TServices>

  // Accumulate a service — handler will receive ctx[key] typed
  use<TKey extends string, TDef>(
    service: ServiceDef<TKey, TDef>,
  ): CronBuilder<TServices & Record<TKey, TDef>>

  // Seal into a process-mode CronDef. ctx has full TServices typing.
  // logger is always available as the 2nd arg — no-op (error level only) when log not set.
  handler(
    fn: (ctx: CronCtx & TServices, logger: Logger) => Promise<void> | void,
  ): CronDef<TServices>

  // Seal into an OS-level (Bun.cron) CronDef. No handler.
  os(script: string): CronDef<TServices>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveLogOpts(log: LogOptions | undefined): LogOptions {
  // No log configured → silent: true (suppress all output by default)
  return log ?? { silent: true }
}

// ── Internal factory ──────────────────────────────────────────────────────────

function makeCronDef<TServices extends Record<string, unknown>>(
  name:       string,
  expression: string,
  timezone:   string | undefined,
  runOnStart: boolean,
  ttlMs:      number | undefined,
  logger:     Logger,
  mode:       'process' | 'os',
  handler:    ((ctx: CronCtx & TServices, logger: Logger) => Promise<void> | void) | undefined,
  services:   ReadonlyArray<ServiceDef<string, unknown>>,
  script:     string | undefined,
  onError:    ((err: unknown) => void) | undefined,
): CronDef<TServices> {
  const def: CronDef<TServices> = {
    _name:       name,
    _expression: resolveExpression(expression),
    _timezone:   timezone,
    _runOnStart: runOnStart,
    _ttlMs:      ttlMs,
    _logger:     logger,
    _mode:       mode,
    _handler:    handler,
    _services:   services,
    _script:     script,
    _onError:    onError,

    use<TKey extends string, TDef>(
      service: ServiceDef<TKey, TDef>,
    ): CronDef<TServices & Record<TKey, TDef>> {
      return makeCronDef<TServices & Record<TKey, TDef>>(
        name, expression, timezone, runOnStart, ttlMs, logger, mode,
        handler as ((ctx: CronCtx & TServices & Record<TKey, TDef>, logger: Logger) => Promise<void> | void) | undefined,
        [...services, service as ServiceDef<string, unknown>],
        script,
        onError,
      )
    },
  }
  return def
}

function makeCronBuilder<TServices extends Record<string, unknown>>(
  name:       string,
  expression: string,
  opts:       CronBuildOptions,
  services:   ReadonlyArray<ServiceDef<string, unknown>>,
): CronBuilder<TServices> {
  return {
    options(newOpts: CronBuildOptions): CronBuilder<TServices> {
      return makeCronBuilder<TServices>(name, expression, { ...opts, ...newOpts }, services)
    },

    use<TKey extends string, TDef>(
      service: ServiceDef<TKey, TDef>,
    ): CronBuilder<TServices & Record<TKey, TDef>> {
      return makeCronBuilder<TServices & Record<TKey, TDef>>(
        name, expression, opts,
        [...services, service as ServiceDef<string, unknown>],
      )
    },

    handler(fn: (ctx: CronCtx & TServices, logger: Logger) => Promise<void> | void): CronDef<TServices> {
      const logger = createMinimalLogger(`cron:${name}`, resolveLogOpts(opts.log))
      return makeCronDef<TServices>(
        name, expression, opts.timezone, opts.runOnStart ?? false,
        opts.ttlMs, logger, 'process', fn, services, undefined, opts.onError,
      )
    },

    os(script: string): CronDef<TServices> {
      const logger = createMinimalLogger(`cron:${name}`, resolveLogOpts(opts.log))
      return makeCronDef<TServices>(
        name, expression, opts.timezone, opts.runOnStart ?? false,
        opts.ttlMs, logger, 'os', undefined, services, script, opts.onError,
      )
    },
  }
}

/**
 * defineCron — defines a scheduled background job.
 *
 * @param name        Unique job identifier. Used as lock key and in log output.
 * @param expression  Cron expression or shortcut (`@daily`, `@hourly`, `@minute`, etc.).
 * @param opts        Optional timezone, runOnStart, ttlMs (lock TTL), and log options.
 *
 * Call `.handler(fn)` to run in-process, or `.os(script)` for OS-level scheduling via Bun.
 * Chain `.use(ServiceDef)` to inject services into the handler context.
 *
 * @example
 * defineCron('cleanup', '@daily')
 *   .use(JobService)
 *   .handler(async (ctx) => { await ctx.jobService.deleteExpired() })
 */
export function defineCron(
  name:       string,
  expression: string,
  opts?:      CronBuildOptions,
): CronBuilder<Record<never, never>> {
  return makeCronBuilder<Record<never, never>>(name, expression, opts ?? {}, [])
}
