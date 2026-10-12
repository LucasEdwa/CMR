import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_OWNER_URL ?? 'postgres://crm_owner:crm_owner@localhost:5432/crm',
  },
})
