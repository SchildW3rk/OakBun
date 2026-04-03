---
title: "defineCron"
category: "core"
tags: ["cron", "scheduler", "background", "jobs"]
related: ["defineModule", "defineService", "definePlugin"]
---

# defineCron

Defines a scheduled background job. Jobs are registered on a module via `.cron()` and started when the app begins serving.

## Signature

```ts
function defineCron(
  name: string,
  expression: string,
  options?: CronBuildOptions
): CronBuilder<Record<never, never>>
```

## Basic Example

```ts
import { defineCron } from 'oakbun'

const cleanupCron = defineCron('cleanup', '0 3 * * *')  // daily at 03:00
  .handler(async (ctx) => {
    const deleted = await ctx.db
      .from(sessionsTable)
      .where({ expiresAt: { op: '<', value: new Date() } })
      .delete()
    ctx.logger?.info('cleanup done', { deleted })
  })
```

## Full Example

```ts
import { defineCron } from 'oakbun'
import { UserService } from './services/user.service'

const statsReportCron = defineCron('stats-report', '@daily', {
  timezone: 'Europe/Berlin',
  runOnStart: true,
  log: { level: 'info' },
})
  .use(UserService)
  .handler(async (ctx) => {
    const count = await ctx.users.countAll()
    ctx.logger?.info('daily stats', { users: count })
  })
```

## Expression Shortcuts

| Shortcut | Equivalent | Description |
|---|---|---|
| `@minute` | `* * * * *` | Every minute |
| `@hourly` | `0 * * * *` | Every hour |
| `@daily` / `@midnight` | `0 0 * * *` | Daily at midnight |
| `@weekly` | `0 0 * * 0` | Weekly on Sunday |
| `@monthly` | `0 0 1 * *` | First of the month |
| `@yearly` / `@annually` | `0 0 1 1 *` | First of the year |

## CronBuildOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `timezone` | `string` | system | IANA timezone string |
| `runOnStart` | `boolean` | `false` | Run immediately when app starts |
| `ttlMs` | `number` | — | Lock TTL for distributed locking |
| `log` | `LogOptions` | — | Log level and mask |

## CronBuilder Methods

| Method | Description |
|---|---|
| `.options(opts)` | Set CronBuildOptions |
| `.use(service)` | Inject a service into the cron ctx |
| `.handler(fn)` | Provide a process-mode handler function |
| `.os(script)` | Use Bun's native OS-level cron (string script path) |

## Registering Crons

Crons are registered on a module via `.cron()`:

```ts
const appModule = defineModule('/')
  .cron(cleanupCron)
  .cron(statsReportCron)
  .build()

app.register(appModule)
```

## CronCtx

The handler receives a context with `db` and any injected services:

```ts
interface CronCtx {
  db:      BoundVelnDB
  logger?: Logger
  [key: string]: unknown   // injected services
}
```

## Distributed Locking

Implement `CronLockAdapter` to prevent duplicate runs in multi-instance deployments:

```ts
interface CronLockAdapter {
  acquire(jobName: string, ttlMs: number): Promise<boolean>
  release(jobName: string): Promise<void>
}
```

Pass to `dbPlugin`:

```ts
app.use(dbPlugin(adapter, { cronLock: myLockAdapter }))
```

The built-in `NoOpCronLockAdapter` always acquires — suitable for single-instance deployments.

## See Also

- [Cron Jobs Guide](../guides/07-cron-jobs.md)
- [defineModule](./02-define-module.md)
- [defineService](./05-define-service.md)
