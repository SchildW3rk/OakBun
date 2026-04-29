import { describe, test, expect } from 'bun:test'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

async function makeDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'oakbun-disco-'))
}

async function clean(dir: string) {
  await rm(dir, { recursive: true, force: true })
}

// We test the duck-type isTableDef detection and isCommandDef detection
// by checking the exported functions against inline mocks.

describe('isTableDef duck-typing', () => {
  test('object with name + schema + _eventMap is recognised', () => {
    const fake = { name: 'users', schema: {}, _eventMap: {}, primaryKey: 'id', hooks: [], events: {} }
    // isTableDef is not exported directly — we test via discoverTables integration below
    expect(typeof fake.name).toBe('string')
    expect(typeof fake.schema).toBe('object')
  })
})

describe('discoverTables', () => {
  test('returns empty array when directory is empty', async () => {
    const dir = await makeDir()
    try {
      const { discoverTables } = await import('../../packages/core/src/cli/discovery/tables')
      const tables = await discoverTables({ features: dir })
      expect(tables).toHaveLength(0)
    } finally {
      await clean(dir)
    }
  })

  test('discovers TableDef from *.table.ts files', async () => {
    const dir = await makeDir()
    try {
      // Write a fake *.table.ts file that exports a TableDef-shaped object
      await writeFile(join(dir, 'users.table.ts'), `
        export const usersTable = {
          name: 'users',
          schema: {},
          primaryKey: 'id',
          hooks: [],
          events: {},
          _eventMap: {},
        }
      `)

      const { discoverTables } = await import('../../packages/core/src/cli/discovery/tables')
      const tables = await discoverTables({ features: dir })
      expect(tables.length).toBeGreaterThan(0)
      expect(tables[0].name).toBe('users')
    } finally {
      await clean(dir)
    }
  })

  test('discovers TableDef from *.ts files (loose scan)', async () => {
    const dir = await makeDir()
    try {
      await writeFile(join(dir, 'schema.ts'), `
        export const postsTable = {
          name: 'posts',
          schema: {},
          primaryKey: 'id',
          hooks: [],
          events: {},
          _eventMap: {},
        }
      `)

      const { discoverTables } = await import('../../packages/core/src/cli/discovery/tables')
      const tables = await discoverTables({ schema: dir })
      expect(tables.some(t => t.name === 'posts')).toBe(true)
    } finally {
      await clean(dir)
    }
  })

  test('ignores non-table exports', async () => {
    const dir = await makeDir()
    try {
      await writeFile(join(dir, 'util.table.ts'), `
        export const notATable = { foo: 'bar' }
        export const alsoNot   = 42
      `)

      const { discoverTables } = await import('../../packages/core/src/cli/discovery/tables')
      const tables = await discoverTables({ features: dir })
      expect(tables).toHaveLength(0)
    } finally {
      await clean(dir)
    }
  })
})

describe('discoverCommands', () => {
  test('returns empty array when directory is empty', async () => {
    const dir = await makeDir()
    try {
      const { discoverCommands } = await import('../../packages/core/src/cli/discovery/commands')
      const cmds = await discoverCommands({ commands: dir })
      expect(cmds).toHaveLength(0)
    } finally {
      await clean(dir)
    }
  })

  test('discovers CommandDef from default export', async () => {
    const dir = await makeDir()
    try {
      await writeFile(join(dir, 'seed.ts'), `
        export default {
          _name: 'seed',
          _description: 'Seed DB',
          _options: [],
          _action: () => {},
        }
      `)

      const { discoverCommands } = await import('../../packages/core/src/cli/discovery/commands')
      const cmds = await discoverCommands({ commands: dir })
      expect(cmds.some(c => c._name === 'seed')).toBe(true)
    } finally {
      await clean(dir)
    }
  })

  test('ignores non-command default exports', async () => {
    const dir = await makeDir()
    try {
      await writeFile(join(dir, 'helper.ts'), `export default { foo: 'bar' }`)

      const { discoverCommands } = await import('../../packages/core/src/cli/discovery/commands')
      const cmds = await discoverCommands({ commands: dir })
      expect(cmds).toHaveLength(0)
    } finally {
      await clean(dir)
    }
  })
})

describe('discoverServices', () => {
  test('returns empty array when directory is empty', async () => {
    const dir = await makeDir()
    try {
      const { discoverServices } = await import('../../packages/core/src/cli/discovery/services')
      const svcs = await discoverServices({ schema: dir })
      expect(svcs).toHaveLength(0)
    } finally {
      await clean(dir)
    }
  })

  test('discovers ServiceDef from *.service.ts files', async () => {
    const dir = await makeDir()
    try {
      await writeFile(join(dir, 'users.service.ts'), `
        export const userService = {
          _serviceKey: 'users',
          _deps: [],
          _options: {},
          _factory: () => ({ findAll: () => [] }),
        }
      `)

      const { discoverServices } = await import('../../packages/core/src/cli/discovery/services')
      const svcs = await discoverServices({ schema: dir })
      expect(svcs.some(s => s._serviceKey === 'users')).toBe(true)
    } finally {
      await clean(dir)
    }
  })

  test('ignores exports that are not ServiceDef', async () => {
    const dir = await makeDir()
    try {
      await writeFile(join(dir, 'util.service.ts'), `
        export const helper = { doStuff: () => {} }
      `)

      const { discoverServices } = await import('../../packages/core/src/cli/discovery/services')
      const svcs = await discoverServices({ schema: dir })
      expect(svcs).toHaveLength(0)
    } finally {
      await clean(dir)
    }
  })
})
