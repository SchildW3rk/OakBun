---
title: "JWT Plugin"
category: "plugins"
tags: ["jwt", "auth", "token", "plugin"]
related: ["defineGuard", "Auth Adapter", "Guards & Auth"]
---

# JWT Plugin

`@oakbun/jwt` verifies JWT tokens on incoming requests and populates `ctx.jwtUser`.

## Installation

```bash
bun add @oakbun/jwt
```

## Signature

```ts
function jwtPlugin(
  config: string | JwtConfig,
  options?: JwtOptions,
): Plugin<BaseCtx, { jwtUser: JwtPayload | undefined }>
```

## Basic Example

```ts
import { jwtPlugin } from '@oakbun/jwt'

const secureModule = defineModule('/api')
  .plugin(jwtPlugin(process.env.JWT_SECRET!))
  .get('/me', async (ctx) => ctx.json(ctx.jwtUser))
  .build()
```

## HS256 (Symmetric)

Pass the secret as a string — minimum 32 characters:

```ts
jwtPlugin('my-secret-key-at-least-32-chars-long')

// Equivalent explicit form:
jwtPlugin({ algorithm: 'HS256', secret: process.env.JWT_SECRET! })
```

## RS256 (Asymmetric)

```ts
jwtPlugin({
  algorithm:  'RS256',
  publicKey:  process.env.JWT_PUBLIC_KEY,   // for verification
  privateKey: process.env.JWT_PRIVATE_KEY,  // optional, for signing
})
```

## JwtOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `source` | `'header' \| 'cookie' \| 'auto'` | `'header'` | Where to read the token |
| `cookieName` | `string` | `'token'` | Cookie name when `source: 'cookie'` |
| `optional` | `boolean` | `false` | Allow missing token (`ctx.jwtUser` = `undefined`) |
| `clockSkewSeconds` | `number` | `0` | Tolerance for exp/nbf checks |
| `issuer` | `string` | — | Validate `iss` claim |
| `audience` | `string` | — | Validate `aud` claim |

## Optional Auth

Allow unauthenticated requests — useful for public endpoints that have optional personalization:

```ts
defineModule('/posts')
  .plugin(jwtPlugin(SECRET, { optional: true }))
  .get('/', async (ctx) => {
    // ctx.jwtUser may be undefined
    const userId = ctx.jwtUser?.sub
    return ctx.json(await ctx.posts.findAll(userId))
  })
```

## Signing Tokens

```ts
import { signJwt } from '@oakbun/jwt'

const token = await signJwt(
  { sub: user.id, role: user.role },
  { algorithm: 'HS256', secret: process.env.JWT_SECRET! },
  { expiresIn: '1h' },
)
```

## Errors

| Error | Code | HTTP | When |
|---|---|---|---|
| `TokenExpiredError` | `TOKEN_EXPIRED` | 401 | Token `exp` in the past |
| `InvalidTokenError` | `TOKEN_INVALID` | 401 | Malformed, bad signature, failed claims |
| `WeakSecretError` | — | startup | HS256 secret shorter than 32 chars |

## JwtPayload Type

```ts
interface JwtPayload {
  sub?: string
  iat?: number
  exp?: number
  nbf?: number
  aud?: string
  iss?: string
  jti?: string
  [key: string]: unknown   // custom claims
}
```

## ctx Extension

After the plugin runs, `ctx.jwtUser` is available in all subsequent route handlers:

```ts
ctx.jwtUser          // JwtPayload | undefined
ctx.jwtUser?.sub     // user ID from subject claim
ctx.jwtUser?.['role'] // custom claim
```

## See Also

- [defineGuard](../core/07-define-guard.md)
- [Guards & Auth Guide](../guides/02-guards-and-auth.md)
- [Auth Adapter](./03-auth-adapter.md)
