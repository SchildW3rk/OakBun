import type { BaseCtx } from './types'
import type { CookieJar } from './cookies'

// ── createSystemCtx ───────────────────────────────────────────────────────────
// Builds a complete BaseCtx for use outside the HTTP request lifecycle:
// background jobs, CLI scripts, cron workers, seeding, etc.
//
// A dummy Request is provided so hooks that read ctx.req (e.g. ctx.req.url)
// don't crash — they receive a stable sentinel URL instead of throwing.
//
// extra is spread into the returned object, extending BaseCtx with whatever
// fields the caller's hooks expect (e.g. { user: { id: 'system', role: 'admin' } }).
//
// Usage:
//   const ctx = createSystemCtx({ user: { id: 'cron', role: 'admin' } })
//   const bound = db.withCtx(ctx)
//   await bound.into(usersTable).insert({ name: 'Cron User' })
//   // Hooks see ctx.user.id === 'cron' ✅
//   // Audit actor: 'cron' ✅

const SYSTEM_URL = 'http://system.local/background'

// Empty CookieJar for system/background contexts — no request cookies, no Set-Cookie headers.
const emptyCookieJar: CookieJar = {
  get:      () => undefined,
  set:      () => {},
  delete:   () => {},
  _pending: () => [],
}

export function createSystemCtx<TExtra extends object = Record<never, never>>(
  extra?: TExtra,
): BaseCtx & TExtra {
  const base: BaseCtx = {
    req:    new Request(SYSTEM_URL),
    params: {},
    query:  {},
    json:   (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    text:   (data, status = 200) =>
      new Response(data, { status }),
    html:   (data, status = 200) =>
      new Response(data, {
        status,
        headers: { 'Content-Type': 'text/html' },
      }),
    cookie: emptyCookieJar,
    emit:   () => {},
    stream: () => { throw new Error('[veln] stream not available in system context') },
    sse:    () => { throw new Error('[veln] sse not available in system context') },
  }

  return { ...base, ...(extra ?? {}) } as BaseCtx & TExtra
}
