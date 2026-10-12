import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { createWorkspaceSchema, updateWorkspaceSchema, workspaceSchema, type Workspace } from '@crm/shared'
import { z } from 'zod'
import { MANAGERS, inWorkspace, requireTenant, requireUser } from '../auth/context.js'
import { audit } from '../db/audit.js'
import { db } from '../db/client.js'
import { memberships, sessions, tenants } from '../db/schema.js'
import { withTenant, withUser } from '../db/tenant.js'
import { HttpError } from '../errors.js'
import { isUniqueViolation } from '../db/errors.js'

const toWorkspace = (t: typeof tenants.$inferSelect): Workspace => workspaceSchema.parse(t)

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
    const tenant = await withTenant(ctx, async (tx) => {
      const [before] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId))
      const [after] = await tx
        .update(tenants)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenantId))
        .returning()
      await audit(tx, ctx, { action: 'update', entityType: 'workspace', entityId: ctx.tenantId, before, after })
      return after!
    })
    return toWorkspace(tenant)
  })
}
