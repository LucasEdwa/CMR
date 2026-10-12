import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import * as Sentry from '@sentry/node'
import { env } from './env.js'
import { HttpError, registerErrorHandlers } from './errors.js'
import { authContext } from './auth/context.js'
import { authRoutes } from './routes/auth.js'
import { healthRoutes } from './routes/health.js'
import { debugRoutes } from './routes/debug.js'
import { meRoutes } from './routes/me.js'
import { workspaceRoutes } from './routes/workspaces.js'
import { memberRoutes } from './routes/members.js'
import { invitationRoutes } from './routes/invitations.js'
import { contactRoutes } from './routes/contacts.js'
import { companyRoutes } from './routes/companies.js'
import { recordRoutes } from './routes/records.js'
import { dealRoutes } from './routes/deals.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export async function buildApp() {
  const app = Fastify({
    logger:
      env.APP_ENV === 'test'
        ? false
        : env.APP_ENV === 'development'
          ? { transport: { target: 'pino-pretty' } }
          : true,
    genReqId: () => crypto.randomUUID(),
    // Behind Railway/Vercel the client IP comes from x-forwarded-for (rate limits use it).
    trustProxy: true,
  })

  if (env.SENTRY_DSN) Sentry.setupFastifyErrorHandler(app)
  registerErrorHandlers(app)

  await app.register(helmet)
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true })
  await app.register(rateLimit, { global: false })

  // CSRF: the session is a cookie, so state-changing requests from a browser must come from our
  // own origin. Better Auth checks its own routes; this covers the rest of the API.
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method) || request.url.startsWith('/api/auth/')) return
    const origin = request.headers.origin
    if (origin && origin !== env.WEB_ORIGIN) throw new HttpError(403, 'invalid_origin', 'Request origin not allowed')
  })

  // The API lives under /api; the root only points people to the web app.
  app.get('/', async () => ({ service: 'crm-api', health: '/api/health', web: env.WEB_ORIGIN }))

  await app.register(
    async (api) => {
      await api.register(authContext)
      await api.register(healthRoutes)
      await api.register(authRoutes)
      await api.register(meRoutes)
      await api.register(workspaceRoutes)
      await api.register(memberRoutes)
      await api.register(invitationRoutes)
      await api.register(contactRoutes)
      await api.register(companyRoutes)
      await api.register(recordRoutes)
      await api.register(dealRoutes)
      if (env.APP_ENV !== 'production') await api.register(debugRoutes)
    },
    { prefix: '/api' },
  )

  return app
}
