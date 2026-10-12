import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server.ts', 'src/instrument.ts', 'src/db/migrate.ts'],
  format: 'esm',
  target: 'node24',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source, so bundle them into the API build.
  noExternal: [/^@crm\//],
})
