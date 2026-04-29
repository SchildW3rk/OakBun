import type { OakBunConfig } from '../../config/types'
import { loadAdapter } from './adapter'

export async function migrateRollback(_args: string[], config: OakBunConfig): Promise<void> {
  const { createMigrator } = await import('../../../db/migrations/index')

  const migrationsDir = config.migrations ?? './migrations'
  const adapter       = await loadAdapter(config)
  const migrator      = createMigrator(adapter, { migrationsDir })

  // Show what will be rolled back
  const applied = (await migrator.status()).filter(s => s.status === 'applied')
  if (applied.length === 0) {
    console.log('✅ Nothing to rollback — no migrations applied')
    return
  }

  const last = applied[applied.length - 1]
  await migrator.rollback()
  console.log(`↩️  Rolled back: ${last.name}`)
}
