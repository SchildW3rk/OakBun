---
title: "Secure Headers / CORS / CSRF"
category: "plugins"
tags: ["security", "headers", "cors", "csrf", "plugin"]
related: ["Rate Limit Plugin", "Plugin System"]
---

# Secure Headers / CORS / CSRF

Security-focused plugins included in the `oakbun` core package.

---

## secureHeadersPlugin

Sets standard security headers on every response.

### Signature

```ts
function secureHeadersPlugin(options?: SecureHeadersOptions): Plugin
```

### Basic Example

```ts
import { createApp, secureHeadersPlugin } from 'oakbun'

app.plugin(secureHeadersPlugin())
```

### Default Headers

| Header | Default Value |
|---|---|
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-XSS-Protection` | `0` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Content-Security-Policy` | `relaxed` preset |

### CSP Presets

| Preset | Description |
|---|---|
| `'strict'` | `default-src 'self'; script-src 'self'; style-src 'self'` |
| `'relaxed'` | `default-src 'self'; script-src 'self' 'unsafe-inline'` |
| `false` | Omit CSP header entirely |
| custom string | Passed through as-is |

### SecureHeadersOptions

All fields are optional. Pass a string to override, `false` to omit, or omit entirely to use the default.

```ts
app.plugin(secureHeadersPlugin({
  contentSecurityPolicy: 'strict',
  xFrameOptions:         false,     // omit this header
  referrerPolicy:        'no-referrer',
}))
```

---

## corsPlugin

Handles CORS preflight (`OPTIONS`) requests and injects CORS headers on all responses.

### Signature

```ts
function corsPlugin(options?: CorsOptions): Plugin
```

### Basic Example

```ts
import { corsPlugin } from 'oakbun'

app.plugin(corsPlugin({
  origin:      ['http://localhost:3000', 'https://myapp.com'],
  credentials: true,
}))
```

### CorsOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `origin` | `'*' \| string \| string[] \| (origin) => boolean` | `'*'` | Allowed origins |
| `methods` | `string[]` | `['GET','POST','PUT','PATCH','DELETE','OPTIONS']` | Allowed methods |
| `allowHeaders` | `string[]` | `['Content-Type','Authorization','x-csrf-token']` | Allowed request headers |
| `exposeHeaders` | `string[]` | `[]` | Headers exposed to the browser |
| `credentials` | `boolean` | `false` | Allow cookies/auth headers (disables `origin: '*'`) |
| `maxAge` | `number` | `86400` | Preflight cache duration (seconds) |

---

## csrfPlugin

Protects state-changing requests (POST, PUT, PATCH, DELETE) against Cross-Site Request Forgery.

### Signature

```ts
function csrfPlugin(options?: CsrfOptions): Plugin
```

### Basic Example

```ts
import { csrfPlugin } from 'oakbun'

app.plugin(csrfPlugin())
```

### How It Works

1. `GET /csrf-token` returns a token
2. The client includes the token in subsequent state-changing requests via the `x-csrf-token` header or the `_csrf` cookie
3. Requests without a valid token receive `403 Forbidden`

### CsrfOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `cookieName` | `string` | `'_csrf'` | CSRF cookie name |
| `headerName` | `string` | `'x-csrf-token'` | CSRF header name |
| `tokenEndpoint` | `string` | `'/csrf-token'` | Token generation endpoint |
| `excludePaths` | `string[]` | `[]` | Paths to exclude from CSRF check |

---

## bodySizeLimitPlugin

Rejects requests with a body exceeding a configured size.

```ts
import { bodySizeLimitPlugin } from 'oakbun'

app.plugin(bodySizeLimitPlugin({ maxBytes: 2 * 1024 * 1024 }))  // 2 MB
```

---

## requestIdPlugin

Generates a unique ID for each request and attaches it to `ctx.requestId`.

```ts
import { requestIdPlugin } from 'oakbun'

app.plugin(requestIdPlugin())

// In a handler:
ctx.requestId  // 'req_abc123...'
```

## See Also

- [Rate Limit Plugin](./06-rate-limit-plugin.md)
- [Plugin System](./01-plugin-system.md)
