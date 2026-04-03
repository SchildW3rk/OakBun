import { defineGuard, UnauthorizedError, ForbiddenError } from 'oakbun'
import type { JwtPayload } from '@oakbun/jwt'

// Works with jwtPlugin — ctx.jwtUser is JwtPayload | undefined
export const requireAuth = defineGuard('requireAuth')
  .options({ log: { level: 'warn' } })
  .check<{ jwtUser?: JwtPayload }>((ctx) => {
    if (!ctx.jwtUser) throw new UnauthorizedError('Authentication required')
  })

export const requireRole = (role: string) =>
  defineGuard(`requireRole:${role}`)
    .options({ log: { level: 'warn' } })
    .check<{ jwtUser?: JwtPayload }>((ctx) => {
      if (!ctx.jwtUser) throw new UnauthorizedError('Authentication required')
      if (ctx.jwtUser['role'] !== role) throw new ForbiddenError(`Role '${role}' required`)
    })
