import type { VelnConfig } from '../../config/types'
import { discoverTables } from '../../discovery/tables'
import { loadAdapter } from './adapter'

export async function migrateGenerate(args: string[], config: VelnConfig): Promise<void> {
  const { generateMigration } = await import('../../../db/migrations/index')

  const name   = args[0]
  const tables = await discoverTables(config)

  if (tables.length === 0) {
    console.log('⬜ No tables found. Searched in:')
    console.log('   ./src/features, ./src/schema, ./src/tables, ./src')
    console.log('')
    console.log('   Add a veln.config.ts to specify your schema path:')
    console.log('   export default defineConfig({ schema: "./your/path" })')
    return
  }

  const adapter = await loadAdapter(config)
  const result  = await generateMigration({
    tables,
    adapter,
    migrationsDir: config.migrations ?? './migrations',
    name,
  })

  if (result.isEmpty) {
    console.log('✅ No changes detected — schema is up to date')
    return
  }

  console.log(`✅ Generated: ${result.filename}`)
}
