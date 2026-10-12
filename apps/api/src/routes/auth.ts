import type { FastifyInstance } from 'fastify'
import { fromNodeHeaders } from 'better-auth/node'
import { auth } from '../auth/auth.js'
import { env } from '../env.js'
import { clearFailures, isLockedOut, recordFailure } from '../auth/login-failures.js'
import { HttpError } from '../errors.js'
import { recordSecurityEvent, twoFactorEnabled, userIdByEmail, userIdByResetToken, userIdOfNewSession } from '../auth/security-log.js'

// Better Auth's own rate limits read X-Forwarded-For. Hand it the IP Fastify resolved through
// the trusted proxies, never the raw header a client could write itself.
export function withClientIp(headers: Headers, ip: string) {
  headers.set('x-forwarded-for', ip)
  return headers
}

// Paths that start a session (a successful one is logged as a login).
const LOGIN_PATHS = ['/sign-in/email', '/two-factor/verify-totp', '/two-factor/verify-backup-code', '/verify-email']
// Paths whose security event needs the current user, read before Better Auth acts.
const SESSION_PATHS = ['/sign-out', '/change-password', '/two-factor/']

// Mounts Better Auth (signup, login, logout, verification, password reset) under /api/auth/*.
export async function authRoutes(app: FastifyInstance) {
  app.route({
    method: ['GET', 'POST'],
    url: '/auth/*',
    async handler(request, reply) {
      const url = new URL(request.url, env.WEB_ORIGIN)
      const path = url.pathname.replace(/^\/api\/auth/, '')
      const isSignIn = request.method === 'POST' && path === '/sign-in/email'
      const email = isSignIn ? String((request.body as { email?: unknown } | undefined)?.email ?? '') : ''
      if (isSignIn && (await isLockedOut(request.ip, email))) {
        throw new HttpError(429, 'rate_limited', 'Too many failed attempts. Try again in 15 minutes.')
      }

      // For the security log: who is acting, before Better Auth changes or ends the session.
      const before = SESSION_PATHS.some((p) => path.startsWith(p))
        ? await auth.api.getSession({ headers: fromNodeHeaders(request.headers) }).catch(() => null)
        : null
      const twoFactorBefore = before && path.startsWith('/two-factor/') ? await twoFactorEnabled(before.user.id) : null
      const resetUser =
        path === '/reset-password' ? await userIdByResetToken(String((request.body as { token?: unknown } | undefined)?.token ?? '')) : null

      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: withClientIp(fromNodeHeaders(request.headers), request.ip),
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
        }),
      )
      if (isSignIn && response.status === 401) await recordFailure(request.ip, email)
      if (isSignIn && response.status === 200) await clearFailures(request.ip, email)

      const ok = response.status < 400
      const cookies = response.headers.getSetCookie()
      if (isSignIn && response.status === 401) {
        const userId = await userIdByEmail(email)
        if (userId) await recordSecurityEvent(request, userId, 'login_failed')
      }
      if (ok && LOGIN_PATHS.includes(path)) {
        const userId = await userIdOfNewSession(cookies)
        if (userId) await recordSecurityEvent(request, userId, 'login')
      }
      if (ok && path === '/sign-out' && before) await recordSecurityEvent(request, before.user.id, 'logout')
      if (ok && path === '/change-password' && before) await recordSecurityEvent(request, before.user.id, 'password_changed')
      if (ok && resetUser) await recordSecurityEvent(request, resetUser, 'password_changed')
      if (ok && before && twoFactorBefore !== null) {
        const now = await twoFactorEnabled(before.user.id)
        if (now !== twoFactorBefore) await recordSecurityEvent(request, before.user.id, now ? 'two_factor_enabled' : 'two_factor_disabled')
      }

      reply.status(response.status)
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') reply.header(key, value)
      })
      if (cookies.length) reply.header('set-cookie', cookies)
      // Better Auth's own response (JSON, or empty with a redirect) is passed through with its content
      // type; helmet sends nosniff, so it is never rendered as HTML.
      // nosemgrep: direct-response-write
      return reply.send(response.body ? await response.text() : null)
    },
  })
}
