import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import * as Sentry from '@sentry/node'
import { env, trustProxySetting } from './env.js'
import { HttpError, registerErrorHandlers } from './errors.js'
import { authContext } from './auth/context.js'
import { DEFAULT_LIMIT, rateLimitError } from './http/limits.js'
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
import { activityRoutes } from './routes/activities.js'
import { dataRoutes } from './routes/data.js'

declare module 'fastify' {
  interface FastifyInstance {
    routeList: Array<{ method: string; url: string }>
  }
}

function requestOrigin(headers: Record<string, string | string[] | undefined>) {
  if (typeof headers.origin === 'string') return headers.origin
  if (typeof headers.referer !== 'string') return null
  try {
    return new URL(headers.referer).origin
  } catch {
    return null
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export async function buildApp() {
  const app = Fastify({
    logger:
      env.APP_ENV === 'test'
        ? false
        : {
            ...(env.APP_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
            // Query strings carry search terms, names and emails: log the path only.
            serializers: {
              req: (req: { method: string; url: string; id: string }) => ({ id: req.id, method: req.method, path: req.url.split('?')[0] }),
            },
          },
    genReqId: () => crypto.randomUUID(),
    // Behind Railway/Vercel the client IP comes from X-Forwarded-For, set by trusted proxies only.
    trustProxy: trustProxySetting(),
  })

  // Every route, for the permission-matrix test (which fails when a route has no rule).
  const routes: Array<{ method: string; url: string }> = []
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) if (method !== 'HEAD') routes.push({ method, url: route.url })
  })
  app.decorate('routeList', routes)

  if (env.SENTRY_DSN) Sentry.setupFastifyErrorHandler(app)
  registerErrorHandlers(app)

  await app.register(helmet)
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true })
  // After authentication (preHandler), so limits can be per user and per workspace.
  await app.register(rateLimit, {
    global: true,
    hook: 'preHandler',
    ...DEFAULT_LIMIT,
    errorResponseBuilder: rateLimitError,
    allowList: (request) => !request.url.startsWith('/api/') || request.url.startsWith('/api/health'),
  })

  // CSRF: the session is a cookie, so state-changing requests from a browser must come from our
  // own origin. Better Auth checks its own routes; this covers the rest of the API.
  // A request without Origin (or Referer) is refused too, so this does not rest on browser habits.
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method) || request.url.startsWith('/api/auth/')) return
    if (requestOrigin(request.headers) !== env.WEB_ORIGIN) throw new HttpError(403, 'invalid_origin', 'Request origin not allowed')
  })

  // API responses are one user's view of one workspace: never cache them in browsers or proxies
  // (the web app reaches the API through a Vercel rewrite).
  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'no-store')
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
      await api.register(activityRoutes)
      await api.register(dataRoutes)
      // Only on a developer's machine: anywhere else it would let anyone flood Sentry.
      if (env.APP_ENV === 'development') await api.register(debugRoutes)
    },
    { prefix: '/api' },
  )

  return app
}
