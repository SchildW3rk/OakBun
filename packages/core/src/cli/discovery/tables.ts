import { resolve } from 'node:path'
import type { TableDef } from '../../schema/table'
import type { SchemaMap } from '../../schema/table'
import type { OakBunConfig } from '../config/types'
import { TABLE_SCAN_PATHS } from '../config/defaults'

function isTableDef(x: unknown): x is TableDef<unknown, SchemaMap> {
  return (
    typeof x === 'object' &&
    x !== null &&
    'name' in x &&
    'schema' in x &&
    '_eventMap' in x
  )
}

function resolveScanPaths(config: OakBunConfig): string[] {
  // Return absolute paths resolved from process.cwd() so import() finds the
  // user's project files regardless of where the CLI source file lives.
  const cwd      = process.cwd()
  const relative = config.features
    ? [config.features]
    : config.schema
      ? [config.schema]
      : config.tables
        ? [config.tables]
        : TABLE_SCAN_PATHS
  return relative.map(p => resolve(cwd, p))
}

async function scanDir(absDir: string, pattern: string): Promise<TableDef<unknown, SchemaMap>[]> {
  const tables: TableDef<unknown, SchemaMap>[] = []

  const files = await Array.fromAsync(
    new Bun.Glob(pattern).scan({ cwd: absDir, onlyFiles: true }),
  ).catch(() => [] as string[])

  for (const file of files) {
    try {
      // Use absolute path so Bun resolves the import from the project root,
      // not relative to this CLI source file.
      const mod = await import(`${absDir}/${file}`) as Record<string, unknown>
      for (const exp of Object.values(mod)) {
        if (isTableDef(exp)) tables.push(exp)
      }
    } catch {
      // Skip files that fail to import
    }
  }

  return tables
}

export async function discoverTables(config: OakBunConfig): Promise<TableDef<unknown, SchemaMap>[]> {
  const scanPaths = resolveScanPaths(config)

  for (const scanPath of scanPaths) {
    // scan() throws if dir doesn't exist — .catch(() => []) handles missing dirs
    const byConvention = await scanDir(scanPath, '**/*.table.ts')
    if (byConvention.length > 0) return byConvention

    const loose = await scanDir(scanPath, '**/*.ts')
    if (loose.length > 0) return loose
  }

  return []
}
