import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { localeSchema, updateMeSchema, type Me } from '@crm/shared'
import { requireUser } from '../auth/context.js'
import { db } from '../db/client.js'
import { memberships, tenants, users } from '../db/schema.js'
import { withUser } from '../db/tenant.js'

export async function meRoutes(app: FastifyInstance) {
  app.get('/me', async (request): Promise<Me> => {
    const { user } = requireUser(request)
    const workspaces = await withUser(user.id, (tx) =>
      tx
        .select({ id: tenants.id, name: tenants.name, slug: tenants.slug, role: memberships.role })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(eq(memberships.userId, user.id))
        .orderBy(tenants.name),
    )
    return {
      user: { id: user.id, name: user.name, email: user.email, locale: localeSchema.catch('sv').parse(user.locale) },
      workspaces,
      // Only reported when the membership still exists (resolved per request in authContext).
      activeWorkspaceId: request.tenant?.tenantId ?? null,
    }
  })

  app.patch('/me', async (request) => {
    const { user } = requireUser(request)
    const input = updateMeSchema.parse(request.body)
    await db.update(users).set({ ...input, updatedAt: new Date() }).where(eq(users.id, user.id))
    return { ok: true }
  })
}
