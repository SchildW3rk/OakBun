import { resolve } from 'node:path'
import type { CommandDef } from '../config/types'
import type { VelnConfig } from '../config/types'
import { COMMAND_SCAN_PATHS } from '../config/defaults'

function isCommandDef(x: unknown): x is CommandDef {
  return (
    typeof x === 'object' &&
    x !== null &&
    '_name' in x &&
    '_action' in x
  )
}

function resolveCommandPaths(config: VelnConfig): string[] {
  const cwd      = process.cwd()
  const relative = config.commands
    ? [config.commands]
    : config.features
      ? [config.features]
      : COMMAND_SCAN_PATHS
  return relative.map(p => resolve(cwd, p))
}

export async function discoverCommands(config: VelnConfig): Promise<CommandDef[]> {
  const commands:  CommandDef[] = []
  const scanPaths = resolveCommandPaths(config)

  for (const absPath of scanPaths) {
    const pattern = absPath.includes('features') ? '**/*.command.ts' : '**/*.ts'

    const files = await Array.fromAsync(
      new Bun.Glob(pattern).scan({ cwd: absPath, onlyFiles: true }),
    ).catch(() => [] as string[])

    for (const file of files) {
      try {
        const mod = await import(`${absPath}/${file}`) as { default?: unknown }
        if (isCommandDef(mod.default)) commands.push(mod.default)
      } catch {
        // Skip
      }
    }
  }

  return commands
}
