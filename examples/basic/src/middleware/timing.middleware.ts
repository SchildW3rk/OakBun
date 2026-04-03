import { defineMiddleware } from 'oakbun'

export const timingMiddleware = () =>
  defineMiddleware('timing')
    .options({ log: { level: 'debug' } })
    .onRequest((ctx) => {
      ctx._startTime = Date.now()
    })
    .onResponse((ctx, res) => {
      const start = ctx._startTime
      if (start !== undefined) {
        const ms     = Date.now() - start
        const path   = new URL(ctx.req.url).pathname
        const method = ctx.req.method
        if (ctx.logger) {
          ctx.logger.info(`${method} ${path}`, { ms })
        } else {
          console.log(`  ${method.padEnd(6)} ${path.padEnd(30)} ${ms}ms`)
        }
        delete ctx._startTime
      }
      return res
    })
    .build()
