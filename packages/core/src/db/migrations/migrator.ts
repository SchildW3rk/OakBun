import type { VelnAdapter } from '../../adapter/types'
import type { AdapterConfig } from '../../adapter/resolve'
import { resolveAdapter } from '../../adapter/resolve'
import type { MigrationResult, MigrationStatus, MigratorOptions } from './types'
import { run, status, rollback } from './runner'

export interface Migrator {
  run():      Promise<MigrationResult[]>
  status():   Promise<MigrationStatus[]>
  rollback(): Promise<void>
}

export function createMigrator(adapterOrConfig: AdapterConfig | VelnAdapter, options: MigratorOptions): Migrator {
  const adapter = resolveAdapter(adapterOrConfig)
  return {
    run:      () => run(adapter, options),
    status:   () => status(adapter, options),
    rollback: () => rollback(adapter, options),
  }
}
