import type { FastifyInstance, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { fromNodeHeaders } from 'better-auth/node'
import { and, asc, eq } from 'drizzle-orm'
import type { Role } from '@crm/shared'
import { db } from '../db/client.js'
import { memberships, sessions, tenants } from '../db/schema.js'
import { withUser, type TenantContext } from '../db/tenant.js'
import { HttpError } from '../errors.js'
import { auth, type AuthSession } from './auth.js'

declare module 'fastify' {
  interface FastifyRequest {
    authSession: AuthSession | null
    tenant: TenantContext | null
  }
}

// Resolves the session and, from it, the active workspace + role. The membership is checked on
// every request, so removing someone from a workspace takes effect on their next request.
export const authContext = fp(async (app: FastifyInstance) => {
  app.decorateRequest('authSession', null)
  app.decorateRequest('tenant', null)

  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/auth/')) return
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
    if (!session) return
    request.authSession = session

    const userId = session.user.id
    const activeTenantId = session.session.activeTenantId as string | null | undefined
    const membership = await withUser(userId, async (tx) => {
      if (activeTenantId) {
        const [current] = await tx
          .select({ tenantId: memberships.tenantId, role: memberships.role })
          .from(memberships)
          .where(and(eq(memberships.tenantId, activeTenantId), eq(memberships.userId, userId)))
        if (current) return current
      }
      // No active workspace yet, or the user was removed from it: fall back to their first one.
      const [first] = await tx
        .select({ tenantId: memberships.tenantId, role: memberships.role })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(eq(memberships.userId, userId))
        .orderBy(asc(tenants.name))
        .limit(1)
      return first
    })

    if (membership?.tenantId !== activeTenantId) {
      await db
        .update(sessions)
        .set({ activeTenantId: membership?.tenantId ?? null })
        .where(eq(sessions.id, session.session.id))
    }
    if (membership) request.tenant = { tenantId: membership.tenantId, userId, role: membership.role }
  })
})

export function requireUser(request: FastifyRequest): AuthSession {
  if (!request.authSession) throw new HttpError(401, 'unauthenticated', 'Log in to continue')
  return request.authSession
}

export function requireTenant(request: FastifyRequest, roles?: readonly Role[]): TenantContext {
  requireUser(request)
  const ctx = request.tenant
  if (!ctx) throw new HttpError(403, 'no_workspace', 'No active workspace')
  if (roles && !roles.includes(ctx.role)) throw new HttpError(403, 'forbidden', 'You do not have access to this')
  return ctx
}

export const MANAGERS = ['owner', 'admin'] as const
// Everyone except viewers can create and change CRM records.
export const WRITERS = ['owner', 'admin', 'member'] as const

// preHandler helpers for route options.
export const authenticated = async (request: FastifyRequest) => {
  requireUser(request)
}
export const inWorkspace =
  (roles?: readonly Role[]) =>
  async (request: FastifyRequest) => {
    requireTenant(request, roles)
  }
