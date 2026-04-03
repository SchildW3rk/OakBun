import { describe, test, expect, beforeAll } from 'bun:test'
import { SQLiteAdapter } from '../../../packages/core/src/adapter/sqlite'
import { createApp } from '../../../packages/core/src/app/index'
import { createOnRequest } from '../../../packages/core/src/app/types'
import { createAuthTables } from '../src/migrate.js'
import { createVelnDbAdapter } from '../src/adapter.js'
import { betterAuth } from 'better-auth'

const TEST_EMAIL = 'e2e@test.com'
const TEST_PASSWORD = 'Password123!'
const TEST_NAME = 'E2E User'
const TEST_SECRET = 'test-secret-must-be-at-least-32-chars!!'
const BASE_URL = 'http://localhost'

async function setup() {
  const adapter = new SQLiteAdapter()
  await createAuthTables(adapter)

  const auth = betterAuth({
    secret: TEST_SECRET,
    baseURL: BASE_URL,
    trustedOrigins: [BASE_URL],
    database: createVelnDbAdapter(adapter),
    emailAndPassword: { enabled: true },
    logger: { disabled: true },
  })

  const app = createApp()

  // Mount auth routes via onRequest lifecycle hook
  app.onRequest(
    createOnRequest(async (ctx) => {
      const url = new URL(ctx.req.url)
      if (url.pathname.startsWith('/api/auth')) {
        return auth.handler(ctx.req)
      }
    })
  )

  // Add a simple route to test session reading
  app.get('/me', async (ctx) => {
    const sessionData = await auth.api.getSession({ headers: ctx.req.headers })
    if (!sessionData) return ctx.json({ user: null }, 401)
    return ctx.json({ user: sessionData.user })
  })

  return { app, auth, adapter }
}

describe('auth-flow (end-to-end)', () => {
  let app: ReturnType<typeof createApp>
  let sessionCookie: string

  beforeAll(async () => {
    const inst = await setup()
    app = inst.app
  })

  test('sign-up with email returns 200', async () => {
    const res = await app.fetch(new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME }),
    }))
    expect(res.status).toBe(200)
  })

  test('sign-in with correct password returns 200 and sets cookie', async () => {
    const res = await app.fetch(new Request(`${BASE_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    }))
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie')
    expect(cookie).toBeTruthy()
    sessionCookie = cookie!
  })

  test('get-session with valid cookie returns session', async () => {
    const res = await app.fetch(new Request(`${BASE_URL}/api/auth/get-session`, {
      headers: { Cookie: sessionCookie },
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).not.toBeNull()
    const user = body['user'] as Record<string, unknown> | null
    expect(user?.['email']).toBe(TEST_EMAIL)
  })

  test('protected route /me with session cookie returns user', async () => {
    const res = await app.fetch(new Request(`${BASE_URL}/me`, {
      headers: { Cookie: sessionCookie },
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    const user = body['user'] as Record<string, unknown>
    expect(user?.['email']).toBe(TEST_EMAIL)
  })

  test('sign-in with wrong password returns 4xx error', async () => {
    const res = await app.fetch(new Request(`${BASE_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: 'wrongpassword' }),
    }))
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  test('sign-out returns 200', async () => {
    const res = await app.fetch(new Request(`${BASE_URL}/api/auth/sign-out`, {
      method: 'POST',
      headers: { Cookie: sessionCookie },
    }))
    expect(res.status).toBe(200)
  })
})
