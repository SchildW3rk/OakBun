import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OakBunAdapter } from '../../adapter/types'
import type { MigrationResult, MigrationStatus, MigratorOptions } from './types'
import { ensureTable, getApplied, markApplied, markRolledBack } from './tracker'

interface MigrationFile {
  name: string
  sql:  string
}

async function readMigrationFiles(dir: string): Promise<MigrationFile[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }

  const sqlFiles = entries
    .filter(f => f.endsWith('.sql'))
    .sort()  // alphabetical — relies on numeric prefix convention

  const files: MigrationFile[] = []
  for (const filename of sqlFiles) {
    const sql = await readFile(join(dir, filename), 'utf8')
    files.push({ name: filename, sql })
  }
  return files
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let inString = false
  let stringChar = ''
  let i = 0

  while (i < sql.length) {
    const ch = sql[i]

    // Handle single-line comments
    if (!inString && ch === '-' && sql[i + 1] === '-') {
      const newline = sql.indexOf('\n', i)
      if (newline === -1) {
        current += sql.slice(i)
        i = sql.length
      } else {
        current += sql.slice(i, newline + 1)
        i = newline + 1
      }
      continue
    }

    // Handle block comments
    if (!inString && ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      if (end === -1) {
        current += sql.slice(i)
        i = sql.length
      } else {
        current += sql.slice(i, end + 2)
        i = end + 2
      }
      continue
    }

    // Handle string literals
    if (!inString && (ch === "'" || ch === '"')) {
      inString = true
      stringChar = ch
      current += ch
      i++
      continue
    }

    if (inString) {
      if (ch === stringChar) {
        // Check for escaped quote (doubled)
        if (sql[i + 1] === stringChar) {
          current += ch + ch
          i += 2
          continue
        }
        inString = false
        stringChar = ''
      }
      current += ch
      i++
      continue
    }

    if (ch === ';') {
      const trimmed = current.trim()
      if (trimmed) statements.push(trimmed)
      current = ''
      i++
      continue
    }

    current += ch
    i++
  }

  const trimmed = current.trim()
  if (trimmed) statements.push(trimmed)

  return statements
}

export async function run(adapter: OakBunAdapter, opts: MigratorOptions): Promise<MigrationResult[]> {
  const tableName = opts.tableName ?? '_oakbun_migrations'

  await ensureTable(adapter, tableName)

  const files   = await readMigrationFiles(opts.migrationsDir)
  const applied = await getApplied(adapter, tableName)
  const appliedNames = new Set(applied.map(r => r.name))

  const pending = files.filter(f => !appliedNames.has(f.name))

  const results: MigrationResult[] = []
  for (const migration of pending) {
    const t0 = performance.now()
    try {
      await opts.onBeforeMigrate?.({ name: migration.name, sql: migration.sql })
      const statements = splitSqlStatements(migration.sql)
      for (const stmt of statements) {
        if (stmt.trim()) await adapter.execute(stmt, [])
      }
      await markApplied(adapter, tableName, migration.name)
      const durationMs = performance.now() - t0
      await opts.onAfterMigrate?.({ name: migration.name, sql: migration.sql, durationMs })
      results.push({ name: migration.name, success: true, duration: Math.round(durationMs) })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      await opts.onError?.({ name: migration.name, error })
      results.push({ name: migration.name, success: false, duration: Math.round(performance.now() - t0), error })
      break
    }
  }
  return results
}

export async function status(adapter: OakBunAdapter, opts: MigratorOptions): Promise<MigrationStatus[]> {
  const tableName = opts.tableName ?? '_oakbun_migrations'

  await ensureTable(adapter, tableName)

  const files   = await readMigrationFiles(opts.migrationsDir)
  const applied = await getApplied(adapter, tableName)
  const appliedMap = new Map(applied.map(r => [r.name, r]))

  return files.map(f => {
    const record = appliedMap.get(f.name)
    if (record) {
      return { name: f.name, status: 'applied' as const, appliedAt: record.appliedAt }
    }
    return { name: f.name, status: 'pending' as const }
  })
}

export async function rollback(adapter: OakBunAdapter, opts: MigratorOptions): Promise<void> {
  const tableName = opts.tableName ?? '_oakbun_migrations'

  await ensureTable(adapter, tableName)

  const applied = await getApplied(adapter, tableName)
  if (applied.length === 0) return

  const last = applied[applied.length - 1]
  await markRolledBack(adapter, tableName, last.name)
}
