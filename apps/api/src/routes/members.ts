import type { FastifyInstance } from 'fastify'
import { and, eq, sql } from 'drizzle-orm'
import { updateMemberSchema, type Member, type Role } from '@crm/shared'
import { z } from 'zod'
import { MANAGERS, inWorkspace, requireTenant } from '../auth/context.js'
import { audit } from '../db/audit.js'
import type { Tx } from '../db/client.js'
import { memberships, users } from '../db/schema.js'
import { withTenant, type TenantContext } from '../db/tenant.js'
import { HttpError } from '../errors.js'

const userIdParam = z.object({ userId: z.uuid() })

async function findMembership(tx: Tx, userId: string) {
  const [m] = await tx.select().from(memberships).where(eq(memberships.userId, userId))
  if (!m) throw new HttpError(404, 'not_found', 'Member not found')
  return m
}

async function ownerCount(tx: Tx) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(eq(memberships.role, 'owner'))
  return row!.n
}

// Admins manage members and admins; only owners can create, change or remove owners.
function assertCanManage(ctx: TenantContext, targetRole: Role, newRole?: Role) {
  if (ctx.role === 'owner') return
  if (targetRole === 'owner' || newRole === 'owner') {
    throw new HttpError(403, 'forbidden', 'Only owners can manage owners')
  }
}

export async function memberRoutes(app: FastifyInstance) {
  app.get('/workspace/members', { preHandler: inWorkspace() }, async (request): Promise<Member[]> => {
    const ctx = requireTenant(request)
    const rows = await withTenant(ctx, (tx) =>
      tx
        .select({
          userId: memberships.userId,
          name: users.name,
          email: users.email,
          role: memberships.role,
          joinedAt: memberships.createdAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .orderBy(users.name),
    )
    return rows.map((r) => ({ ...r, joinedAt: r.joinedAt.toISOString() }))
  })

  app.patch('/workspace/members/:userId', { preHandler: inWorkspace(MANAGERS) }, async (request) => {
    const ctx = requireTenant(request, MANAGERS)
    const { userId } = userIdParam.parse(request.params)
    const { role } = updateMemberSchema.parse(request.body)

    await withTenant(ctx, async (tx) => {
      const before = await findMembership(tx, userId)
      assertCanManage(ctx, before.role, role)
      if (before.role === 'owner' && role !== 'owner' && (await ownerCount(tx)) <= 1) {
        throw new HttpError(409, 'last_owner', 'A workspace needs at least one owner')
      }
      const [after] = await tx
        .update(memberships)
        .set({ role, updatedAt: new Date() })
        .where(eq(memberships.id, before.id))
        .returning()
      await audit(tx, ctx, { action: 'update', entityType: 'membership', entityId: before.id, before, after })
    })
    return { ok: true }
  })

  app.delete('/workspace/members/:userId', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    const { userId } = userIdParam.parse(request.params)
    const leaving = userId === ctx.userId
    if (!leaving && !MANAGERS.includes(ctx.role as (typeof MANAGERS)[number])) {
      throw new HttpError(403, 'forbidden', 'You do not have access to this')
    }

    await withTenant(ctx, async (tx) => {
      const before = await findMembership(tx, userId)
      if (!leaving) assertCanManage(ctx, before.role)
      if (before.role === 'owner' && (await ownerCount(tx)) <= 1) {
        throw new HttpError(409, 'last_owner', 'A workspace needs at least one owner')
      }
      await tx.delete(memberships).where(and(eq(memberships.id, before.id)))
      await audit(tx, ctx, { action: 'delete', entityType: 'membership', entityId: before.id, before })
    })
    return { ok: true }
  })
}
