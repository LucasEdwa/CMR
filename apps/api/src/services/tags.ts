import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Tx } from '../db/client.js'
import { companyTags, contactTags, tags } from '../db/schema.js'
import type { TenantContext } from '../db/tenant.js'

// Creates missing tags (case-insensitive) and returns their ids.
async function ensureTags(tx: Tx, ctx: TenantContext, names: string[]): Promise<string[]> {
  const unique = [...new Map(names.map((n) => [n.trim().toLowerCase(), n.trim()])).values()].filter(Boolean)
  if (!unique.length) return []
  await tx
    .insert(tags)
    .values(unique.map((name) => ({ tenantId: ctx.tenantId, name })))
    .onConflictDoNothing()
  const rows = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(sql`lower(${tags.name}) in ${unique.map((n) => n.toLowerCase())}`)
  return rows.map((r) => r.id)
}

export async function setContactTags(tx: Tx, ctx: TenantContext, contactId: string, names: string[]) {
  const ids = await ensureTags(tx, ctx, names)
  await tx.delete(contactTags).where(eq(contactTags.contactId, contactId))
  if (ids.length) await tx.insert(contactTags).values(ids.map((tagId) => ({ tenantId: ctx.tenantId, contactId, tagId })))
}

export async function setCompanyTags(tx: Tx, ctx: TenantContext, companyId: string, names: string[]) {
  const ids = await ensureTags(tx, ctx, names)
  await tx.delete(companyTags).where(eq(companyTags.companyId, companyId))
  if (ids.length) await tx.insert(companyTags).values(ids.map((tagId) => ({ tenantId: ctx.tenantId, companyId, tagId })))
}

// Tag names for one page of records, loaded in one query after pagination. (A per-row
// subquery would also run for every row skipped by OFFSET.)
export async function tagsFor(tx: Tx, kind: 'contact' | 'company', ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (!ids.length) return map
  const join = kind === 'contact' ? contactTags : companyTags
  const fk = kind === 'contact' ? contactTags.contactId : companyTags.companyId
  const rows = await tx
    .select({ recordId: fk, name: tags.name })
    .from(join)
    .innerJoin(tags, and(eq(tags.id, join.tagId), eq(tags.tenantId, join.tenantId)))
    .where(inArray(fk, ids))
    .orderBy(sql`lower(${tags.name})`)
  for (const r of rows) map.set(r.recordId, [...(map.get(r.recordId) ?? []), r.name])
  return map
}

// Records having any of the given tags, as a semi-join on the (tenant_id, tag_id) index.
export const hasAnyTag = (kind: 'contact' | 'company', idColumn: unknown, names: string[]) => {
  const join = kind === 'contact' ? contactTags : companyTags
  const fk = kind === 'contact' ? sql.raw('contact_id') : sql.raw('company_id')
  return sql`${idColumn} in (select x.${fk} from ${join} x join ${tags} t on t.id = x.tag_id and t.tenant_id = x.tenant_id
    where lower(t.name) in ${names.map((n) => n.toLowerCase())})`
}

export async function listTags(tx: Tx) {
  return tx
    .select({
      id: tags.id,
      name: tags.name,
      usage: sql<number>`((select count(*) from ${contactTags} where tag_id = ${tags.id}) + (select count(*) from ${companyTags} where tag_id = ${tags.id}))::int`,
    })
    .from(tags)
    .orderBy(sql`lower(${tags.name})`)
}
