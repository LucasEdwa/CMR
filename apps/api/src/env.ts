import { z } from 'zod'

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3001),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().default('postgres://app_user:app_user@localhost:5432/crm'),
  DATABASE_OWNER_URL: z.string().default('postgres://crm_owner:crm_owner@localhost:5432/crm'),
  RUN_WORKER: z.stringbool().default(true),
  SENTRY_DSN: z.string().optional(),
  // Signs auth tokens. Must be a long random string outside development and test.
  BETTER_AUTH_SECRET: z.string().min(32).default('dev-only-secret-change-me-0123456789abcdef'),
  // smtp://user:pass@host:port. Mailpit locally; the provider's SMTP endpoint on staging/production.
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  EMAIL_FROM: z.string().default('CRM <no-reply@crm.local>'),
  // queue: send through pg-boss with retries. direct: send in the request. memory: tests only.
  EMAIL_DELIVERY: z.enum(['queue', 'direct', 'memory']).default('queue'),
  RELEASE: z.string().default('dev'),
})

export const env = envSchema.parse(process.env)

if (['staging', 'production'].includes(env.APP_ENV) && env.BETTER_AUTH_SECRET.startsWith('dev-only')) {
  throw new Error('BETTER_AUTH_SECRET must be set outside development')
}
export type Env = typeof env
