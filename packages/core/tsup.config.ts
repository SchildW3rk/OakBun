import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      index:             'src/index.ts',
      'adapter/sqlite':  'src/adapter/sqlite.ts',
      'adapter/postgres': 'src/adapter/postgres.ts',
      'adapter/mysql':   'src/adapter/mysql.ts',
    },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    external: ['bun', 'zod', 'bun:sqlite'],
  },
  {
    entry: {
      'cli/bin': 'src/cli/bin.ts',
    },
    format: ['esm'],
    dts: false,
    sourcemap: false,
    outDir: 'dist',
    external: ['bun', 'zod', 'bun:sqlite'],
    banner: {
      js: '#!/usr/bin/env bun',
    },
  },
])
