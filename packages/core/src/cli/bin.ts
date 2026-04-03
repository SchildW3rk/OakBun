#!/usr/bin/env bun

import { loadConfig }       from './config/loader'
import { discoverCommands } from './discovery/commands'
import { migrateRun }       from './commands/migrate/run'
import { migrateStatus }    from './commands/migrate/status'
import { migrateGenerate }  from './commands/migrate/generate'
import { migrateRollback }  from './commands/migrate/rollback'
import { makeMigration }    from './commands/make/migration'
import { tinker }           from './commands/tinker'
import type { VelnConfig }  from './config/types'

type BuiltinHandler = (args: string[], config: VelnConfig) => Promise<void>

const BUILTIN: Record<string, BuiltinHandler> = {
  'migrate:run':      migrateRun,
  'migrate:status':   migrateStatus,
  'migrate:generate': migrateGenerate,
  'migrate:rollback': migrateRollback,
  'make:migration':   makeMigration,
  'shell':            tinker,
}

function parseArgs(argv: string[], options: { flag: string }[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    for (const opt of options) {
      // Extract flag name from '--flag <value>' pattern
      const match = /^--(\w[\w-]*)/.exec(opt.flag)
      if (!match) continue
      const key = match[1]
      if (arg === `--${key}` && argv[i + 1]) {
        result[key] = argv[++i]
      } else if (arg.startsWith(`--${key}=`)) {
        result[key] = arg.slice(`--${key}=`.length)
      }
    }
    // Positional args stored by index
    if (!arg.startsWith('-')) {
      result[String(i)] = arg
    }
  }
  return result
}

function printHelp(): void {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  OakBun CLI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Migrations
  oak migrate:run              Run pending migrations
  oak migrate:status           Show migration status
  oak migrate:generate [name]  Generate migration from schema diff
  oak migrate:rollback         Rollback last migration

  Generators
  oak make:migration [name]    Create empty migration file

  Interactive
  oak shell                    Start interactive shell with DB access

  Custom commands from src/commands/ or oak.config.ts are
  automatically discovered and available here.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`.trim())
}

async function main(): Promise<void> {
  const [,, command, ...rest] = process.argv

  if (!command || command === '--help' || command === '-h') {
    printHelp()
    process.exit(0)
  }

  const config = await loadConfig()

  const builtin = BUILTIN[command]
  if (builtin) {
    await builtin(rest, config)
    process.exit(0)
  }

  // Discover custom commands
  const customs = await discoverCommands(config)
  const custom  = customs.find(c => c._name === command)

  if (custom) {
    const parsed = parseArgs(rest, custom._options)
    await custom._action(parsed)
    process.exit(0)
  }

  console.error(`Unknown command: ${command}`)
  printHelp()
  process.exit(1)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
