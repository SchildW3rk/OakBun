---
title: "Rate Limit Plugin"
category: "plugins"
tags: ["rate-limit", "security", "plugin", "throttle"]
related: ["Secure Headers Plugin", "Plugin System"]
---

# Rate Limit Plugin

`rateLimitPlugin` limits the number of requests a client can make within a time window.

## Signature

```ts
function rateLimitPlugin(options: RateLimitOptions): Plugin<BaseCtx, Record<never, never>>
```

## Basic Example

```ts
import { createApp, rateLimitPlugin } from 'oakbun'

const app = createApp()
app.plugin(rateLimitPlugin({
  max:      100,    // 100 requests
  windowMs: 60_000, // per minute
}))
```

## With Proxy Support

When your app runs behind a reverse proxy (nginx, Cloudflare), enable `trustProxy` to read the real client IP from `X-Forwarded-For`:

```ts
app.plugin(rateLimitPlugin({
  max:        200,
  windowMs:   60_000,
  trustProxy: true,
}))
```

## RateLimitOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `max` | `number` | — | Max requests per window |
| `windowMs` | `number` | — | Window duration in milliseconds |
| `trustProxy` | `boolean` | `false` | Use `X-Forwarded-For` for client IP |
| `keyResolver` | `(ctx) => string` | IP address | Custom key function |
| `store` | `RateLimitStore` | `InMemoryStore` | Custom store (e.g. Redis) |
| `onLimitReached` | `(ctx) => Response` | 429 response | Custom over-limit handler |

## Custom Key Resolver

Rate limit by user ID instead of IP:

```ts
app.plugin(rateLimitPlugin({
  max:         1000,
  windowMs:    60_000,
  keyResolver: (ctx) => ctx.jwtUser?.sub ?? ctx.req.headers.get('x-forwarded-for') ?? 'anonymous',
}))
```

## Custom Store

Implement `RateLimitStore` to use Redis or another backend:

```ts
interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>
  reset(key: string): Promise<void>
}
```

## InMemoryStore

The built-in store with automatic sweep:

```ts
import { InMemoryStore } from 'oakbun'

const store = new InMemoryStore(
  100,      // sweep every ~100 increments (probabilistic)
  100_000,  // max entries before hard eviction
)

app.plugin(rateLimitPlugin({ max: 100, windowMs: 60_000, store }))
```

## Response on Limit

When a client exceeds the limit, OakBun responds with:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: <epoch seconds>
```

## See Also

- [Secure Headers Plugin](./08-secure-headers-plugin.md)
- [Plugin System](./01-plugin-system.md)
