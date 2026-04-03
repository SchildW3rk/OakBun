import { describe, test, expect } from 'bun:test'
import { createApp } from '../../packages/core/src/app/index'
import { defineCron } from '../../packages/core/src/cron/index'
import type { Cron } from 'croner'

// ── Helpers ───────────────────────────────────────────────────────────────────
//
// _scheduleCrons() is private — called inside listen().
// We call listen(0) and catch the throw that Bun.serve may raise in test context.
// The cron registry is populated regardless.

function scheduleApp(app: ReturnType<typeof createApp>): void {
  try { app.listen(0) } catch { /* Bun.serve may throw in test env */ }
}

function cronJobs(app: ReturnType<typeof createApp>): Map<string, Cron> {
  return (app as unknown as { _cronJobs: Map<string, Cron> })._cronJobs
}

// ── Case 1 — Job is registered in the map after listen() ─────────────────────

describe('Cron registry — job registration', () => {
  test('single job appears in _cronJobs after listen()', () => {
    const def = defineCron('reg.single', '0 3 * * *').handler(async () => {})
    const app = createApp().cron(def)

    scheduleApp(app)

    const jobs = cronJobs(app)
    expect(jobs.size).toBe(1)
    expect(jobs.has('reg.single')).toBe(true)
  })

  test('two jobs with different names — both in registry', () => {
    const def1 = defineCron('reg.a', '0 1 * * *').handler(async () => {})
    const def2 = defineCron('reg.b', '0 2 * * *').handler(async () => {})
    const app = createApp().cron(def1).cron(def2)

    scheduleApp(app)

    const jobs = cronJobs(app)
    expect(jobs.size).toBe(2)
    expect(jobs.has('reg.a')).toBe(true)
    expect(jobs.has('reg.b')).toBe(true)
  })

  test('registered job is a running croner instance', () => {
    const def = defineCron('reg.running', '0 4 * * *').handler(async () => {})
    const app = createApp().cron(def)

    scheduleApp(app)

    const job = cronJobs(app).get('reg.running')!
    expect(job).toBeDefined()
    expect(job.isRunning()).toBe(true)
    expect(job.isStopped()).toBe(false)

    // Cleanup — stop the job so it doesn't linger after the test
    job.stop()
  })
})

// ── Case 2 — app.close() stops all jobs ──────────────────────────────────────

describe('app.close() — stops all cron jobs', () => {
  test('job is stopped after close()', async () => {
    const def = defineCron('close.single', '0 3 * * *').handler(async () => {})
    const app = createApp().cron(def)

    scheduleApp(app)

    const job = cronJobs(app).get('close.single')!
    expect(job.isStopped()).toBe(false)

    await app.close()

    expect(job.isStopped()).toBe(true)
  })

  test('both jobs stopped after close() — two-job app', async () => {
    const def1 = defineCron('close.a', '0 1 * * *').handler(async () => {})
    const def2 = defineCron('close.b', '0 2 * * *').handler(async () => {})
    const app = createApp().cron(def1).cron(def2)

    scheduleApp(app)

    const jobs = cronJobs(app)
    const jobA = jobs.get('close.a')!
    const jobB = jobs.get('close.b')!

    await app.close()

    expect(jobA.isStopped()).toBe(true)
    expect(jobB.isStopped()).toBe(true)
  })

  test('registry is cleared after close()', async () => {
    const def = defineCron('close.cleared', '0 5 * * *').handler(async () => {})
    const app = createApp().cron(def)

    scheduleApp(app)
    expect(cronJobs(app).size).toBe(1)

    await app.close()

    expect(cronJobs(app).size).toBe(0)
  })

  test('close() is safe to call when no jobs are registered', async () => {
    const app = createApp()
    // Should not throw
    await expect(app.close()).resolves.toBeUndefined()
  })
})

// ── Case 3 — Duplicate job name ───────────────────────────────────────────────
//
// Two defs with the same name: the map stores the last one (Map.set overwrites).
// We document this rather than throw — croner itself allows duplicate names.

describe('Duplicate job name — last registration wins', () => {
  test('second job with same name overwrites first in registry', () => {
    const def1 = defineCron('dup.name', '0 1 * * *').handler(async () => {})
    const def2 = defineCron('dup.name', '0 2 * * *').handler(async () => {})
    const app = createApp().cron(def1).cron(def2)

    scheduleApp(app)

    const jobs = cronJobs(app)
    // Map has only one entry — second overwrote first
    expect(jobs.size).toBe(1)
    expect(jobs.has('dup.name')).toBe(true)

    // Cleanup
    jobs.get('dup.name')!.stop()
  })
})
