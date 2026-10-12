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
  // Which proxies may set X-Forwarded-For (the client IP behind rate limits): "true" (any, dev
  // and tests only), a hop count such as "2", or a comma list of proxy IPs/CIDRs.
  TRUST_PROXY: z.string().optional(),
})

export const env = envSchema.parse(process.env)

if (['staging', 'production'].includes(env.APP_ENV) && env.BETTER_AUTH_SECRET.startsWith('dev-only')) {
  throw new Error('BETTER_AUTH_SECRET must be set outside development')
}
// Outside development the database is reached over the internet: insist on TLS.
if (['staging', 'production'].includes(env.APP_ENV)) {
  for (const [name, url] of [['DATABASE_URL', env.DATABASE_URL], ['DATABASE_OWNER_URL', env.DATABASE_OWNER_URL]] as const) {
    if (!/[?&]sslmode=(require|verify-ca|verify-full)\b/.test(url)) throw new Error(`${name} must use TLS (sslmode=verify-full or require)`)
  }
}
// Trusting every X-Forwarded-For would let anyone pick their own IP and slip past login limits.
export function trustProxySetting(): boolean | string[] | ((address: string, hop: number) => boolean) {
  const value = env.TRUST_PROXY ?? (['development', 'test'].includes(env.APP_ENV) ? 'true' : undefined)
  if (value === undefined) throw new Error('TRUST_PROXY must be set outside development (e.g. the number of proxies in front of the API)')
  if (value === 'true') {
    if (!['development', 'test'].includes(env.APP_ENV)) throw new Error('TRUST_PROXY=true is only allowed in development and tests')
    return true
  }
  if (value === 'false') return false
  // The nearest N proxies are trusted; anything further left in the header is the client's own claim.
  if (/^\d+$/.test(value)) {
    const hops = Number(value)
    return (_address, hop) => hop < hops
  }
  return value.split(',').map((s) => s.trim())
}
export type Env = typeof env
