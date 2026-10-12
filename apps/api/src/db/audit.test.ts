import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { audit, diffRecords } from './audit.js'
import { auditLog, tenants } from './schema.js'
import { withTenant } from './tenant.js'
import { createTenantWithUser } from '../test/factories.js'

describe('diffRecords', () => {
  it('keeps only changed fields as [before, after]', () => {
    expect(diffRecords({ name: 'A', email: 'a@x.se', updatedAt: 1 }, { name: 'B', email: 'a@x.se', updatedAt: 2 })).toEqual({
      name: ['A', 'B'],
    })
  })

  it('records every field on create and delete', () => {
    expect(diffRecords(null, { name: 'A' })).toEqual({ name: [null, 'A'] })
    expect(diffRecords({ name: 'A' }, null)).toEqual({ name: ['A', null] })
  })
})

describe('audit', () => {
  it('writes the actor, action and diff in the same transaction as the change', async () => {
    const ctx = await createTenantWithUser()
    await withTenant(ctx, async (tx) => {
      const [before] = await tx.select().from(tenants)
      const [after] = await tx.update(tenants).set({ name: 'Renamed AB' }).returning()
      await audit(tx, ctx, { action: 'update', entityType: 'tenant', entityId: ctx.tenantId, before, after })
    })

    const [row] = await withTenant(ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.entityId, ctx.tenantId)))
    expect(row).toMatchObject({ actorUserId: ctx.userId, action: 'update', entityType: 'tenant' })
    expect(row!.diff).toEqual({ name: [expect.any(String), 'Renamed AB'] })
  })

  it('rolls back with the transaction when the change fails', async () => {
    const ctx = await createTenantWithUser()
    await expect(
      withTenant(ctx, async (tx) => {
        await audit(tx, ctx, { action: 'update', entityType: 'tenant', entityId: ctx.tenantId })
        throw new Error('mutation failed')
      }),
    ).rejects.toThrow('mutation failed')

    const rows = await withTenant(ctx, (tx) => tx.select().from(auditLog))
    expect(rows).toHaveLength(0)
  })
})
