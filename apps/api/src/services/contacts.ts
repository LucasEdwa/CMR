import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  LIFECYCLE_STAGES,
  type Contact,
  type contactListQuerySchema,
  type createContactSchema,
  type updateContactSchema,
} from '@crm/shared'
import type { z } from 'zod'
import { audit } from '../db/audit.js'
import type { Tx } from '../db/client.js'
import { isUniqueViolation } from '../db/errors.js'
import { companies, contacts, users } from '../db/schema.js'
import type { TenantContext } from '../db/tenant.js'
import { HttpError } from '../errors.js'
import {
  assertMember,
  buildSearchText,
  createdRange,
  likePattern,
  sv,
  ownerFilter,
  ownerRef,
  tenantTimezone,
} from './common.js'
import { hasAnyTag, setContactTags, tagsFor } from './tags.js'
import { schedulePurge } from './purge.js'

type ContactRow = typeof contacts.$inferSelect

const owner = alias(users, 'owner')

const selection = {
  contact: contacts,
  companyName: companies.name,
  ownerName: owner.name,
}

// Deleted companies are hidden from contacts until restored.
const baseQuery = (tx: Tx) =>
  tx
    .select(selection)
    .from(contacts)
    .leftJoin(
      companies,
      and(eq(companies.id, contacts.companyId), eq(companies.tenantId, contacts.tenantId), isNull(companies.deletedAt)),
    )
    .leftJoin(owner, eq(owner.id, contacts.ownerUserId))

type Row = { contact: ContactRow; companyName: string | null; ownerName: string | null }

async function withTags(tx: Tx, rows: Row[]): Promise<Contact[]> {
  const tags = await tagsFor(tx, 'contact', rows.map((r) => r.contact.id))
  return rows.map((r) => toContact(r, tags.get(r.contact.id) ?? []))
}

function toContact(row: Row, tags: string[]): Contact {
  const c = row.contact
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    mobilePhone: c.mobilePhone,
    title: c.title,
    company: c.companyId && row.companyName ? { id: c.companyId, name: row.companyName } : null,
    owner: ownerRef(c.ownerUserId, row.ownerName),
    lifecycleStage: c.lifecycleStage,
    leadSource: c.leadSource,
    marketingConsent: c.marketingConsent,
    consentBasis: c.consentBasis,
    consentUpdatedAt: c.consentUpdatedAt?.toISOString() ?? null,
    street: c.street,
    postalCode: c.postalCode,
    city: c.city,
    country: c.country,
    tags,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }
}

const searchTextOf = (c: Pick<ContactRow, 'firstName' | 'lastName' | 'email' | 'title' | 'phone' | 'mobilePhone'>) =>
  buildSearchText([c.firstName, c.lastName, c.email, c.title], [c.phone, c.mobilePhone])

const stageOrder = sql`array_position(array[${sql.join(
  LIFECYCLE_STAGES.map((s) => sql`${s}`),
  sql`, `,
)}]::text[], ${contacts.lifecycleStage}::text)`

export async function listContacts(tx: Tx, ctx: TenantContext, q: z.output<typeof contactListQuerySchema>) {
  const tz = await tenantTimezone(tx, ctx)
  const where: SQL[] = [isNull(contacts.deletedAt)]
  if (q.q) where.push(sql`${contacts.searchText} like ${likePattern(q.q)}`)
  const ownerCond = ownerFilter(contacts.ownerUserId, q.owner, ctx)
  if (ownerCond) where.push(ownerCond)
  if (q.tag.length) where.push(hasAnyTag('contact', contacts.id, q.tag))
  if (q.stage.length) where.push(sql`${contacts.lifecycleStage} in ${q.stage}`)
  if (q.source.length) where.push(sql`${contacts.leadSource} in ${q.source}`)
  if (q.companyId) where.push(eq(contacts.companyId, q.companyId))
  where.push(...createdRange(contacts.createdAt, tz, q.createdFrom, q.createdTo))

  const dir = q.dir === 'desc' ? desc : asc
  const order: SQL[] = {
    name: [dir(sv(contacts.lastName)), dir(sv(contacts.firstName))],
    email: [sql`${contacts.email} ${sql.raw(q.dir)} nulls last`],
    company: [sql`${sv(companies.name)} ${sql.raw(q.dir)} nulls last`],
    lifecycleStage: [dir(stageOrder)],
    createdAt: [dir(contacts.createdAt)],
    updatedAt: [dir(contacts.updatedAt)],
  }[q.sort]

  const [rows, [count]] = await Promise.all([
    baseQuery(tx)
      .where(and(...where))
      .orderBy(...order, asc(contacts.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    tx.select({ n: sql<number>`count(*)::int` }).from(contacts).where(and(...where)),
  ])
  return { items: await withTags(tx, rows), total: count!.n, page: q.page, pageSize: q.pageSize }
}

export async function getContact(tx: Tx, id: string): Promise<Contact> {
  const [row] = await baseQuery(tx).where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
  if (!row) throw new HttpError(404, 'not_found', 'Contact not found')
  return (await withTags(tx, [row]))[0]!
}

async function assertCompany(tx: Tx, companyId: string | null | undefined) {
  if (!companyId) return
  const [c] = await tx
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, companyId), isNull(companies.deletedAt)))
  if (!c) throw new HttpError(400, 'validation_error', 'Company not found', [{ message: 'invalid_company' }])
}

async function duplicateEmailError(tx: Tx, email: string) {
  const [existing] = await tx
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
    .from(contacts)
    .where(and(eq(contacts.email, email), isNull(contacts.deletedAt)))
  return new HttpError(409, 'duplicate_email', 'A contact with this email already exists', existing && {
    contactId: existing.id,
    name: `${existing.firstName} ${existing.lastName}`.trim(),
  })
}

// A failed insert aborts the transaction, so duplicates are checked before writing.
async function assertEmailFree(tx: Tx, email: string | null | undefined, exceptId?: string) {
  if (!email) return
  const [existing] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.email, email), isNull(contacts.deletedAt)))
  if (existing && existing.id !== exceptId) throw await duplicateEmailError(tx, email)
}

export async function createContact(tx: Tx, ctx: TenantContext, input: z.output<typeof createContactSchema>) {
  const { tags, ...fields } = input
  const ownerUserId = fields.ownerUserId === undefined ? ctx.userId : fields.ownerUserId
  await assertMember(tx, ownerUserId)
  await assertCompany(tx, fields.companyId)
  await assertEmailFree(tx, fields.email)

  const values = {
    ...fields,
    tenantId: ctx.tenantId,
    ownerUserId,
    createdByUserId: ctx.userId,
    consentUpdatedAt: fields.marketingConsent || fields.consentBasis ? new Date() : null,
  }
  try {
    const [row] = await tx
      .insert(contacts)
      .values({ ...values, searchText: searchTextOf({ ...values, lastName: values.lastName ?? '' } as ContactRow) })
      .returning()
    await setContactTags(tx, ctx, row!.id, tags)
    await audit(tx, ctx, { action: 'create', entityType: 'contact', entityId: row!.id, after: { ...row, searchText: undefined, tags } })
    return getContact(tx, row!.id)
  } catch (err) {
    if (isUniqueViolation(err, 'contacts_tenant_email_idx') && fields.email) throw await duplicateEmailError(tx, fields.email)
    throw err
  }
}

export async function updateContact(tx: Tx, ctx: TenantContext, id: string, input: z.output<typeof updateContactSchema>) {
  const { tags, ...fields } = input
  const [before] = await tx.select().from(contacts).where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
  if (!before) throw new HttpError(404, 'not_found', 'Contact not found')
  if (fields.ownerUserId !== undefined) await assertMember(tx, fields.ownerUserId)
  if (fields.companyId !== undefined) await assertCompany(tx, fields.companyId)
  if (fields.email !== undefined) await assertEmailFree(tx, fields.email, id)

  const consentChanged =
    (fields.marketingConsent !== undefined && fields.marketingConsent !== before.marketingConsent) ||
    (fields.consentBasis !== undefined && fields.consentBasis !== before.consentBasis)
  const merged = { ...before, ...fields } as ContactRow
  const beforeTags = (await getContact(tx, id)).tags

  const [after] = await tx
    .update(contacts)
    .set({
      ...fields,
      searchText: searchTextOf(merged),
      ...(consentChanged ? { consentUpdatedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, id))
    .returning()
  if (tags) await setContactTags(tx, ctx, id, tags)
  await audit(tx, ctx, {
    action: 'update',
    entityType: 'contact',
    entityId: id,
    before: { ...before, searchText: undefined, tags: beforeTags },
    after: { ...after, searchText: undefined, tags: tags ?? beforeTags },
  })
  return getContact(tx, id)
}

export async function deleteContact(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx
    .update(contacts)
    .set({ deletedAt: new Date(), deletedByUserId: ctx.userId })
    .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
    .returning({ id: contacts.id })
  if (!row) throw new HttpError(404, 'not_found', 'Contact not found')
  await audit(tx, ctx, { action: 'delete', entityType: 'contact', entityId: id })
  await schedulePurge(ctx, 'contact', id)
}

export async function restoreContact(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx.select().from(contacts).where(and(eq(contacts.id, id), sql`${contacts.deletedAt} is not null`))
  if (!row) throw new HttpError(404, 'not_found', 'Contact not found in Trash')
  await assertEmailFree(tx, row.email)
  await tx.update(contacts).set({ deletedAt: null, deletedByUserId: null, updatedAt: new Date() }).where(eq(contacts.id, id))
  await audit(tx, ctx, { action: 'restore', entityType: 'contact', entityId: id })
  return getContact(tx, id)
}
