---
title: "Ctx Reference"
category: "api"
tags: ["ctx", "context", "request", "response", "types"]
related: ["Types Reference", "defineModule", "Plugin System"]
---

# Ctx Reference

Every route handler, guard, hook, and middleware receives a `ctx` object. Its base fields are always present; plugins extend it with additional fields.

## Base Fields

```ts
interface BaseCtx {
  req:       Request
  params:    Record<string, string>
  query:     Record<string, string | string[]>
  body?:     unknown
}
```

### ctx.req

The raw `Request` object from Bun's HTTP server.

```ts
const method  = ctx.req.method
const url     = ctx.req.url
const headers = ctx.req.headers.get('authorization')
```

### ctx.params

Route path parameters.

```ts
// Route: /users/:id
ctx.params.id   // '42'
```

### ctx.query

URL query string parameters. Repeated keys become arrays.

```ts
// URL: /search?q=bun&tag=fast&tag=native
ctx.query.q      // 'bun'
ctx.query.tag    // ['fast', 'native']
```

### ctx.body

Parsed request body. Type depends on `Content-Type` — JSON, form data, or raw. Validated via `schema.body` if provided.

```ts
const { name, email } = ctx.body as { name: string; email: string }
```

---

## Response Helpers

### ctx.json(data, status?)

Returns a JSON response.

```ts
return ctx.json({ id: 1, name: 'Alice' })
return ctx.json({ error: 'Not found' }, 404)
```

### ctx.text(data, status?)

Returns a plain text response.

```ts
return ctx.text('OK')
return ctx.text('Not found', 404)
```

### ctx.html(data, status?)

Returns an HTML response.

```ts
return ctx.html('<h1>Hello</h1>')
```

---

## Streaming

### ctx.stream(writer, options?)

Returns a streaming response. The `writer` function receives a `StreamController`.

```ts
return ctx.stream(async (ctrl) => {
  for (const chunk of chunks) {
    ctrl.send(chunk)
  }
  ctrl.close()
})
```

**StreamController**

```ts
interface StreamController {
  send(chunk: string | Uint8Array): void
  close(): void
}
```

### ctx.sse(writer)

Returns a Server-Sent Events response.

```ts
return ctx.sse(async (ctrl) => {
  await ctrl.event('update', { count: 42 })
  await ctrl.data({ ping: true })
  await ctrl.comment('heartbeat')
})
```

**SseController**

```ts
interface SseController {
  event(name: string, data: unknown): Promise<void>
  data(data: unknown): Promise<void>
  comment(text?: string): Promise<void>
  id(id: string): Promise<void>
  retry(ms: number): Promise<void>
}
```

---

## Cookies

### ctx.cookie

A `CookieJar` with typed methods for reading and writing cookies.

```ts
// Read
const session = ctx.cookie.get('session')

// Write
ctx.cookie.set('session', token, {
  httpOnly: true,
  secure:   true,
  sameSite: 'Lax',
  maxAge:   60 * 60 * 24 * 7,
})

// Delete
ctx.cookie.delete('session')
```

**CookieJar**

```ts
interface CookieJar {
  get(name: string): string | undefined
  set(name: string, value: string, options?: CookieOptions): void
  delete(name: string): void
}

interface CookieOptions {
  httpOnly?: boolean
  secure?:   boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  maxAge?:   number
  path?:     string
  domain?:   string
}
```

---

## Events

### ctx.emit(event, payload)

Queues an event to be flushed after the response is sent.

```ts
await ctx.emit('user.created', { id: user.id, email: user.email })
```

Events are processed after the response completes — DB write and response both finish before any event handler runs.

---

## Plugin-Provided Fields

The following fields are added to `ctx` when the corresponding plugin is registered.

### ctx.db

Added by `dbPlugin`. A `BoundOakBunDB` instance scoped to the current request (tracks query log, wraps transactions).

```ts
const user = await ctx.db.from(usersTable).where({ id: ctx.params.id }).first()
```

See [DB Plugin](../plugins/04-db-plugin.md) and [SelectBuilder](../sql/02-select-builder.md).

### ctx.logger

Added by `loggerPlugin` or passed through `dbPlugin` options.

```ts
ctx.logger?.info('User created', { userId: user.id })
ctx.logger?.warn('Slow query', { ms: 250 })
ctx.logger?.error('Unexpected error', { err })
```

### ctx.requestId

Added by `requestIdPlugin`. A unique string ID for the request. Read from the `x-request-id` header if present; otherwise generated.

```ts
ctx.logger?.info('Handling request', { requestId: ctx.requestId })
```

### ctx.jwtUser

Added by `@oakbun/jwt`'s `jwtPlugin`. Contains the decoded JWT payload when a valid token is present.

```ts
// jwtPlugin({ optional: true })
if (!ctx.jwtUser) return ctx.json({ error: 'Unauthorized' }, 401)
const userId = ctx.jwtUser.sub
```

**JwtPayload**

```ts
interface JwtPayload {
  sub?:  string
  iat?:  number
  exp?:  number
  nbf?:  number
  aud?:  string | string[]
  iss?:  string
  jti?:  string
  [key: string]: unknown
}
```

### ctx.betterUser / ctx.session / ctx.auth

Added by `@oakbun/auth`'s `betterAuthPlugin`.

```ts
ctx.betterUser   // BetterAuthUser | null
ctx.session      // BetterAuthSession | null
ctx.auth         // BetterAuthInstance (full Better Auth client)
```

### ctx.events

Added by `eventBusPlugin`. Direct access to the `EventBus` for subscribing or emitting inside a handler (rare — prefer `ctx.emit()`).

---

## Internal Fields

These fields are used by the framework internally. Avoid writing to them; reading is safe for debugging.

| Field | Type | Purpose |
|---|---|---|
| `ctx._queryLog` | `QueryLog \| undefined` | Per-request query log (count, duration, entries) |
| `ctx._requestQueue` | `RequestEventQueue \| undefined` | Queued events pending flush |
| `ctx._startTime` | `number \| undefined` | Set by `onRequest` hooks for timing |

**QueryLog**

```ts
interface QueryLog {
  queries:  number
  totalMs:  number
  entries:  QueryLogEntry[]
}

interface QueryLogEntry {
  sql:        string
  durationMs: number
}
```

---

## Summary

| Field | Type | Source | Required |
|---|---|---|---|
| `req` | `Request` | BaseCtx | always |
| `params` | `Record<string, string>` | BaseCtx | always |
| `query` | `Record<string, string \| string[]>` | BaseCtx | always |
| `body` | `unknown` | BaseCtx | when body sent |
| `json()` | `(data, status?) => Response` | BaseCtx | always |
| `text()` | `(data, status?) => Response` | BaseCtx | always |
| `html()` | `(data, status?) => Response` | BaseCtx | always |
| `stream()` | `(writer, opts?) => Response` | BaseCtx | always |
| `sse()` | `(writer) => Response` | BaseCtx | always |
| `cookie` | `CookieJar` | BaseCtx | always |
| `emit()` | `(event, payload) => void` | BaseCtx | always |
| `db` | `BoundOakBunDB` | dbPlugin | optional |
| `logger` | `Logger` | loggerPlugin | optional |
| `requestId` | `string` | requestIdPlugin | optional |
| `jwtUser` | `JwtPayload \| undefined` | @oakbun/jwt | optional |
| `betterUser` | `BetterAuthUser \| null` | @oakbun/auth | optional |
| `session` | `BetterAuthSession \| null` | @oakbun/auth | optional |
| `auth` | `BetterAuthInstance` | @oakbun/auth | optional |
| `events` | `EventBus` | eventBusPlugin | optional |
| `_queryLog` | `QueryLog \| undefined` | framework | internal |

## See Also

- [Types Reference](./02-types-reference.md)
- [DB Plugin](../plugins/04-db-plugin.md)
- [JWT Plugin](../plugins/02-jwt-plugin.md)
- [defineModule](../core/02-define-module.md)
