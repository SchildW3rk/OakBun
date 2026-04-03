import type { VelnConfig } from '../../config/types'
import { loadAdapter } from './adapter'

export async function migrateStatus(_args: string[], config: VelnConfig): Promise<void> {
  const { createMigrator } = await import('../../../db/migrations/index')

  const migrationsDir = config.migrations ?? './migrations'
  const adapter       = await loadAdapter(config)
  const migrator      = createMigrator(adapter, { migrationsDir })
  const statuses      = await migrator.status()

  if (statuses.length === 0) {
    console.log('No migration files found in', migrationsDir)
    return
  }

  for (const s of statuses) {
    const icon = s.status === 'applied' ? '✅' : '⬜'
    const date = s.appliedAt ? `  (${s.appliedAt.toISOString()})` : ''
    console.log(`${icon} ${s.name}${date}`)
  }
}
