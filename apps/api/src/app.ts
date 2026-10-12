import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import * as Sentry from '@sentry/node'
import { env } from './env.js'
import { registerErrorHandlers } from './errors.js'
import { healthRoutes } from './routes/health.js'
import { debugRoutes } from './routes/debug.js'

export async function buildApp() {
  const app = Fastify({
    logger:
      env.APP_ENV === 'test'
        ? false
        : env.APP_ENV === 'development'
          ? { transport: { target: 'pino-pretty' } }
          : true,
    genReqId: () => crypto.randomUUID(),
  })

  if (env.SENTRY_DSN) Sentry.setupFastifyErrorHandler(app)
  registerErrorHandlers(app)

  await app.register(helmet)
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true })

  // The API lives under /api; the root only points people to the web app.
  app.get('/', async () => ({ service: 'crm-api', health: '/api/health', web: env.WEB_ORIGIN }))

  await app.register(
    async (api) => {
      await api.register(healthRoutes)
      if (env.APP_ENV !== 'production') await api.register(debugRoutes)
    },
    { prefix: '/api' },
  )

  return app
}
