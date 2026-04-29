---
title: "Cron Jobs"
category: "guides"
tags: ["cron", "scheduler", "background", "locking"]
related: ["defineCron", "defineService", "defineModule"]
---

# Cron Jobs

OakBun runs cron jobs inside the app process using [Croner](https://github.com/hexagon/croner). Jobs have access to `ctx.db` and injected services.

## Basic Cron Job

```ts
import { defineCron } from 'oakbun'

const cleanupCron = defineCron('cleanup', '0 3 * * *')  // daily 03:00
  .handler(async (ctx) => {
    const deleted = await ctx.db
      .from(sessionsTable)
      .where({ expiresAt: { op: '<', value: new Date() } })
      .delete()
    ctx.logger?.info('Sessions cleaned', { deleted })
  })
```

## With Service Dependencies

```ts
import { NotificationService } from './services/notification.service'

const dailyDigest = defineCron('daily-digest', '@daily', {
  timezone:   'Europe/Berlin',
  runOnStart: false,
})
  .use(NotificationService)
  .handler(async (ctx) => {
    const users = await ctx.db.from(usersTable).select()
    await ctx.notifications.sendDigest(users)
  })
```

## Registering Crons

Crons are registered on a module via `.cron()`:

```ts
const appModule = defineModule('/')
  .cron(cleanupCron)
  .cron(dailyDigest)
  .build()

app.register(appModule)
```

The crons start when `app.listen()` is called and stop when `app.close()` is called.

## Distributed Locking

For multi-instance deployments, implement `CronLockAdapter` to prevent duplicate runs:

```ts
import type { CronLockAdapter } from 'oakbun'

class RedisCronLock implements CronLockAdapter {
  constructor(private redis: Redis) {}

  async acquire(jobName: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(
      `cron:lock:${jobName}`,
      '1',
      'PX', ttlMs,
      'NX',
    )
    return result === 'OK'
  }

  async release(jobName: string): Promise<void> {
    await this.redis.del(`cron:lock:${jobName}`)
  }
}
```

Pass to `dbPlugin`:

```ts
app.plugin(dbPlugin(adapter, {
  cronLock: new RedisCronLock(redis),
}))
```

The default `NoOpCronLockAdapter` always acquires — suitable for single-instance apps.

## OS-Level Crons

Use Bun's native OS cron support:

```ts
const backupCron = defineCron('db-backup', '0 2 * * *')
  .os('./scripts/backup.sh')
```

## Graceful Shutdown

Crons stop when `app.close()` is called:

```ts
process.on('SIGTERM', async () => {
  await app.close()
  process.exit(0)
})
```

In-progress job handlers complete before shutdown.

## CronCtx

```ts
interface CronCtx {
  db:      BoundOakBunDB
  logger?: Logger
  [key: string]: unknown   // injected services
}
```

## See Also

- [defineCron](../core/08-define-cron.md)
- [defineService](../core/05-define-service.md)
- [DB Plugin](../plugins/04-db-plugin.md)
