import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { VelnAdapter } from '../../adapter/types'
import type { TableDef } from '../../schema/table'
import type { SchemaMap } from '../../schema/table'
import type { SchemaDiff, ColumnDef } from './types'
import { introspectSchema } from './introspect'
import { compareSchemas } from './diff'

export interface GenerateOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tables:        TableDef<any, SchemaMap>[]
  adapter:       VelnAdapter
  migrationsDir: string
  name?:         string
  /**
   * When true, generates executable SQL for column drops and type changes
   * instead of commented-out warnings.
   *
   * @remarks
   * ⚠️  DESTRUCTIVE: Generates SQL that permanently drops columns or changes types.
   * Always review generated migrations before applying in production.
   * Back up your database before running destructive migrations.
   */
  allowDestructive?: boolean
}

export interface GenerateResult {
  filename: string
  sql:      string
  isEmpty:  boolean
}

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

function formatNumber(n: number): string {
  return String(n).padStart(4, '0')
}

function columnToSql(col: ColumnDef): string {
  let def = `"${col.name}" ${col.type}`
  if (col.primaryKey)       def += ' PRIMARY KEY'
  if (!col.nullable && !col.primaryKey) def += ' NOT NULL'
  if (col.unique)           def += ' UNIQUE'
  if (col.default !== undefined) def += ` DEFAULT ${col.default}`
  return def
}

function generateSql(diff: SchemaDiff, allowDestructive = false): string {
  const lines: string[] = []

  // Added tables → CREATE TABLE IF NOT EXISTS
  for (const table of diff.addedTables) {
    const cols = table.columns.map(columnToSql)
    lines.push(`CREATE TABLE IF NOT EXISTS "${table.name}" (`)
    lines.push(cols.map((c, i) => `  ${c}${i < cols.length - 1 ? ',' : ''}`).join('\n'))
    lines.push(');')
    lines.push('')

    for (const idx of table.indexes) {
      const unique = idx.unique ? 'UNIQUE ' : ''
      const cols   = idx.columns.map(c => `"${c}"`).join(', ')
      lines.push(`CREATE ${unique}INDEX IF NOT EXISTS "${idx.name}" ON "${table.name}" (${cols});`)
      lines.push('')
    }
  }

  // Dropped tables
  for (const name of diff.droppedTables) {
    if (allowDestructive) {
      lines.push(`DROP TABLE IF EXISTS "${name}";`)
    } else {
      lines.push(`-- WARNING: DROP TABLE "${name}" -- uncomment to apply`)
    }
    lines.push('')
  }

  // Modified tables
  for (const mod of diff.modifiedTables) {
    for (const col of mod.addedColumns) {
      const colSql = columnToSql(col)
      lines.push(`ALTER TABLE "${mod.name}" ADD COLUMN ${colSql};`)
      lines.push('')
    }

    for (const name of mod.droppedColumns) {
      if (allowDestructive) {
        lines.push(`ALTER TABLE "${mod.name}" DROP COLUMN "${name}";`)
      } else {
        lines.push(`-- WARNING: ALTER TABLE "${mod.name}" DROP COLUMN "${name}" -- uncomment to apply`)
      }
      lines.push('')
    }

    for (const change of mod.modifiedColumns) {
      if (allowDestructive) {
        lines.push(`ALTER TABLE "${mod.name}" ALTER COLUMN "${change.name}" TYPE ${change.after.type};`)
      } else {
        lines.push(`-- WARNING: column type change for "${mod.name}"."${change.name}" requires manual migration`)
        lines.push(`--   before: ${change.before.type}`)
        lines.push(`--   after:  ${change.after.type}`)
      }
      lines.push('')
    }

    for (const idx of mod.addedIndexes) {
      const unique = idx.unique ? 'UNIQUE ' : ''
      const cols   = idx.columns.map(c => `"${c}"`).join(', ')
      lines.push(`CREATE ${unique}INDEX IF NOT EXISTS "${idx.name}" ON "${mod.name}" (${cols});`)
      lines.push('')
    }

    for (const name of mod.droppedIndexes) {
      lines.push(`DROP INDEX IF EXISTS "${name}";`)
      lines.push('')
    }
  }

  return lines.join('\n').trimEnd()
}

export async function generateMigration(options: GenerateOptions): Promise<GenerateResult> {
  const current = await introspectSchema(options.adapter)
  const diff    = compareSchemas(current, options.tables)

  const isEmpty =
    diff.addedTables.length    === 0 &&
    diff.droppedTables.length  === 0 &&
    diff.modifiedTables.length === 0

  const sql = isEmpty ? '' : generateSql(diff, options.allowDestructive ?? false)

  const num      = await nextMigrationNumber(options.migrationsDir)
  const suffix   = options.name ?? new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 15)
  const filename = `${formatNumber(num)}_${suffix}.sql`

  if (!isEmpty) {
    await writeFile(join(options.migrationsDir, filename), sql + '\n', 'utf8')
  }

  return { filename, sql, isEmpty }
}
