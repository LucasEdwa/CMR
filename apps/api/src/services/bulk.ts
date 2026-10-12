import { and, inArray, isNull } from 'drizzle-orm'
import type { z } from 'zod'
import type { bulkCompaniesSchema, bulkContactsSchema, bulkDealsSchema } from '@crm/shared'
import type { Tx } from '../db/client.js'
import { companies, contacts, deals } from '../db/schema.js'
import type { TenantContext } from '../db/tenant.js'
import { assertMember } from './common.js'
import { deleteCompany, updateCompany } from './companies.js'
import { deleteContact, updateContact } from './contacts.js'
import { deleteDeal, updateDeal } from './deals.js'
import { tagsFor } from './tags.js'

// Bulk actions run the normal single-record service for each record, so every change is
// validated and audit-logged the same way. Ids that are missing or in Trash are ignored.

async function liveIds(tx: Tx, table: typeof contacts | typeof companies | typeof deals, ids: string[]) {
  const rows = await tx.select({ id: table.id }).from(table).where(and(inArray(table.id, ids), isNull(table.deletedAt)))
  return rows.map((r) => r.id)
}

export async function bulkContacts(tx: Tx, ctx: TenantContext, input: z.output<typeof bulkContactsSchema>) {
  const ids = await liveIds(tx, contacts, input.ids)
  if (input.action === 'delete') {
    for (const id of ids) await deleteContact(tx, ctx, id)
    return { count: ids.length }
  }
  const { addTags, ...fields } = input.changes
  if (fields.ownerUserId) await assertMember(tx, fields.ownerUserId)
  const tags = addTags?.length ? await tagsFor(tx, 'contact', ids) : null
  for (const id of ids) {
    await updateContact(tx, ctx, id, { ...fields, ...(tags ? { tags: [...(tags.get(id) ?? []), ...addTags!] } : {}) })
  }
  return { count: ids.length }
}

export async function bulkCompanies(tx: Tx, ctx: TenantContext, input: z.output<typeof bulkCompaniesSchema>) {
  const ids = await liveIds(tx, companies, input.ids)
  if (input.action === 'delete') {
    for (const id of ids) await deleteCompany(tx, ctx, id)
    return { count: ids.length }
  }
  const { addTags, ...fields } = input.changes
  if (fields.ownerUserId) await assertMember(tx, fields.ownerUserId)
  const tags = addTags?.length ? await tagsFor(tx, 'company', ids) : null
  for (const id of ids) {
    await updateCompany(tx, ctx, id, { ...fields, ...(tags ? { tags: [...(tags.get(id) ?? []), ...addTags!] } : {}) })
  }
  return { count: ids.length }
}

export async function bulkDeals(tx: Tx, ctx: TenantContext, input: z.output<typeof bulkDealsSchema>) {
  const ids = await liveIds(tx, deals, input.ids)
  if (input.action === 'delete') {
    for (const id of ids) await deleteDeal(tx, ctx, id)
    return { count: ids.length }
  }
  if (input.changes.ownerUserId) await assertMember(tx, input.changes.ownerUserId)
  for (const id of ids) await updateDeal(tx, ctx, id, input.changes)
  return { count: ids.length }
}
