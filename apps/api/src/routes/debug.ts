import type { FastifyInstance } from 'fastify'

// Not registered in production. Used to check that errors reach Sentry.
export async function debugRoutes(app: FastifyInstance) {
  app.get('/debug/error', async () => {
    throw new Error('Test error from /api/debug/error')
  })
}
