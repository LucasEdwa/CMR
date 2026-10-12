import type { FastifyInstance } from 'fastify'
import { fromNodeHeaders } from 'better-auth/node'
import { auth } from '../auth/auth.js'
import { env } from '../env.js'
import { clearFailures, isLockedOut, recordFailure } from '../auth/login-failures.js'
import { HttpError } from '../errors.js'

// Mounts Better Auth (signup, login, logout, verification, password reset) under /api/auth/*.
export async function authRoutes(app: FastifyInstance) {
  app.route({
    method: ['GET', 'POST'],
    url: '/auth/*',
    async handler(request, reply) {
      const url = new URL(request.url, env.WEB_ORIGIN)
      const isSignIn = request.method === 'POST' && url.pathname === '/api/auth/sign-in/email'
      const email = isSignIn ? String((request.body as { email?: unknown } | undefined)?.email ?? '') : ''
      if (isSignIn && (await isLockedOut(request.ip, email))) {
        throw new HttpError(429, 'rate_limited', 'Too many failed attempts. Try again in 15 minutes.')
      }

      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
        }),
      )
      if (isSignIn && response.status === 401) await recordFailure(request.ip, email)
      if (isSignIn && response.status === 200) await clearFailures(request.ip, email)

      reply.status(response.status)
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') reply.header(key, value)
      })
      const cookies = response.headers.getSetCookie()
      if (cookies.length) reply.header('set-cookie', cookies)
      return reply.send(response.body ? await response.text() : null)
    },
  })
}
