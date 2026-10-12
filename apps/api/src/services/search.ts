import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { RecordRef, SearchHit } from '@crm/shared'
import type { Tx } from '../db/client.js'
import { companies, contacts, deals, recentViews } from '../db/schema.js'
import type { TenantContext } from '../db/tenant.js'
import { likePattern } from './common.js'
import { recordName } from './records.js'

const PER_TYPE = 5
const RECENT_KEPT = 20

// Contacts, companies and deals whose search text contains the query (trigram index), best matches first.
export async function search(tx: Tx, q: string): Promise<SearchHit[]> {
  const pattern = likePattern(q)
  const term = q.toLowerCase()
  const rank = (column: PgColumn) => sql`similarity(${column}, ${term}) desc`
  const [people, orgs, sales] = await Promise.all([
    tx
      .select({ id: contacts.id, first: contacts.firstName, last: contacts.lastName, email: contacts.email, company: companies.name })
      .from(contacts)
      .leftJoin(companies, and(eq(companies.id, contacts.companyId), eq(companies.tenantId, contacts.tenantId), isNull(companies.deletedAt)))
      .where(and(sql`${contacts.searchText} like ${pattern}`, isNull(contacts.deletedAt)))
      .orderBy(rank(contacts.searchText))
      .limit(PER_TYPE),
    tx
      .select({ id: companies.id, name: companies.name, city: companies.city, orgNumber: companies.orgNumber })
      .from(companies)
      .where(and(sql`${companies.searchText} like ${pattern}`, isNull(companies.deletedAt)))
      .orderBy(rank(companies.searchText))
      .limit(PER_TYPE),
    tx
      .select({ id: deals.id, name: deals.name, company: companies.name })
      .from(deals)
      .leftJoin(companies, and(eq(companies.id, deals.companyId), eq(companies.tenantId, deals.tenantId), isNull(companies.deletedAt)))
      // Deals are also found by their company's name.
      .where(and(sql`(${deals.searchText} like ${pattern} or lower(${companies.name}) like ${pattern})`, isNull(deals.deletedAt)))
      .orderBy(rank(deals.searchText))
      .limit(PER_TYPE),
  ])
  return [
    ...people.map((p) => ({ type: 'contact' as const, id: p.id, name: `${p.first} ${p.last}`.trim(), detail: [p.company, p.email].filter(Boolean).join(' · ') || null })),
    ...orgs.map((c) => ({ type: 'company' as const, id: c.id, name: c.name, detail: [c.orgNumber, c.city].filter(Boolean).join(' · ') || null })),
    ...sales.map((d) => ({ type: 'deal' as const, id: d.id, name: d.name, detail: d.company })),
  ]
}

export async function recordView(tx: Tx, ctx: TenantContext, ref: RecordRef) {
  await tx
    .insert(recentViews)
    .values({ tenantId: ctx.tenantId, userId: ctx.userId, recordType: ref.type, recordId: ref.id })
    .onConflictDoUpdate({ target: [recentViews.tenantId, recentViews.userId, recentViews.recordType, recentViews.recordId], set: { viewedAt: new Date() } })
  // Keep the list short.
  await tx.execute(sql`delete from ${recentViews} where user_id = ${ctx.userId} and (record_type, record_id) not in (
    select record_type, record_id from ${recentViews} where user_id = ${ctx.userId} order by viewed_at desc limit ${RECENT_KEPT})`)
}

// The user's recently opened records that still exist (not in Trash).
export async function recentRecords(tx: Tx, ctx: TenantContext, limit = 8): Promise<SearchHit[]> {
  const rows = await tx
    .select()
    .from(recentViews)
    .where(eq(recentViews.userId, ctx.userId))
    .orderBy(desc(recentViews.viewedAt))
    .limit(RECENT_KEPT)
  const hits: SearchHit[] = []
  for (const r of rows) {
    const found = await recordName(tx, { type: r.recordType, id: r.recordId })
    if (found) hits.push({ ...found, detail: null })
    if (hits.length === limit) break
  }
  return hits
}
