import { describe, test, expect } from 'bun:test'
import { createApp } from '../../core/src/app/index'
import { defineModule } from '../../core/src/app/module'
import { jwtPlugin, signJwt, TokenExpiredError, InvalidTokenError, WeakSecretError } from '../src/index'

const SECRET = 'test-secret-key-for-veln-jwt-ok!'  // 32 chars

// ── Helpers ────────────────────────────────────────────────────────────────────

async function makeToken(payload: Record<string, unknown> = {}, secret = SECRET): Promise<string> {
  return signJwt(
    { sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600, ...payload },
    secret,
  )
}

function bearerReq(token: string, path = '/me'): Request {
  return new Request(`http://localhost${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// ── 1. signJwt ────────────────────────────────────────────────────────────────

describe('signJwt', () => {
  test('returns a three-part JWT string', async () => {
    const token = await makeToken()
    expect(token.split('.')).toHaveLength(3)
  })

  test('encodes payload claims', async () => {
    const token = await makeToken({ sub: 'abc', role: 'admin' })
    const [, payloadB64] = token.split('.')
    const payload = JSON.parse(atob(payloadB64!.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>
    expect(payload.sub).toBe('abc')
    expect(payload.role).toBe('admin')
  })
})

// ── 2. Happy path — valid token ────────────────────────────────────────────────

describe('jwtPlugin — valid token', () => {
  test('valid token → 200, ctx.jwtUser populated', async () => {
    const token = await makeToken({ sub: 'user-42' })
    const app   = createApp().plugin(jwtPlugin(SECRET))
    app.get('/me', (ctx) => ctx.json({ sub: ctx.jwtUser?.sub }))
    const res  = await app.fetch(bearerReq(token))
    expect(res.status).toBe(200)
    const body = await res.json() as { sub: string }
    expect(body.sub).toBe('user-42')
  })

  test('ctx.jwtUser carries all custom claims', async () => {
    const token = await makeToken({ sub: 'u1', role: 'admin', orgId: 99 })
    const app   = createApp().plugin(jwtPlugin(SECRET))
    app.get('/me', (ctx) => ctx.json({ role: ctx.jwtUser?.role, orgId: ctx.jwtUser?.orgId }))
    const res  = await app.fetch(bearerReq(token))
    const body = await res.json() as { role: unknown; orgId: unknown }
    expect(body.role).toBe('admin')
    expect(body.orgId).toBe(99)
  })
})

// ── 3. Missing token ──────────────────────────────────────────────────────────

describe('jwtPlugin — missing token', () => {
  test('no Authorization header → 401', async () => {
    const app = createApp()
    app.plugin(jwtPlugin(SECRET))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(new Request('http://localhost/me'))
    expect(res.status).toBe(401)
  })

  test('401 body has TOKEN_INVALID code', async () => {
    const app = createApp()
    app.plugin(jwtPlugin(SECRET))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res  = await app.fetch(new Request('http://localhost/me'))
    const body = await res.json() as { code: string }
    expect(body.code).toBe('TOKEN_INVALID')
  })

  test('optional: true → 200 with ctx.jwtUser undefined', async () => {
    const app = createApp().plugin(jwtPlugin(SECRET, { optional: true }))
    app.get('/me', (ctx) => ctx.json({ hasUser: ctx.jwtUser !== undefined }))
    const res  = await app.fetch(new Request('http://localhost/me'))
    expect(res.status).toBe(200)
    const body = await res.json() as { hasUser: boolean }
    expect(body.hasUser).toBe(false)
  })
})

// ── 4. Invalid token ──────────────────────────────────────────────────────────

describe('jwtPlugin — invalid token', () => {
  test('garbage token → 401 TOKEN_INVALID', async () => {
    const app = createApp()
    app.plugin(jwtPlugin(SECRET))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res  = await app.fetch(bearerReq('not.a.jwt'))
    expect(res.status).toBe(401)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('TOKEN_INVALID')
  })

  test('wrong secret → 401 TOKEN_INVALID', async () => {
    const token = await makeToken({}, 'different-secret-that-is-32-chars!!')
    const app   = createApp()
    app.plugin(jwtPlugin(SECRET))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res  = await app.fetch(bearerReq(token))
    expect(res.status).toBe(401)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('TOKEN_INVALID')
  })

  test('tampered payload → 401 TOKEN_INVALID', async () => {
    const token  = await makeToken({ sub: 'user-1' })
    const parts  = token.split('.')
    // Replace payload with different content
    const tampered = btoa(JSON.stringify({ sub: 'admin', exp: 9999999999 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const bad = `${parts[0]}.${tampered}.${parts[2]}`
    const app = createApp()
    app.plugin(jwtPlugin(SECRET))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(bearerReq(bad))
    expect(res.status).toBe(401)
  })
})

// ── 5. Expired token ──────────────────────────────────────────────────────────

describe('jwtPlugin — expired token', () => {
  test('expired token → 401 TOKEN_EXPIRED', async () => {
    const token = await signJwt(
      { sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 60 },
      SECRET,
    )
    const app = createApp()
    app.plugin(jwtPlugin(SECRET))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res  = await app.fetch(bearerReq(token))
    expect(res.status).toBe(401)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('TOKEN_EXPIRED')
  })
})

// ── 6. Token sources ──────────────────────────────────────────────────────────

describe('jwtPlugin — token sources', () => {
  test('source: cookie → reads from cookie', async () => {
    const token = await makeToken({ sub: 'cookie-user' })
    const app   = createApp().plugin(jwtPlugin(SECRET, { source: 'cookie', cookieName: 'auth' }))
    app.get('/me', (ctx) => ctx.json({ sub: ctx.jwtUser?.sub }))
    const res = await app.fetch(new Request('http://localhost/me', {
      headers: { Cookie: `auth=${token}` },
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as { sub: string }
    expect(body.sub).toBe('cookie-user')
  })

  test('source: auto → header takes precedence over cookie', async () => {
    const headerToken = await makeToken({ sub: 'from-header' })
    const cookieToken = await makeToken({ sub: 'from-cookie' })
    const app = createApp().plugin(jwtPlugin(SECRET, { source: 'auto', cookieName: 'token' }))
    app.get('/me', (ctx) => ctx.json({ sub: ctx.jwtUser?.sub }))
    const res = await app.fetch(new Request('http://localhost/me', {
      headers: {
        Authorization: `Bearer ${headerToken}`,
        Cookie:        `token=${cookieToken}`,
      },
    }))
    const body = await res.json() as { sub: string }
    expect(body.sub).toBe('from-header')
  })

  test('source: auto → falls back to cookie when no header', async () => {
    const token = await makeToken({ sub: 'cookie-fallback' })
    const app   = createApp().plugin(jwtPlugin(SECRET, { source: 'auto', cookieName: 'token' }))
    app.get('/me', (ctx) => ctx.json({ sub: ctx.jwtUser?.sub }))
    const res = await app.fetch(new Request('http://localhost/me', {
      headers: { Cookie: `token=${token}` },
    }))
    const body = await res.json() as { sub: string }
    expect(body.sub).toBe('cookie-fallback')
  })
})

// ── 7. Module-scoped ──────────────────────────────────────────────────────────

describe('jwtPlugin — module-scoped', () => {
  test('JWT only required on module routes', async () => {
    const app = createApp()
    app.get('/public', (ctx) => ctx.json({ public: true }))

    const token = await makeToken({ sub: 'mod-user' })
    const mod   = defineModule('/api/admin')
      .plugin(jwtPlugin(SECRET))
      .get('/stats', (ctx) => ctx.json({ sub: ctx.jwtUser?.sub }))
      .build()
    app.register(mod)

    // Public route: no token needed
    const pub = await app.fetch(new Request('http://localhost/public'))
    expect(pub.status).toBe(200)

    // Module route: requires token
    const noAuth = await app.fetch(new Request('http://localhost/api/admin/stats'))
    expect(noAuth.status).toBe(401)

    // Module route: valid token
    const ok = await app.fetch(new Request('http://localhost/api/admin/stats', {
      headers: { Authorization: `Bearer ${token}` },
    }))
    expect(ok.status).toBe(200)
    const body = await ok.json() as { sub: string }
    expect(body.sub).toBe('mod-user')
  })
})

// ── 8. Error class hierarchy ──────────────────────────────────────────────────

describe('JWT error types', () => {
  test('TokenExpiredError has status 401 and code TOKEN_EXPIRED', () => {
    const err = new TokenExpiredError()
    expect(err.status).toBe(401)
    expect(err.code).toBe('TOKEN_EXPIRED')
    expect(err.name).toBe('TokenExpiredError')
  })

  test('InvalidTokenError has status 401 and code TOKEN_INVALID', () => {
    const err = new InvalidTokenError()
    expect(err.status).toBe(401)
    expect(err.code).toBe('TOKEN_INVALID')
    expect(err.name).toBe('InvalidTokenError')
  })
})

// ── 9. nbf (not before) claim ─────────────────────────────────────────────────

describe('jwtPlugin — nbf claim', () => {
  test('nbf in the past → token accepted', async () => {
    const token = await signJwt(
      { sub: 'u1', nbf: Math.floor(Date.now() / 1000) - 60, exp: Math.floor(Date.now() / 1000) + 3600 },
      SECRET,
    )
    const app = createApp().plugin(jwtPlugin(SECRET))
    app.get('/me', (ctx) => ctx.json({ sub: ctx.jwtUser?.sub }))
    const res = await app.fetch(bearerReq(token))
    expect(res.status).toBe(200)
  })

  test('nbf in the future → 401 TOKEN_INVALID', async () => {
    const token = await signJwt(
      { sub: 'u1', nbf: Math.floor(Date.now() / 1000) + 300, exp: Math.floor(Date.now() / 1000) + 3600 },
      SECRET,
    )
    const app = createApp()
    app.plugin(jwtPlugin(SECRET))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res  = await app.fetch(bearerReq(token))
    expect(res.status).toBe(401)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('TOKEN_INVALID')
  })

  test('no nbf claim → token accepted normally', async () => {
    const token = await signJwt({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET)
    const app   = createApp().plugin(jwtPlugin(SECRET))
    app.get('/me', (ctx) => ctx.json({ sub: ctx.jwtUser?.sub }))
    const res = await app.fetch(bearerReq(token))
    expect(res.status).toBe(200)
  })
})

// ── 10. RS256 ─────────────────────────────────────────────────────────────────

// Test key pair (2048-bit RSA, generated for tests only — never use in production)
const RS256_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCyTnjo3e4VMLgP
uPhHT5VldQU6qjPk/+/Vy+3epBsW35FJvyQbt8kzDvAnY94Ojq4BoSv3qrIJKm+2
I5A1jSXqsiDFeBoK1AaGIK/lp9WNPPmM/FZfir54hCAngnpW1faJ3eeOkwM2WK3H
asYtnsl+5ZFAdW06zu316cbtUlMTl57fXLMRZfOYxMc5Td968Wbrx5vMlXvOVAiv
8y4Q5P9ZOnLc97x81IdEK8LHaUK4dPatdywMpzD9zKgK6XNEhbnUxjqu+gx5AZbJ
NwnK7zUywQewCGPDLtyh2AWDsTJnu3a5wsx3qkRxY3+hP1AdKiDPcyO49dd+mmu9
OmK/MHAFAgMBAAECggEAInGuQa29dDJ5G/BrZbsl7PdyDycZ5z7Zob9HMB8bbIu7
kTdvTjtujoJwOeu81asSShZMXAeJZOPhuJmeHfoqPPA0DHFq9nSG3hoqYH7Pbf09
Z9LHDKXMrZM4cultoKCsg21ucchMco8m4sLpjZ6C5hSKvpzwgM/AgCSs3ONuUPZC
ixkuynRZKxQQ9s33PrN7rs81UQfBrH2UpIgsWQVQBYCOGzQ52lSoT3WLO0Mmwhn4
gADCJIbiFvcuT+jCvNpSF0XsT32ul8H2hT8PE9dnhj6sRQY9gC4YIhaS2/FBujRO
NjQC5kJpMh75Ah7AdJXVHa5NJ2f+Y9J22bKDl2XAgQKBgQDeIrK6YORLQGxeJoa1
GqPaqPvEeHUiT77a5HejUTDfS/4itFMP25FpAUJ+dwowLZPMbLjwjmnkdysgWNfV
2OehszEXfpjOtq9+NsCxnKygq9ELKgTyZPrMwYAwwq4Qwl/Ty2GhvURm9w4efBi5
tThdqd80alePtxYG5W9wTWWA7QKBgQDNfUGC2QwPFIn97IqKnY7vdcapdlGicovF
+iL0mk0jT6FYk10mohnk/h8pmw+FnbYAO91UYS5c/S6l4kt5jkuxsu6atTurKrtH
59g1V3YJISPdEMLD0kf0DF7ZUEGz0MB9wR69AKkCrI86yJ+eq2/TvOzFDP9i9djI
kgrmmMCAeQKBgH49n+8182gk07FqGbJA0pAI6xRMFN2MDn4dyzQghzLP4Dze2Dmx
4eCYG679fefFbzKFM1FazilN5E98ziS1IWaPDL46byNDRVboTPhjfuPM4X+DwM30
v2ewLGcJrJzPqmAWPIULqB0QGJEQm4imycLJMJV8Pgjp1vXSXFOpWJ89AoGANPbf
99Xx4cEtgCGD5A6QVPBKcEtq5zAXDsRWVi2fTEauE6KIE/kcK4XEinjJG2t3CcBk
X+dch+NKLr+RLJecswSns4CbDJdLBlGfzL/qUJgWIli7mrWMjj7SA7lH9g0MUF2C
irys01+e20vyuHb/r9e2P2QGP3+WjLv3y0/77iECgYEAhCRGTz4bQ06J7Vq/E7vC
r1oEFfOW/6k9O+ClsWslTiSxbghxHvNB3WW/JKhxqtbnJibACcj7aEQiUJqgrMLv
I8enCoP35IZprQDMs9eq4fgJ9ZKdQs4hYteACEDcNys9RZwA1Uq8o/K5XjIkBvw3
Pm61JsgzCMzq/49i1PrOmHA=
-----END PRIVATE KEY-----`

const RS256_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsk546N3uFTC4D7j4R0+V
ZXUFOqoz5P/v1cvt3qQbFt+RSb8kG7fJMw7wJ2PeDo6uAaEr96qyCSpvtiOQNY0l
6rIgxXgaCtQGhiCv5afVjTz5jPxWX4q+eIQgJ4J6VtX2id3njpMDNlitx2rGLZ7J
fuWRQHVtOs7t9enG7VJTE5ee31yzEWXzmMTHOU3fevFm68ebzJV7zlQIr/MuEOT/
WTpy3Pe8fNSHRCvCx2lCuHT2rXcsDKcw/cyoCulzRIW51MY6rvoMeQGWyTcJyu81
MsEHsAhjwy7codgFg7EyZ7t2ucLMd6pEcWN/oT9QHSogz3MjuPXXfpprvTpivzBw
BQIDAQAB
-----END PUBLIC KEY-----`

describe('RS256 — signJwt + jwtPlugin', () => {
  test('RS256 token roundtrip — sign + verify', async () => {
    const token = await signJwt(
      { sub: 'rs-user', exp: Math.floor(Date.now() / 1000) + 3600 },
      { algorithm: 'RS256', privateKey: RS256_PRIVATE_KEY },
    )
    expect(token.split('.')).toHaveLength(3)

    const app = createApp().plugin(jwtPlugin({ algorithm: 'RS256', publicKey: RS256_PUBLIC_KEY }))
    app.get('/me', (ctx) => ctx.json({ sub: ctx.jwtUser?.sub }))

    const res  = await app.fetch(bearerReq(token))
    expect(res.status).toBe(200)
    const body = await res.json() as { sub: string }
    expect(body.sub).toBe('rs-user')
  })

  test('RS256 token has alg: RS256 in header', async () => {
    const token = await signJwt(
      { sub: 'u1' },
      { algorithm: 'RS256', privateKey: RS256_PRIVATE_KEY },
    )
    const [headerB64] = token.split('.')
    const header = JSON.parse(atob(headerB64!.replace(/-/g, '+').replace(/_/g, '/'))) as { alg: string }
    expect(header.alg).toBe('RS256')
  })

  test('RS256 token rejected by HS256 plugin', async () => {
    const token = await signJwt(
      { sub: 'u1', exp: Math.floor(Date.now() / 1000) + 3600 },
      { algorithm: 'RS256', privateKey: RS256_PRIVATE_KEY },
    )
    const app = createApp()
    app.plugin(jwtPlugin(SECRET)) // HS256 — different alg
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res  = await app.fetch(bearerReq(token))
    expect(res.status).toBe(401)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('TOKEN_INVALID')
  })

  test('HS256 token rejected by RS256 plugin', async () => {
    const token = await makeToken({ sub: 'u1' })  // HS256
    const app = createApp()
    app.plugin(jwtPlugin({ algorithm: 'RS256', publicKey: RS256_PUBLIC_KEY }))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res  = await app.fetch(bearerReq(token))
    expect(res.status).toBe(401)
  })

  test('RS256 plugin — wrong public key → 401', async () => {
    const token = await signJwt(
      { sub: 'u1', exp: Math.floor(Date.now() / 1000) + 3600 },
      { algorithm: 'RS256', privateKey: RS256_PRIVATE_KEY },
    )
    const { publicKey: wrongPub } = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )
    const wrongDer  = await crypto.subtle.exportKey('spki', wrongPub)
    const wrongB64  = btoa(String.fromCharCode(...new Uint8Array(wrongDer)))
    const wrongPem  = `-----BEGIN PUBLIC KEY-----\n${wrongB64.match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----`

    const app = createApp()
    app.plugin(jwtPlugin({ algorithm: 'RS256', publicKey: wrongPem }))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(bearerReq(token))
    expect(res.status).toBe(401)
  })

  test('RS256 signJwt throws when privateKey missing', async () => {
    await expect(
      signJwt({ sub: 'u1' }, { algorithm: 'RS256' }),
    ).rejects.toThrow('RS256 requires privateKey')
  })

  test('nbf + RS256 — future nbf rejected', async () => {
    const token = await signJwt(
      { sub: 'u1', nbf: Math.floor(Date.now() / 1000) + 300 },
      { algorithm: 'RS256', privateKey: RS256_PRIVATE_KEY },
    )
    const app = createApp()
    app.plugin(jwtPlugin({ algorithm: 'RS256', publicKey: RS256_PUBLIC_KEY }))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res  = await app.fetch(bearerReq(token))
    expect(res.status).toBe(401)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('TOKEN_INVALID')
  })
})

// ── 11. HS256 minimum secret length ──────────────────────────────────────────

describe('HS256 — minimum secret length validation', () => {
  test('jwtPlugin: secret exactly 32 chars → no error', () => {
    expect(() => jwtPlugin('12345678901234567890123456789012')).not.toThrow()
  })

  test('jwtPlugin: secret 31 chars → throws WeakSecretError', () => {
    expect(() => jwtPlugin('1234567890123456789012345678901')).toThrow(WeakSecretError)
  })

  test('jwtPlugin: secret 0 chars → throws WeakSecretError', () => {
    expect(() => jwtPlugin('')).toThrow(WeakSecretError)
  })

  test('jwtPlugin: secret 33 chars → no error', () => {
    expect(() => jwtPlugin('123456789012345678901234567890123')).not.toThrow()
  })

  test('jwtPlugin: WeakSecretError has code JWT_WEAK_SECRET', () => {
    let err: unknown
    try { jwtPlugin('short') } catch (e) { err = e }
    expect(err).toBeInstanceOf(WeakSecretError)
    expect((err as WeakSecretError).code).toBe('JWT_WEAK_SECRET')
    expect((err as WeakSecretError).status).toBe(500)
  })

  test('jwtPlugin: RS256 config → no secret length check', () => {
    expect(() => jwtPlugin({ algorithm: 'RS256', publicKey: RS256_PUBLIC_KEY })).not.toThrow()
  })

  test('signJwt: secret 31 chars → throws WeakSecretError', async () => {
    await expect(
      signJwt({ sub: 'u1' }, '1234567890123456789012345678901')
    ).rejects.toThrow(WeakSecretError)
  })

  test('signJwt: secret exactly 32 chars → no error', async () => {
    await expect(
      signJwt({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 3600 }, '12345678901234567890123456789012')
    ).resolves.toBeDefined()
  })
})

// ── 12. Clock skew tolerance ──────────────────────────────────────────────────

describe('jwtPlugin — clockSkewSeconds', () => {
  test('token expired 29s ago, clockSkewSeconds: 30 → valid (within skew)', async () => {
    const exp   = Math.floor(Date.now() / 1000) - 29  // expired 29s ago
    const token = await signJwt({ sub: 'skew-user', exp }, SECRET)
    const app   = createApp().plugin(jwtPlugin(SECRET, { clockSkewSeconds: 30 }))
    app.get('/me', (ctx) => ctx.json({ sub: ctx.jwtUser?.sub }))

    const res = await app.fetch(bearerReq(token))
    expect(res.status).toBe(200)
    const body = await res.json() as { sub: string }
    expect(body.sub).toBe('skew-user')
  })

  test('token expired 31s ago, clockSkewSeconds: 30 → 401 TOKEN_EXPIRED', async () => {
    const exp   = Math.floor(Date.now() / 1000) - 31  // expired 31s ago
    const token = await signJwt({ sub: 'u1', exp }, SECRET)
    const app   = createApp()
    app.plugin(jwtPlugin(SECRET, { clockSkewSeconds: 30 }))
    app.get('/me', (ctx) => ctx.json({ ok: true }))

    const res  = await app.fetch(bearerReq(token))
    expect(res.status).toBe(401)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('TOKEN_EXPIRED')
  })

  test('nbf 29s in future, clockSkewSeconds: 30 → valid (within skew)', async () => {
    const nbf   = Math.floor(Date.now() / 1000) + 29  // not valid for 29s
    const exp   = Math.floor(Date.now() / 1000) + 3600
    const token = await signJwt({ sub: 'nbf-user', nbf, exp }, SECRET)
    const app   = createApp().plugin(jwtPlugin(SECRET, { clockSkewSeconds: 30 }))
    app.get('/me', (ctx) => ctx.json({ sub: ctx.jwtUser?.sub }))

    const res = await app.fetch(bearerReq(token))
    expect(res.status).toBe(200)
  })

  test('nbf 31s in future, clockSkewSeconds: 30 → 401 TOKEN_INVALID', async () => {
    const nbf   = Math.floor(Date.now() / 1000) + 31  // not valid for 31s
    const exp   = Math.floor(Date.now() / 1000) + 3600
    const token = await signJwt({ sub: 'u1', nbf, exp }, SECRET)
    const app   = createApp()
    app.plugin(jwtPlugin(SECRET, { clockSkewSeconds: 30 }))
    app.get('/me', (ctx) => ctx.json({ ok: true }))

    const res  = await app.fetch(bearerReq(token))
    expect(res.status).toBe(401)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('TOKEN_INVALID')
  })

  test('default (no clockSkewSeconds) — exact comparison (token expired 1s ago → rejected)', async () => {
    const exp   = Math.floor(Date.now() / 1000) - 1  // expired 1s ago
    const token = await signJwt({ sub: 'u1', exp }, SECRET)
    const app   = createApp()
    app.plugin(jwtPlugin(SECRET))  // no clockSkewSeconds
    app.get('/me', (ctx) => ctx.json({ ok: true }))

    const res = await app.fetch(bearerReq(token))
    expect(res.status).toBe(401)
  })
})

// ── 10. issuer / audience validation ──────────────────────────────────────────

describe('jwtPlugin — issuer validation', () => {
  test('no issuer configured — token without iss accepted', async () => {
    const token = await makeToken()  // no iss claim
    const app   = createApp()
    app.plugin(jwtPlugin(SECRET))  // no issuer option
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(bearerReq(token))
    expect(res.status).toBe(200)
  })

  test('issuer configured — token with correct iss accepted', async () => {
    const token = await makeToken({ iss: 'https://myapp.com' })
    const app   = createApp()
    app.plugin(jwtPlugin(SECRET, { issuer: 'https://myapp.com' }))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(bearerReq(token))
    expect(res.status).toBe(200)
  })

  test('issuer configured — token with wrong iss → 401', async () => {
    const token = await makeToken({ iss: 'https://other.com' })
    const app   = createApp()
    app.plugin(jwtPlugin(SECRET, { issuer: 'https://myapp.com' }))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(bearerReq(token))
    expect(res.status).toBe(401)
  })

  test('issuer configured — token without iss → 401', async () => {
    const token = await makeToken()  // no iss
    const app   = createApp()
    app.plugin(jwtPlugin(SECRET, { issuer: 'https://myapp.com' }))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(bearerReq(token))
    expect(res.status).toBe(401)
  })
})

describe('jwtPlugin — audience validation', () => {
  test('no audience configured — token without aud accepted', async () => {
    const token = await makeToken()  // no aud claim
    const app   = createApp()
    app.plugin(jwtPlugin(SECRET))  // no audience option
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(bearerReq(token))
    expect(res.status).toBe(200)
  })

  test('audience configured — token with correct aud accepted', async () => {
    const token = await makeToken({ aud: 'api' })
    const app   = createApp()
    app.plugin(jwtPlugin(SECRET, { audience: 'api' }))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(bearerReq(token))
    expect(res.status).toBe(200)
  })

  test('audience configured — token without aud → 401', async () => {
    const token = await makeToken()  // no aud
    const app   = createApp()
    app.plugin(jwtPlugin(SECRET, { audience: 'api' }))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(bearerReq(token))
    expect(res.status).toBe(401)
  })

  test('audience configured — token with wrong aud → 401', async () => {
    const token = await makeToken({ aud: 'other-service' })
    const app   = createApp()
    app.plugin(jwtPlugin(SECRET, { audience: 'api' }))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(bearerReq(token))
    expect(res.status).toBe(401)
  })

  test('both issuer and audience — both must match', async () => {
    const token = await makeToken({ iss: 'https://myapp.com', aud: 'api' })
    const app   = createApp()
    app.plugin(jwtPlugin(SECRET, { issuer: 'https://myapp.com', audience: 'api' }))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(bearerReq(token))
    expect(res.status).toBe(200)
  })

  test('both issuer and audience — wrong aud → 401', async () => {
    const token = await makeToken({ iss: 'https://myapp.com', aud: 'wrong' })
    const app   = createApp()
    app.plugin(jwtPlugin(SECRET, { issuer: 'https://myapp.com', audience: 'api' }))
    app.get('/me', (ctx) => ctx.json({ ok: true }))
    const res = await app.fetch(bearerReq(token))
    expect(res.status).toBe(401)
  })
})
