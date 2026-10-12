import { z } from 'zod'

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3001),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().default('postgres://app_user:app_user@localhost:5432/crm'),
  DATABASE_OWNER_URL: z.string().default('postgres://crm_owner:crm_owner@localhost:5432/crm'),
  RUN_WORKER: z.stringbool().default(true),
  SENTRY_DSN: z.string().optional(),
  RELEASE: z.string().default('dev'),
})

export const env = envSchema.parse(process.env)
export type Env = typeof env
