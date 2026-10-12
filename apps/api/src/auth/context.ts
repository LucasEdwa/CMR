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
    // The active workspace requires two-factor login and this user has not set it up.
    twoFactorSetupRequired: boolean
    activeWorkspaceId: string | null
    // Requests always carry a real membership role, never 'system'.
    tenant: (TenantContext & { role: Role }) | null
  }
}

// Resolves the session and, from it, the active workspace + role. The membership is checked on
// every request, so removing someone from a workspace takes effect on their next request.
export const authContext = fp(async (app: FastifyInstance) => {
  app.decorateRequest('authSession', null)
  app.decorateRequest('tenant', null)
  app.decorateRequest('twoFactorSetupRequired', false)
  app.decorateRequest('activeWorkspaceId', null)

  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/auth/')) return
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
    if (!session) return
    // Absolute lifetime: however active, a session ends after SESSION_MAX_AGE_DAYS.
    if (Date.now() - new Date(session.session.createdAt).getTime() > SESSION_MAX_AGE_DAYS * 86_400_000) {
      await db.delete(sessions).where(eq(sessions.id, session.session.id))
      return
    }
    request.authSession = session

    const userId = session.user.id
    const activeTenantId = session.session.activeTenantId as string | null | undefined
    const membership = await withUser(userId, async (tx) => {
      if (activeTenantId) {
        const [current] = await tx
          .select({ tenantId: memberships.tenantId, role: memberships.role, requireTwoFactor: tenants.requireTwoFactor })
          .from(memberships)
          .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
          .where(and(eq(memberships.tenantId, activeTenantId), eq(memberships.userId, userId)))
        if (current) return current
      }
      // No active workspace yet, or the user was removed from it: fall back to their first one.
      const [first] = await tx
        .select({ tenantId: memberships.tenantId, role: memberships.role, requireTwoFactor: tenants.requireTwoFactor })
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
    if (!membership) return
    // A workspace that requires 2FA is closed to members without it, apart from /me and the
    // routes that set it up (Better Auth's, under /api/auth).
    const userHas2fa = Boolean((session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled)
    if (membership.requireTwoFactor && !userHas2fa) {
      request.twoFactorSetupRequired = true
      request.activeWorkspaceId = membership.tenantId
      return
    }
    request.activeWorkspaceId = membership.tenantId
    request.tenant = { tenantId: membership.tenantId, userId, role: membership.role }
  })
})

export const SESSION_MAX_AGE_DAYS = 30

export function requireUser(request: FastifyRequest): AuthSession {
  if (!request.authSession) throw new HttpError(401, 'unauthenticated', 'Log in to continue')
  return request.authSession
}

export function requireTenant(request: FastifyRequest, roles?: readonly Role[]): TenantContext & { role: Role } {
  requireUser(request)
  const ctx = request.tenant
  if (!ctx && request.twoFactorSetupRequired) {
    throw new HttpError(403, 'two_factor_required', 'This workspace requires two-factor login')
  }
  if (!ctx) throw new HttpError(403, 'no_workspace', 'No active workspace')
  if (roles && !roles.includes(ctx.role)) throw new HttpError(403, 'forbidden', 'You do not have access to this')
  return ctx
}

// Deleting the workspace (and billing, Sprint 8).
export const OWNERS = ['owner'] as const
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
