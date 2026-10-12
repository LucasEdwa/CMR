import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  PUBLIC_EMAIL_DOMAINS,
  emailDomain,
  type Company,
  type companyListQuerySchema,
  type createCompanySchema,
  type updateCompanySchema,
} from '@crm/shared'
import type { z } from 'zod'
import { audit } from '../db/audit.js'
import type { Tx } from '../db/client.js'
import { isUniqueViolation } from '../db/errors.js'
import { companies, contacts, users } from '../db/schema.js'
import type { TenantContext } from '../db/tenant.js'
import { HttpError } from '../errors.js'
import { assertMember, buildSearchText, createdRange, likePattern, ownerFilter, ownerRef, sv, tenantTimezone } from './common.js'
import { hasAnyTag, setCompanyTags, tagsFor } from './tags.js'
import { schedulePurge } from './purge.js'

type CompanyRow = typeof companies.$inferSelect

const owner = alias(users, 'owner')

const contactCount = sql<number>`(select count(*)::int from ${contacts} c
  where c.company_id = ${companies.id} and c.tenant_id = ${companies.tenantId} and c.deleted_at is null)`

const selection = {
  company: companies,
  ownerName: owner.name,
  contactCount,
}

const baseQuery = (tx: Tx) => tx.select(selection).from(companies).leftJoin(owner, eq(owner.id, companies.ownerUserId))

type Row = { company: CompanyRow; ownerName: string | null; contactCount: number }

async function withTags(tx: Tx, rows: Row[]): Promise<Company[]> {
  const tags = await tagsFor(tx, 'company', rows.map((r) => r.company.id))
  return rows.map((r) => toCompany(r, tags.get(r.company.id) ?? []))
}

function toCompany(row: Row, tags: string[]): Company {
  const c = row.company
  return {
    id: c.id,
    name: c.name,
    orgNumber: c.orgNumber,
    vatNumber: c.vatNumber,
    domain: c.domain,
    industry: c.industry,
    size: c.size,
    phone: c.phone,
    street: c.street,
    postalCode: c.postalCode,
    city: c.city,
    country: c.country,
    owner: ownerRef(c.ownerUserId, row.ownerName),
    tags,
    contactCount: row.contactCount,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }
}

const searchTextOf = (c: Pick<CompanyRow, 'name' | 'orgNumber' | 'domain' | 'city' | 'phone'>) =>
  buildSearchText([c.name, c.orgNumber, c.orgNumber?.replace(/\D/g, ''), c.domain, c.city], [c.phone])

export async function listCompanies(tx: Tx, ctx: TenantContext, q: z.output<typeof companyListQuerySchema>) {
  const tz = await tenantTimezone(tx, ctx)
  const where: SQL[] = [isNull(companies.deletedAt)]
  if (q.q) where.push(sql`${companies.searchText} like ${likePattern(q.q)}`)
  const ownerCond = ownerFilter(companies.ownerUserId, q.owner, ctx)
  if (ownerCond) where.push(ownerCond)
  if (q.tag.length) where.push(hasAnyTag('company', companies.id, q.tag))
  if (q.size.length) where.push(sql`${companies.size} in ${q.size}`)
  where.push(...createdRange(companies.createdAt, tz, q.createdFrom, q.createdTo))

  const dir = q.dir === 'desc' ? desc : asc
  const order: SQL[] = {
    name: [dir(sv(companies.name))],
    city: [sql`${sv(companies.city)} ${sql.raw(q.dir)} nulls last`],
    contactCount: [dir(contactCount)],
    createdAt: [dir(companies.createdAt)],
    updatedAt: [dir(companies.updatedAt)],
  }[q.sort]

  const [rows, [count]] = await Promise.all([
    baseQuery(tx)
      .where(and(...where))
      .orderBy(...order, asc(companies.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    tx.select({ n: sql<number>`count(*)::int` }).from(companies).where(and(...where)),
  ])
  return { items: await withTags(tx, rows), total: count!.n, page: q.page, pageSize: q.pageSize }
}

export async function getCompany(tx: Tx, id: string): Promise<Company> {
  const [row] = await baseQuery(tx).where(and(eq(companies.id, id), isNull(companies.deletedAt)))
  if (!row) throw new HttpError(404, 'not_found', 'Company not found')
  return (await withTags(tx, [row]))[0]!
}

async function assertOrgNumberFree(tx: Tx, orgNumber: string | null | undefined, exceptId?: string) {
  if (!orgNumber) return
  const [existing] = await tx
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(and(eq(companies.orgNumber, orgNumber), isNull(companies.deletedAt)))
  if (existing && existing.id !== exceptId) {
    throw new HttpError(409, 'duplicate_org_number', 'A company with this org number already exists', {
      companyId: existing.id,
      name: existing.name,
    })
  }
}

export async function createCompany(tx: Tx, ctx: TenantContext, input: z.output<typeof createCompanySchema>) {
  const { tags, ...fields } = input
  const ownerUserId = fields.ownerUserId === undefined ? ctx.userId : fields.ownerUserId
  await assertMember(tx, ownerUserId)
  await assertOrgNumberFree(tx, fields.orgNumber)
  const values = { ...fields, tenantId: ctx.tenantId, ownerUserId, createdByUserId: ctx.userId }
  try {
    const [row] = await tx
      .insert(companies)
      .values({ ...values, searchText: searchTextOf(values as CompanyRow) })
      .returning()
    await setCompanyTags(tx, ctx, row!.id, tags)
    await audit(tx, ctx, { action: 'create', entityType: 'company', entityId: row!.id, after: { ...row, searchText: undefined, tags } })
    return getCompany(tx, row!.id)
  } catch (err) {
    if (isUniqueViolation(err, 'companies_tenant_org_number_idx')) await assertOrgNumberFree(tx, fields.orgNumber)
    throw err
  }
}

export async function updateCompany(tx: Tx, ctx: TenantContext, id: string, input: z.output<typeof updateCompanySchema>) {
  const { tags, ...fields } = input
  const [before] = await tx.select().from(companies).where(and(eq(companies.id, id), isNull(companies.deletedAt)))
  if (!before) throw new HttpError(404, 'not_found', 'Company not found')
  if (fields.ownerUserId !== undefined) await assertMember(tx, fields.ownerUserId)
  if (fields.orgNumber !== undefined) await assertOrgNumberFree(tx, fields.orgNumber, id)
  const beforeTags = (await getCompany(tx, id)).tags

  const [after] = await tx
    .update(companies)
    .set({ ...fields, searchText: searchTextOf({ ...before, ...fields } as CompanyRow), updatedAt: new Date() })
    .where(eq(companies.id, id))
    .returning()
  if (tags) await setCompanyTags(tx, ctx, id, tags)
  await audit(tx, ctx, {
    action: 'update',
    entityType: 'company',
    entityId: id,
    before: { ...before, searchText: undefined, tags: beforeTags },
    after: { ...after, searchText: undefined, tags: tags ?? beforeTags },
  })
  return getCompany(tx, id)
}

export async function deleteCompany(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx
    .update(companies)
    .set({ deletedAt: new Date(), deletedByUserId: ctx.userId })
    .where(and(eq(companies.id, id), isNull(companies.deletedAt)))
    .returning({ id: companies.id })
  if (!row) throw new HttpError(404, 'not_found', 'Company not found')
  await audit(tx, ctx, { action: 'delete', entityType: 'company', entityId: id })
  await schedulePurge(ctx, 'company', id)
}

export async function restoreCompany(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx.select().from(companies).where(and(eq(companies.id, id), sql`${companies.deletedAt} is not null`))
  if (!row) throw new HttpError(404, 'not_found', 'Company not found in Trash')
  await assertOrgNumberFree(tx, row.orgNumber)
  await tx.update(companies).set({ deletedAt: null, deletedByUserId: null, updatedAt: new Date() }).where(eq(companies.id, id))
  await audit(tx, ctx, { action: 'restore', entityType: 'company', entityId: id })
  return getCompany(tx, id)
}

// "anna@acme.se" suggests the live company with domain acme.se. Webmail never suggests anything.
export async function suggestCompanyForEmail(tx: Tx, email: string) {
  const domain = emailDomain(email)
  if (!domain || PUBLIC_EMAIL_DOMAINS.has(domain)) return null
  const [match] = await tx
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(and(eq(companies.domain, domain), isNull(companies.deletedAt)))
    .orderBy(asc(companies.createdAt))
    .limit(1)
  return match ?? null
}
