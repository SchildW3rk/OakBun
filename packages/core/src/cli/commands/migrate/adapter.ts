import { resolve } from 'node:path'
import type { OakBunAdapter } from '../../../adapter/types'
import type { OakBunConfig } from '../../config/types'

/**
 * Loads the adapter for CLI commands.
 * Resolves all paths relative to process.cwd() — the directory where the
 * user invokes `bunx oakbun`, not the location of this CLI source file.
 *
 * Resolution order:
 *   1. src/db.ts (or src/db/index.ts, src/database.ts) — exports `adapter`
 *   2. *.sqlite file in project root — opened directly
 *   3. In-memory SQLite fallback
 */
export async function loadAdapter(config: OakBunConfig = {}): Promise<OakBunAdapter> {
  const cwd = process.cwd()

  // 1. Use adapter from config if provided
  if (config.adapter) return config.adapter

  // 2. Try to load adapter exported from project's db entry point
  const candidates = [
    'src/db.ts',
    'src/db/index.ts',
    'src/database.ts',
  ]

  for (const rel of candidates) {
    const abs = resolve(cwd, rel)
    if (await Bun.file(abs).exists()) {
      try {
        const mod = await import(abs) as { adapter?: OakBunAdapter }
        if (
          mod.adapter &&
          typeof mod.adapter.query   === 'function' &&
          typeof mod.adapter.execute === 'function'
        ) {
          return mod.adapter
        }
      } catch {
        // Continue to next candidate
      }
    }
  }

  const { SQLiteAdapter } = await import('../../../adapter/sqlite')

  // 3. Find a *.sqlite or *.db file in the project root
  const sqliteFiles = await Array.fromAsync(
    new Bun.Glob('*.{sqlite,db}').scan({ cwd, onlyFiles: true }),
  ).catch(() => [] as string[])

  if (sqliteFiles.length > 0) {
    return new SQLiteAdapter({ path: resolve(cwd, sqliteFiles[0]) })
  }

  // 4. In-memory fallback (useful for migrate:generate with no real DB)
  return new SQLiteAdapter()
}
