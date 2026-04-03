import { resolve } from 'node:path'
import type { VelnConfig } from './types'

export async function loadConfig(): Promise<VelnConfig> {
  const candidates = ['veln.config.ts', 'veln.config.js']

  for (const rel of candidates) {
    const abs = resolve(process.cwd(), rel)
    if (await Bun.file(abs).exists()) {
      const mod = await import(abs) as { default?: VelnConfig }
      return mod.default ?? {}
    }
  }

  return {}
}
