import type { FastifyInstance } from 'fastify'
import { and, desc, eq, gt, ne } from 'drizzle-orm'
import { z } from 'zod'
import { localeSchema, updateMeSchema, type Me, type SecurityEvent, type SessionInfo } from '@crm/shared'
import { requireUser } from '../auth/context.js'
import { db } from '../db/client.js'
import { memberships, securityEvents, sessions, tenants, users } from '../db/schema.js'
import { recordSecurityEvent } from '../auth/security-log.js'
import { HttpError } from '../errors.js'
import { withTenant, withUser } from '../db/tenant.js'
import { retimeOpenTasks } from '../services/tasks.js'

export async function meRoutes(app: FastifyInstance) {
  app.get('/me', async (request): Promise<Me> => {
    const { user } = requireUser(request)
    // Read from the table, not the session: the session copy can be a day old.
    const [profile] = await db
      .select({ timezone: users.timezone, twoFactorEnabled: users.twoFactorEnabled })
      .from(users)
      .where(eq(users.id, user.id))
    const workspaces = await withUser(user.id, (tx) =>
      tx
        .select({ id: tenants.id, name: tenants.name, slug: tenants.slug, role: memberships.role })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(eq(memberships.userId, user.id))
        .orderBy(tenants.name),
    )
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        locale: localeSchema.catch('sv').parse(user.locale),
        timezone: profile?.timezone ?? null,
        twoFactorEnabled: profile?.twoFactorEnabled ?? false,
      },
      workspaces,
      // Only reported when the membership still exists (resolved per request in authContext).
      activeWorkspaceId: request.activeWorkspaceId,
      twoFactorSetupRequired: request.twoFactorSetupRequired,
    }
  })

  app.patch('/me', async (request) => {
    const { user } = requireUser(request)
    const input = updateMeSchema.parse(request.body)
    await db.update(users).set({ ...input, updatedAt: new Date() }).where(eq(users.id, user.id))
    if (input.timezone !== undefined) {
      // Tasks live in each workspace's RLS context: retime them one workspace at a time.
      const tenantIds = await withUser(user.id, (tx) =>
        tx.select({ tenantId: memberships.tenantId, role: memberships.role }).from(memberships).where(eq(memberships.userId, user.id)),
      )
      for (const m of tenantIds) {
        await withTenant({ tenantId: m.tenantId, userId: user.id, role: m.role }, (tx) => retimeOpenTasks(tx, user.id))
      }
    }
    return { ok: true }
  })

  // ---- account security: own sessions and own security log ----

  // Never returns session tokens: the browser only sees ids it can use to revoke.
  app.get('/me/sessions', async (request): Promise<SessionInfo[]> => {
    const { user, session } = requireUser(request)
    const rows = await db.select().from(sessions).where(and(eq(sessions.userId, user.id), gt(sessions.expiresAt, new Date()))).orderBy(desc(sessions.updatedAt))
    return rows.map((s) => ({
      id: s.id,
      current: s.id === session.id,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }))
  })

  app.delete('/me/sessions/:id', async (request) => {
    const { user } = requireUser(request)
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const gone = await db.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, user.id))).returning({ id: sessions.id })
    if (!gone.length) throw new HttpError(404, 'not_found', 'Session not found')
    await recordSecurityEvent(request, user.id, 'sessions_revoked')
    return { ok: true }
  })

  // "Log out everywhere else."
  app.post('/me/sessions/revoke-others', async (request) => {
    const { user, session } = requireUser(request)
    await db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, session.id)))
    await recordSecurityEvent(request, user.id, 'sessions_revoked')
    return { ok: true }
  })

  app.get('/me/security-events', async (request): Promise<SecurityEvent[]> => {
    const { user } = requireUser(request)
    const rows = await withUser(user.id, (tx) =>
      tx.select().from(securityEvents).where(eq(securityEvents.userId, user.id)).orderBy(desc(securityEvents.createdAt)).limit(30),
    )
    return rows.map((e) => ({ id: e.id, type: e.type as SecurityEvent['type'], ipAddress: e.ipAddress, userAgent: e.userAgent, createdAt: e.createdAt.toISOString() }))
  })
}
