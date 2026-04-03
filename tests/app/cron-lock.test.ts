import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineCron } from '../../packages/core/src/cron/index'
import { NoOpCronLockAdapter } from '../../packages/core/src/cron/index'
import type { CronLockAdapter } from '../../packages/core/src/cron/index'

// ── Helpers ───────────────────────────────────────────────────────────────────

function scheduleApp(app: ReturnType<typeof createApp>): void {
  try { app.listen(0) } catch { /* Bun.serve may throw in test env */ }
}

// ── Case 1 — NoOpCronLockAdapter always acquires ──────────────────────────────

describe('NoOpCronLockAdapter', () => {
  test('acquire always returns true', async () => {
    const lock = new NoOpCronLockAdapter()
    expect(await lock.acquire('any.job', 30_000)).toBe(true)
  })

  test('acquire returns true regardless of jobName or ttlMs', async () => {
    const lock = new NoOpCronLockAdapter()
    expect(await lock.acquire('job.a', 1_000)).toBe(true)
    expect(await lock.acquire('job.b', 60_000)).toBe(true)
    expect(await lock.acquire('job.c', 0)).toBe(true)
  })

  test('release is a no-op — does not throw', async () => {
    const lock = new NoOpCronLockAdapter()
    await expect(lock.release('any.job')).resolves.toBeUndefined()
  })
})

// ── Case 2 — Custom adapter injected via createApp({ cronLock }) ──────────────

describe('createApp({ cronLock }) — custom adapter injection', () => {
  test('acquire and release are called when job runs', async () => {
    const acquireCalls: Array<{ jobName: string; ttlMs: number }> = []
    const releaseCalls: string[] = []
    const handlerCalls: number[] = []

    const customLock: CronLockAdapter = {
      async acquire(jobName, ttlMs) {
        acquireCalls.push({ jobName, ttlMs })
        return true
      },
      async release(jobName) {
        releaseCalls.push(jobName)
      },
    }

    const def = defineCron('lock.test', '0 3 * * *', { runOnStart: true })
      .handler(async () => { handlerCalls.push(1) })

    const app = createApp({ cronLock: customLock }).cron(def)
    scheduleApp(app)

    // runOnStart fires immediately — give it a tick
    await new Promise((r) => setTimeout(r, 30))

    expect(acquireCalls.some((c) => c.jobName === 'lock.test')).toBe(true)
    expect(releaseCalls.includes('lock.test')).toBe(true)
    expect(handlerCalls.length).toBeGreaterThan(0)

    await app.close()
  })

  test('acquire receives ttlMs from def._ttlMs', async () => {
    const acquireCalls: Array<{ jobName: string; ttlMs: number }> = []

    const customLock: CronLockAdapter = {
      async acquire(jobName, ttlMs) { acquireCalls.push({ jobName, ttlMs }); return true },
      async release(_jobName) {},
    }

    const def = defineCron('ttl.test', '0 3 * * *', { runOnStart: true, ttlMs: 60_000 })
      .handler(async () => {})

    const app = createApp({ cronLock: customLock }).cron(def)
    scheduleApp(app)

    await new Promise((r) => setTimeout(r, 30))

    const call = acquireCalls.find((c) => c.jobName === 'ttl.test')
    expect(call).toBeDefined()
    expect(call?.ttlMs).toBe(60_000)

    await app.close()
  })

  test('acquire returning false skips job execution', async () => {
    const handlerCalls: number[] = []

    const blockingLock: CronLockAdapter = {
      async acquire(_jobName, _ttlMs) { return false },  // always deny
      async release(_jobName) {},
    }

    const def = defineCron('blocked.job', '0 3 * * *', { runOnStart: true })
      .handler(async () => { handlerCalls.push(1) })

    const app = createApp({ cronLock: blockingLock }).cron(def)
    scheduleApp(app)

    await new Promise((r) => setTimeout(r, 30))

    // Lock denied — handler must not have run
    expect(handlerCalls).toHaveLength(0)

    await app.close()
  })

  test('default (no cronLock) uses NoOpCronLockAdapter — job runs normally', async () => {
    const handlerCalls: number[] = []

    const def = defineCron('default.lock', '0 3 * * *', { runOnStart: true })
      .handler(async () => { handlerCalls.push(1) })

    const app = createApp().cron(def)
    scheduleApp(app)

    await new Promise((r) => setTimeout(r, 30))

    expect(handlerCalls.length).toBeGreaterThan(0)

    await app.close()
  })
})

// ── Case 3 — ttlMs falls back to 30_000 when not set ─────────────────────────

describe('ttlMs default fallback', () => {
  test('acquire receives 30_000 when ttlMs not set in options', async () => {
    const acquireCalls: Array<{ ttlMs: number }> = []

    const customLock: CronLockAdapter = {
      async acquire(_jobName, ttlMs) { acquireCalls.push({ ttlMs }); return true },
      async release(_jobName) {},
    }

    const def = defineCron('default.ttl', '0 3 * * *', { runOnStart: true })
      .handler(async () => {})

    const app = createApp({ cronLock: customLock }).cron(def)
    scheduleApp(app)

    await new Promise((r) => setTimeout(r, 30))

    expect(acquireCalls[0]?.ttlMs).toBe(30_000)

    await app.close()
  })
})
