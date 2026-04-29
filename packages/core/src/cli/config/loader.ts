import { resolve } from 'node:path'
import type { OakBunConfig } from './types'

export async function loadConfig(): Promise<OakBunConfig> {
  const candidates = ['oak.config.ts', 'oak.config.js', 'oakbun.config.ts', 'oakbun.config.js']

  for (const rel of candidates) {
    const abs = resolve(process.cwd(), rel)
    if (await Bun.file(abs).exists()) {
      const mod = await import(abs) as { default?: OakBunConfig }
      return mod.default ?? {}
    }
  }

  return {}
}
