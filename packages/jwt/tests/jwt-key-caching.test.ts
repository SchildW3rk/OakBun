import { describe, test, expect } from 'bun:test'
import { createApp } from '../../core/src/app/index'
import { jwtPlugin, signJwt } from '../src/index'

// 32+ character secret for HS256
const LONG_SECRET = 'a-very-long-secret-key-for-tests!!'

// RS256 test key pair (same as in jwt.test.ts)
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

function bearerReq(token: string, path = '/me'): Request {
  return new Request(`http://localhost${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// ── HS256 key caching ─────────────────────────────────────────────────────────

describe('jwtPlugin — HS256 key caching', () => {
  test('HS256: plugin verifies tokens correctly across multiple requests', async () => {
    const exp   = Math.floor(Date.now() / 1000) + 3600
    const token = await signJwt({ sub: 'cache-user', exp }, LONG_SECRET)
    const app   = createApp().plugin(jwtPlugin(LONG_SECRET))
    app.get('/me', (ctx) => ctx.json({ sub: ctx.jwtUser?.sub }))

    // Make 3 requests — each should succeed with the same plugin instance (cached key)
    for (let i = 0; i < 3; i++) {
      const res  = await app.fetch(bearerReq(token))
      expect(res.status).toBe(200)
      const body = await res.json() as { sub: string }
      expect(body.sub).toBe('cache-user')
    }
  })

  test('HS256: Uint8Array key is cached — TextEncoder.encode called only once across N requests', async () => {
    const exp   = Math.floor(Date.now() / 1000) + 3600
    const token = await signJwt({ sub: 'u1', exp }, LONG_SECRET)

    // Spy on TextEncoder.encode to verify the secret is encoded exactly once.
    // Our plugin caches the Uint8Array result after the first request — subsequent
    // requests must reuse the cached key without re-encoding the secret string.
    const originalEncode = TextEncoder.prototype.encode
    let encodeCallCount  = 0
    TextEncoder.prototype.encode = function (...args) {
      encodeCallCount++
      return originalEncode.apply(this, args)
    }

    const app = createApp()
    app.plugin(jwtPlugin(LONG_SECRET))
    app.get('/me', (ctx) => ctx.json({ ok: true }))

    for (let i = 0; i < 5; i++) {
      await app.fetch(bearerReq(token))
    }

    TextEncoder.prototype.encode = originalEncode

    // encodeHmacSecret (TextEncoder.encode) is called exactly once — on the first
    // request to initialize cachedVerifyKey. Subsequent requests reuse the cached Uint8Array.
    expect(encodeCallCount).toBe(1)
  })

  test('HS256: different plugin instances each cache independently', async () => {
    const exp    = Math.floor(Date.now() / 1000) + 3600
    const token1 = await signJwt({ sub: 'u1', exp }, LONG_SECRET)
    const token2 = await signJwt({ sub: 'u2', exp }, LONG_SECRET)

    const app1 = createApp().plugin(jwtPlugin(LONG_SECRET))
    app1.get('/me', (ctx) => ctx.json({ sub: ctx.jwtUser?.sub }))

    const app2 = createApp().plugin(jwtPlugin(LONG_SECRET))
    app2.get('/me', (ctx) => ctx.json({ sub: ctx.jwtUser?.sub }))

    const res1 = await app1.fetch(bearerReq(token1))
    const res2 = await app2.fetch(bearerReq(token2))

    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    expect((await res1.json() as { sub: string }).sub).toBe('u1')
    expect((await res2.json() as { sub: string }).sub).toBe('u2')
  })
})

// ── RS256 key caching ─────────────────────────────────────────────────────────

describe('jwtPlugin — RS256 key caching', () => {
  test('RS256: plugin verifies tokens correctly across multiple requests', async () => {
    const exp   = Math.floor(Date.now() / 1000) + 3600
    const token = await signJwt(
      { sub: 'rs-cache-user', exp },
      { algorithm: 'RS256', privateKey: RS256_PRIVATE_KEY },
    )
    const app = createApp().plugin(jwtPlugin({ algorithm: 'RS256', publicKey: RS256_PUBLIC_KEY }))
    app.get('/me', (ctx) => ctx.json({ sub: ctx.jwtUser?.sub }))

    // Make 3 requests — each should succeed with cached public key
    for (let i = 0; i < 3; i++) {
      const res  = await app.fetch(bearerReq(token))
      expect(res.status).toBe(200)
      const body = await res.json() as { sub: string }
      expect(body.sub).toBe('rs-cache-user')
    }
  })

  test('RS256: importKey called only once across N requests (behavioral count)', async () => {
    const exp   = Math.floor(Date.now() / 1000) + 3600
    const token = await signJwt(
      { sub: 'u1', exp },
      { algorithm: 'RS256', privateKey: RS256_PRIVATE_KEY },
    )

    const originalImportKey = crypto.subtle.importKey.bind(crypto.subtle)
    let importKeyCallCount  = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    crypto.subtle.importKey = ((...args: Parameters<typeof crypto.subtle.importKey>) => {
      importKeyCallCount++
      return originalImportKey(...args)
    }) as typeof crypto.subtle.importKey

    const app = createApp()
    app.plugin(jwtPlugin({ algorithm: 'RS256', publicKey: RS256_PUBLIC_KEY }))
    app.get('/me', (ctx) => ctx.json({ ok: true }))

    for (let i = 0; i < 5; i++) {
      await app.fetch(bearerReq(token))
    }

    crypto.subtle.importKey = originalImportKey

    // RS256 plugin caches the public key on first request — 1 importKey call
    expect(importKeyCallCount).toBe(1)
  })
})
