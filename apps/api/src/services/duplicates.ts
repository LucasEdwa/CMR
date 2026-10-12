import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { DuplicateGroup, mergeContactsSchema } from '@crm/shared'
import { audit } from '../db/audit.js'
import type { Tx } from '../db/client.js'
import { activityLinks, companies, contacts, dealContacts, tasks } from '../db/schema.js'
import type { TenantContext } from '../db/tenant.js'
import { HttpError } from '../errors.js'
import { getContact, updateContact } from './contacts.js'
import { tagsFor } from './tags.js'

const MAX_GROUPS = 50

// Contacts that look like the same person: the same full name, or the same phone number
// (digits only, at least 7). Emails are already unique per workspace.
export async function findDuplicates(tx: Tx): Promise<DuplicateGroup[]> {
  const groups = await tx.execute<{ reason: 'name' | 'phone'; ids: string[] }>(sql`
    with live as (
      select id, lower(trim(first_name || ' ' || last_name)) as name,
        nullif(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), '') as p1,
        nullif(regexp_replace(coalesce(mobile_phone, ''), '\\D', '', 'g'), '') as p2,
        created_at
      from ${contacts} where deleted_at is null
    ), phones as (
      select id, p1 as phone, created_at from live where length(p1) >= 7
      union select id, p2, created_at from live where length(p2) >= 7
    )
    (select 'name' as reason, array_agg(id order by created_at) as ids from live
      where name <> '' group by name having count(*) between 2 and 10)
    union all
    (select 'phone', array_agg(distinct id) from phones group by phone having count(distinct id) between 2 and 10)
    limit ${MAX_GROUPS * 2}`)

  // The same set of people found both ways is shown once.
  const seen = new Set<string>()
  const unique = groups.filter((g) => {
    const key = [...g.ids].sort().join(',')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, MAX_GROUPS)
  const ids = [...new Set(unique.flatMap((g) => g.ids))]
  if (!ids.length) return []
  const rows = await tx
    .select({ c: contacts, company: companies.name })
    .from(contacts)
    .leftJoin(companies, and(eq(companies.id, contacts.companyId), eq(companies.tenantId, contacts.tenantId), isNull(companies.deletedAt)))
    .where(inArray(contacts.id, ids))
  const byId = new Map(rows.map((r) => [r.c.id, r]))
  return unique.map((g) => ({
    reason: g.reason,
    contacts: g.ids
      .map((id) => byId.get(id))
      .filter((r) => !!r)
      .sort((a, b) => a.c.createdAt.getTime() - b.c.createdAt.getTime())
      .map(({ c, company }) => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        email: c.email,
        phone: c.mobilePhone ?? c.phone,
        company,
        createdAt: c.createdAt.toISOString(),
      })),
  }))
}

// Moves everything from the merged contact to the survivor (deals, activities, tasks, tags),
// takes the chosen field values, and erases the merged contact. The audit log keeps a copy of it.
export async function mergeContacts(tx: Tx, ctx: TenantContext, input: z.output<typeof mergeContactsSchema>) {
  const { survivorId, mergedId, takeFromMerged } = input
  if (survivorId === mergedId) throw new HttpError(400, 'validation_error', 'Pick two different contacts', [{ message: 'same_contact' }])
  const found = await tx.select().from(contacts).where(and(inArray(contacts.id, [survivorId, mergedId]), isNull(contacts.deletedAt)))
  const survivor = found.find((c) => c.id === survivorId)
  const merged = found.find((c) => c.id === mergedId)
  if (!survivor || !merged) throw new HttpError(404, 'not_found', 'Contact not found')
  const tags = await tagsFor(tx, 'contact', [survivorId, mergedId])

  // Deals and activities: link them to the survivor (ignoring ones it already has).
  const dealRows = await tx.select({ dealId: dealContacts.dealId }).from(dealContacts).where(eq(dealContacts.contactId, mergedId))
  if (dealRows.length) {
    await tx
      .insert(dealContacts)
      .values(dealRows.map((d) => ({ tenantId: ctx.tenantId, dealId: d.dealId, contactId: survivorId })))
      .onConflictDoNothing()
  }
  const linkRows = await tx.select({ activityId: activityLinks.activityId }).from(activityLinks).where(eq(activityLinks.contactId, mergedId))
  if (linkRows.length) {
    await tx
      .insert(activityLinks)
      .values(linkRows.map((l) => ({ tenantId: ctx.tenantId, activityId: l.activityId, contactId: survivorId })))
      .onConflictDoNothing()
  }
  const movedTasks = await tx.update(tasks).set({ contactId: survivorId }).where(eq(tasks.contactId, mergedId)).returning({ id: tasks.id })

  // Erase the merged contact first, so its email is free if the survivor takes it.
  await tx.delete(contacts).where(eq(contacts.id, mergedId))
  const changes = Object.fromEntries(takeFromMerged.map((f) => [f, merged[f]]))
  await updateContact(tx, ctx, survivorId, {
    ...changes,
    tags: [...(tags.get(survivorId) ?? []), ...(tags.get(mergedId) ?? [])],
  })
  await audit(tx, ctx, {
    action: 'merge',
    entityType: 'contact',
    entityId: survivorId,
    before: { merged: { ...merged, searchText: undefined, tags: tags.get(mergedId) ?? [] } },
    after: { merged: null, deals: dealRows.length, activities: linkRows.length, tasks: movedTasks.length, fields: takeFromMerged },
  })
  return getContact(tx, survivorId)
}
