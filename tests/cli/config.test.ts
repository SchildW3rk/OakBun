import { describe, test, expect } from 'bun:test'
import { defineConfig, defineCommand } from '../../packages/core/src/cli/config/types'
import type { OakBunConfig } from '../../packages/core/src/cli/config/types'

describe('defineConfig', () => {
  test('returns config as-is', () => {
    const cfg: OakBunConfig = { migrations: './db/migrations', schema: './src/schema' }
    expect(defineConfig(cfg)).toStrictEqual(cfg)
  })

  test('works with empty config', () => {
    expect(defineConfig({})).toStrictEqual({})
  })
})

describe('defineCommand', () => {
  test('builds a CommandDef with name', () => {
    const cmd = defineCommand('seed')
      .description('Seed the database')
      .action(() => {})

    expect(cmd._name).toBe('seed')
    expect(cmd._description).toBe('Seed the database')
    expect(typeof cmd._action).toBe('function')
  })

  test('builds options', () => {
    const cmd = defineCommand('test')
      .option('--env <env>', 'Environment', 'development')
      .action(() => {})

    expect(cmd._options).toHaveLength(1)
    expect(cmd._options[0].flag).toBe('--env <env>')
    expect(cmd._options[0].default).toBe('development')
  })

  test('action receives args and can be called', async () => {
    let received: Record<string, string> = {}

    const cmd = defineCommand('greet')
      .action((args) => { received = args })

    await cmd._action({ name: 'Alice' })
    expect(received).toStrictEqual({ name: 'Alice' })
  })

  test('multiple options', () => {
    const cmd = defineCommand('deploy')
      .option('--env <env>',     'Target environment')
      .option('--tag <tag>',     'Git tag',             'latest')
      .action(() => {})

    expect(cmd._options).toHaveLength(2)
    expect(cmd._options[1].default).toBe('latest')
  })
})
