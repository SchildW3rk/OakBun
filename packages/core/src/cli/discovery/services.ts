import { resolve } from 'node:path'
import type { ServiceDef } from '../../service/index'
import type { OakBunConfig } from '../config/types'
import { TABLE_SCAN_PATHS } from '../config/defaults'

function isServiceDef(x: unknown): x is ServiceDef<string, unknown> {
  return (
    typeof x === 'object' &&
    x !== null &&
    '_serviceKey' in x &&
    '_factory' in x
  )
}

function resolveScanPaths(config: OakBunConfig): string[] {
  const cwd      = process.cwd()
  const relative = config.features
    ? [config.features]
    : config.schema
      ? [config.schema]
      : TABLE_SCAN_PATHS
  return relative.map(p => resolve(cwd, p))
}

export async function discoverServices(config: OakBunConfig): Promise<ServiceDef<string, unknown>[]> {
  const found:     ServiceDef<string, unknown>[] = []
  const scanPaths = resolveScanPaths(config)

  for (const absDir of scanPaths) {
    const files = await Array.fromAsync(
      new Bun.Glob('**/*.service.ts').scan({ cwd: absDir, onlyFiles: true }),
    ).catch(() => [] as string[])

    for (const file of files) {
      try {
        const mod = await import(`${absDir}/${file}`) as Record<string, unknown>
        for (const exp of Object.values(mod)) {
          if (isServiceDef(exp)) found.push(exp)
        }
      } catch {
        // Skip files that fail to import
      }
    }

    if (found.length > 0) break  // stop at first path that yields results
  }

  return found
}
