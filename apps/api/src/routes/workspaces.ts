import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { createWorkspaceSchema, deleteWorkspaceSchema, updateWorkspaceSchema, workspaceSchema, type Workspace } from '@crm/shared'
import { z } from 'zod'
import { MANAGERS, OWNERS, inWorkspace, requireTenant, requireUser } from '../auth/context.js'
import { audit } from '../db/audit.js'
import { db } from '../db/client.js'
import { memberships, sessions, tenants } from '../db/schema.js'
import { withTenant, withUser } from '../db/tenant.js'
import { retimeOpenTasks } from '../services/tasks.js'
import { cancelDeletion, checkPassword, scheduleDeletion } from '../services/workspaceDeletion.js'
import { limit } from '../http/limits.js'
import { HttpError } from '../errors.js'
import { isUniqueViolation } from '../db/errors.js'

const toWorkspace = (t: typeof tenants.$inferSelect): Workspace =>
  workspaceSchema.parse({ ...t, deletionScheduledFor: t.deletionScheduledFor?.toISOString() ?? null })

export async function setActiveWorkspace(sessionId: string, tenantId: string | null) {
  await db.update(sessions).set({ activeTenantId: tenantId, updatedAt: new Date() }).where(eq(sessions.id, sessionId))
}

export async function workspaceRoutes(app: FastifyInstance) {
  app.post('/workspaces', async (request, reply) => {
    const { user, session } = requireUser(request)
    const input = createWorkspaceSchema.parse(request.body)
    const ctx = { tenantId: randomUUID(), userId: user.id, role: 'owner' as const }

    try {
      const tenant = await withTenant(ctx, async (tx) => {
        const [tenant] = await tx
          .insert(tenants)
          .values({ id: ctx.tenantId, name: input.name, slug: input.slug, orgNumber: input.orgNumber ?? null })
          .returning()
        await tx.insert(memberships).values({ tenantId: ctx.tenantId, userId: user.id, role: 'owner' })
        await audit(tx, ctx, { action: 'create', entityType: 'workspace', entityId: ctx.tenantId, after: tenant })
        return tenant!
      })
      await setActiveWorkspace(session.id, tenant.id)
      return reply.status(201).send(toWorkspace(tenant))
    } catch (err) {
      if (isUniqueViolation(err, 'tenants_slug_unique')) {
        throw new HttpError(409, 'slug_taken', 'That address is already taken')
      }
      throw err
    }
  })

  app.post('/workspaces/switch', async (request) => {
    const { user, session } = requireUser(request)
    const { workspaceId } = z.object({ workspaceId: z.uuid() }).parse(request.body)
    const [membership] = await withUser(user.id, (tx) =>
      tx
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.userId, user.id), eq(memberships.tenantId, workspaceId))),
    )
    // Same answer whether the workspace does not exist or the user is not a member.
    if (!membership) throw new HttpError(404, 'not_found', 'Workspace not found')
    await setActiveWorkspace(session.id, workspaceId)
    return { ok: true }
  })

  app.get('/workspace', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    const [tenant] = await withTenant(ctx, (tx) => tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId)))
    return toWorkspace(tenant!)
  })

  app.patch('/workspace', { preHandler: inWorkspace(MANAGERS) }, async (request) => {
    const ctx = requireTenant(request, MANAGERS)
    const input = updateWorkspaceSchema.parse(request.body)
    // Requiring 2FA without having it would lock the admin out on the next click.
    if (input.requireTwoFactor && !(request.authSession!.user as { twoFactorEnabled?: boolean }).twoFactorEnabled) {
      throw new HttpError(409, 'two_factor_needed_first', 'Turn on two-factor login for yourself first')
    }
    const tenant = await withTenant(ctx, async (tx) => {
      const [before] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId))
      const [after] = await tx
        .update(tenants)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenantId))
        .returning()
      await audit(tx, ctx, { action: 'update', entityType: 'workspace', entityId: ctx.tenantId, before, after })
      if (before && after!.timezone !== before.timezone) await retimeOpenTasks(tx)
      return after!
    })
    return toWorkspace(tenant)
  })

  // Asks for the workspace to be erased after the grace period. Needs the name typed again and
  // the owner's password; all owners are emailed and any of them can cancel until then.
  app.delete('/workspace', { preHandler: inWorkspace(OWNERS), config: limit('delete-workspace', 5, '1 hour') }, async (request) => {
    const ctx = requireTenant(request, OWNERS)
    const { confirm, password } = deleteWorkspaceSchema.parse(request.body)
    const [current] = await withTenant(ctx, (tx) => tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId)))
    if (!current || current.name.trim().toLowerCase() !== confirm.toLowerCase()) {
      throw new HttpError(400, 'confirm_mismatch', 'Type the workspace name to confirm')
    }
    await checkPassword(ctx.userId, password)
    const tenant = await scheduleDeletion(ctx, request.authSession!.user.name)
    request.log.info({ tenantId: ctx.tenantId, userId: ctx.userId }, 'workspace deletion scheduled')
    return toWorkspace(tenant)
  })

  app.post('/workspace/cancel-deletion', { preHandler: inWorkspace(OWNERS) }, async (request) => {
    const ctx = requireTenant(request, OWNERS)
    return toWorkspace(await cancelDeletion(ctx, request.authSession!.user.name))
  })
}
