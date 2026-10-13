import { describe, expect, it } from 'vitest'
import { createImportSchema } from '@crm/shared'
import { eq } from 'drizzle-orm'
import { imports } from '../db/schema.js'
import { withTenant } from '../db/tenant.js'
import { createTenantWithUser } from '../test/factories.js'
import { cancelImport, createImport, getImport, runImport, undoImport } from './imports.js'

const csv = ['Namn;Kundnummer', ...Array.from({ length: 30 }, (_, i) => `Kund ${i + 1};${1000 + i}`)].join('\n')
const input = () => createImportSchema.parse({ object: 'companies', fileName: 'kunder.csv', csv, mapping: ['name', 'fortnoxCustomerNumber'] })

describe('cancel import', () => {
  it('a cancelled queued import never runs', async () => {
    const ctx = await createTenantWithUser()
    const row = await withTenant(ctx, (tx) => createImport(tx, ctx, input()))
    await withTenant(ctx, (tx) => cancelImport(tx, ctx, row.id))
    await runImport({ tenantId: ctx.tenantId, userId: ctx.userId, importId: row.id, role: ctx.role })
    expect(await withTenant(ctx, (tx) => getImport(tx, row.id))).toMatchObject({ status: 'cancelled', created: 0, processed: 0 })
  })

  it('releases an import whose worker died, and its rows can then be undone', async () => {
    const ctx = await createTenantWithUser()
    const row = await withTenant(ctx, (tx) => createImport(tx, ctx, input()))
    await runImport({ tenantId: ctx.tenantId, userId: ctx.userId, importId: row.id, role: ctx.role })
    // As if the API restarted half way: the import is left showing as running.
    await withTenant(ctx, (tx) => tx.update(imports).set({ status: 'running', finishedAt: null }).where(eq(imports.id, row.id)))

    const cancelled = await withTenant(ctx, (tx) => cancelImport(tx, ctx, row.id))
    expect(cancelled).toMatchObject({ status: 'cancelled', created: 30 })
    await expect(withTenant(ctx, (tx) => cancelImport(tx, ctx, row.id))).rejects.toMatchObject({ code: 'import_finished' })

    const undone = await withTenant(ctx, (tx) => undoImport(tx, ctx, row.id))
    expect(undone.status).toBe('undone')
  })
})
