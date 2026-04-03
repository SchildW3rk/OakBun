import type { Plugin, BaseCtx } from 'oakbun'
import { createLogger }         from './index'
import type { VelnLogger, LoggerOptions } from './types'

export function loggerPlugin(options: LoggerOptions = {}): Plugin<BaseCtx, { logger: VelnLogger }> {
  const logger = createLogger(options)
  return {
    name: 'logger',
    request: (ctx) => ({ ...ctx, logger }),
  }
}
