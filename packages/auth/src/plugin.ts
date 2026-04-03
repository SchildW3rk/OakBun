import { betterAuth } from 'better-auth'
import type { VelnAdapter, BaseCtx, Plugin } from 'oakbun'
import { createVelnDbAdapter } from './adapter.js'

export interface BetterAuthPluginOptions {
  secret: string
  baseUrl?: string
  trustedOrigins?: string[]
}

export type BetterAuthInstance = ReturnType<typeof betterAuth>

export type BetterAuthUser = BetterAuthInstance['$Infer']['Session']['user']
export type BetterAuthSession = BetterAuthInstance['$Infer']['Session']['session']

export interface AuthCtxAdd {
  // betterUser — full Better Auth user object (name, email, emailVerified, etc.)
  // Distinct from ctx.user (AuthUser) which is the Core auth interface set by betterAuthAdapter().
  betterUser: BetterAuthUser | null
  session: BetterAuthSession | null
  auth: BetterAuthInstance
}

export function betterAuthPlugin(
  options: BetterAuthPluginOptions,
  velnAdapter: VelnAdapter,
): Plugin<BaseCtx, AuthCtxAdd> {
  const auth = betterAuth({
    secret: options.secret,
    baseURL: options.baseUrl ?? 'http://localhost',
    trustedOrigins: options.trustedOrigins,
    database: createVelnDbAdapter(velnAdapter),
    emailAndPassword: {
      enabled: true,
    },
  })

  return {
    name: 'betterAuth',

    request: async (ctx: BaseCtx): Promise<BaseCtx & AuthCtxAdd> => {
      let betterUser: BetterAuthUser | null = null
      let session: BetterAuthSession | null = null

      try {
        const sessionData = await auth.api.getSession({ headers: ctx.req.headers })
        if (sessionData) {
          betterUser = sessionData.user
          session = sessionData.session
        }
      } catch {
        // No session / invalid session — betterUser stays null
      }

      return { ...ctx, betterUser, session, auth: auth as BetterAuthInstance }
    },
  }
}

/**
 * Create an onRequest hook that intercepts requests to the auth base path
 * and delegates them to better-auth's handler.
 *
 * Usage:
 * ```ts
 * const auth = betterAuth({ ... })
 * app.onRequest(createOnRequest(createAuthRequestHook(auth)))
 * ```
 */
export function createAuthRequestHook(
  auth: BetterAuthInstance,
  basePath = '/api/auth',
) {
  return async (ctx: BaseCtx): Promise<Response | void> => {
    const url = new URL(ctx.req.url)
    if (url.pathname.startsWith(basePath)) {
      return auth.handler(ctx.req)
    }
  }
}
