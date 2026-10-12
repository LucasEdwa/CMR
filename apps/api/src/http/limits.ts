import type { FastifyRequest } from 'fastify'
import { HttpError } from '../errors.js'

// Per-route rate limits. The limiter runs after authentication (hook: preHandler), so limits can be
// per user or per workspace: one customer's heavy use never slows down another customer.
// Counters live in memory: fine for one API instance; move them to Redis before scaling out.

type Scope = 'user' | 'workspace' | 'ip'

const keyFor = (scope: Scope, name: string) => (request: FastifyRequest) => {
  const t = request.tenant
  if (scope === 'workspace' && t) return `${name}:w:${t.tenantId}`
  if (scope === 'user' && t) return `${name}:u:${t.tenantId}:${t.userId}`
  if (scope === 'user' && request.authSession) return `${name}:u:${request.authSession.user.id}`
  return `${name}:ip:${request.ip}`
}

// Route options: { config: limit('export', 20, '10 minutes') }
export const limit = (name: string, max: number, timeWindow: string, scope: Scope = 'user') => ({
  rateLimit: { max, timeWindow, keyGenerator: keyFor(scope, name) },
})

// Every API route: a ceiling no normal use comes near, against scripts and runaway clients.
export const DEFAULT_LIMIT = { max: 1200, timeWindow: '1 minute', keyGenerator: keyFor('user', 'api') }

export const rateLimitError = (_request: FastifyRequest, context: { after: string }) =>
  new HttpError(429, 'rate_limited', `Too many requests. Try again in ${context.after}.`)
