import type { AuthAdapter, AuthUser, BaseCtx } from 'oakbun'
import type { BetterAuthInstance } from './plugin.js'

/**
 * betterAuthAdapter — wraps a Better Auth instance as an OakBun AuthAdapter.
 *
 * Usage:
 *   import { betterAuth } from 'better-auth'
 *   import { betterAuthAdapter } from '@oakbun/auth'
 *
 *   const auth = betterAuth({ ... })
 *
 *   createApp({
 *     auth: betterAuthAdapter(auth),
 *   })
 *
 * Permissions:
 *   Better Auth does not ship a built-in permissions array on the session user.
 *   This adapter maps `user.role` (if present) to a single permission string
 *   using the pattern "role:<value>" — e.g. role "admin" → ["role:admin"].
 *
 *   For fine-grained permissions, extend the Better Auth session schema with a
 *   `permissions` field and this adapter will pick it up automatically.
 *
 *   Priority:
 *     1. user.permissions (string[]) — if Better Auth session has this field
 *     2. user.role (string)          — mapped to ["role:<value>"]
 *     3. []                          — no permissions
 */
export function betterAuthAdapter(auth: BetterAuthInstance): AuthAdapter {
  return {
    async getUser(ctx: BaseCtx): Promise<AuthUser | null> {
      try {
        const sessionData = await auth.api.getSession({ headers: ctx.req.headers })
        if (!sessionData) return null

        const raw = sessionData.user as Record<string, unknown>
        const id = String(raw['id'] ?? '')
        if (!id) return null

        // Prefer explicit permissions array, fall back to role-based mapping
        let permissions: string[]
        if (Array.isArray(raw['permissions'])) {
          permissions = (raw['permissions'] as unknown[]).map(String)
        } else if (typeof raw['role'] === 'string' && raw['role']) {
          permissions = [`role:${raw['role']}`]
        } else {
          permissions = []
        }

        return { id, permissions }
      } catch {
        return null
      }
    },

    hasPermission(user: AuthUser, permission: string): boolean {
      return user.permissions.includes(permission)
    },
  }
}
