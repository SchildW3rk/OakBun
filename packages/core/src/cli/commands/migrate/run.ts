import type { OakBunConfig } from '../../config/types'
import { loadAdapter } from './adapter'

export async function migrateRun(_args: string[], config: OakBunConfig): Promise<void> {
  const { createMigrator } = await import('../../../db/migrations/index')

  const migrationsDir = config.migrations ?? './migrations'
  const adapter       = await loadAdapter(config)
  const migrator      = createMigrator(adapter, { migrationsDir })
  const results       = await migrator.run()

  if (results.length === 0) {
    console.log('✅ Nothing to migrate — already up to date')
    return
  }

  for (const r of results) {
    if (r.success) {
      console.log(`✅ ${r.name}  (${r.duration}ms)`)
    } else {
      console.error(`❌ ${r.name}  — ${r.error?.message}`)
    }
  }
}
