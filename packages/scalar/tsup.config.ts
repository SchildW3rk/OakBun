import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    external: ['bun', 'oakbun'],
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: { only: true },
    outDir: 'dist',
    external: ['bun'],
  },
])
