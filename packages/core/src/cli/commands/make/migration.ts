import { readdir, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { VelnConfig } from '../../config/types'

async function nextMigrationNumber(dir: string): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return 1
  }

  const nums = entries
    .filter(f => f.endsWith('.sql'))
    .map(f => {
      const match = /^(\d+)/.exec(f)
      return match ? parseInt(match[1], 10) : 0
    })

  return nums.length === 0 ? 1 : Math.max(...nums) + 1
}

export async function makeMigration(args: string[], config: VelnConfig): Promise<void> {
  const name           = args[0] ?? 'migration'
  const migrationsDir  = config.migrations ?? './migrations'
  const num            = await nextMigrationNumber(migrationsDir)
  const numStr         = String(num).padStart(4, '0')
  const filename       = `${numStr}_${name}.sql`
  const filepath       = join(migrationsDir, filename)

  await mkdir(migrationsDir, { recursive: true })
  await writeFile(filepath, `-- Migration: ${name}\n-- Created: ${new Date().toISOString()}\n\n`, 'utf8')

  console.log(`✅ Created: ${filepath}`)
}
