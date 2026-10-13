import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type { z } from 'zod'
import {
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  mapRow,
  missingRequired,
  normalizeLabel,
  parseCsv,
  type Import,
  type ImportDetail,
  type ImportError,
  type ImportField,
  type ImportObject,
  type MappedRow,
  type Picklists,
  createCompanySchema,
  createContactSchema,
  type createImportSchema,
} from '@crm/shared'
import { audit } from '../db/audit.js'
import { isRlsViolation } from '../db/errors.js'
import type { Tx } from '../db/client.js'
import {
  activities,
  activityLinks,
  companies,
  contacts,
  deals,
  importRecords,
  imports,
  memberships,
  pipelineStages,
  pipelines,
  users,
} from '../db/schema.js'
import { withTenant, type TenantContext } from '../db/tenant.js'
import { HttpError } from '../errors.js'
import { MANAGERS } from '../auth/context.js'
import { QUEUES, type TenantJob } from '../jobs/queues.js'
import { createCompany, updateCompany } from './companies.js'
import { createContact, updateContact } from './contacts.js'
import { createDeal, updateDeal } from './deals.js'
import { getPicklists } from './picklists.js'
import { tagsFor } from './tags.js'
import { ensureDefaultPipeline } from './pipelines.js'

// The importer's role travels with the job: an import may only do what its user may do.
export type ImportJob = TenantJob<{ importId: string; role: TenantContext['role'] }>

const CHUNK = 250
const CANCEL_CHECK = 25
export const MAX_IMPORT_ERRORS = 1000

let boss: PgBoss | null = null
export function useImportQueue(instance: PgBoss) {
  boss = instance
}

type ImportRow = typeof imports.$inferSelect

function toImport(row: ImportRow, createdBy: string | null): Import {
  return {
    id: row.id,
    object: row.object,
    fileName: row.fileName,
    mode: row.mode,
    status: row.status,
    header: row.header,
    total: row.total,
    processed: row.processed,
    created: row.created,
    updated: row.updated,
    skipped: row.skipped,
    failed: row.failed,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    undoneAt: row.undoneAt?.toISOString() ?? null,
  }
}

export async function listImports(tx: Tx): Promise<Import[]> {
  const rows = await tx
    .select({ i: imports, by: users.name })
    .from(imports)
    .leftJoin(users, eq(users.id, imports.createdByUserId))
    .orderBy(desc(imports.createdAt))
    .limit(50)
  return rows.map((r) => toImport(r.i, r.by))
}

export async function getImport(tx: Tx, id: string): Promise<ImportDetail> {
  const [row] = await tx.select({ i: imports, by: users.name }).from(imports).leftJoin(users, eq(users.id, imports.createdByUserId)).where(eq(imports.id, id))
  if (!row) throw new HttpError(404, 'not_found', 'Import not found')
  return { ...toImport(row.i, row.by), errors: row.i.errors }
}

// ---- start -------------------------------------------------------------------------

export async function createImport(tx: Tx, ctx: TenantContext, input: z.output<typeof createImportSchema>) {
  const { header, rows } = parseCsv(input.csv)
  const fields = IMPORT_FIELDS[input.object] as readonly string[]
  if (!rows.length) throw new HttpError(400, 'import_empty', 'The file has no rows')
  if (rows.length > MAX_IMPORT_ROWS) throw new HttpError(400, 'import_too_large', `At most ${MAX_IMPORT_ROWS} rows per file`, { max: MAX_IMPORT_ROWS })
  if (input.mapping.length !== header.length) throw new HttpError(400, 'validation_error', 'One mapping entry per column', [{ message: 'mapping_columns' }])
  const used = input.mapping.filter((m): m is string => m !== null)
  if (used.some((m) => !fields.includes(m)) || new Set(used).size !== used.length) {
    throw new HttpError(400, 'validation_error', 'Invalid mapping', [{ message: 'mapping_invalid' }])
  }
  const missing = missingRequired(input.object, input.mapping as Array<ImportField | null>)
  if (missing.length) throw new HttpError(400, 'import_missing_fields', 'Map the required fields', { fields: missing })

  const [row] = await tx
    .insert(imports)
    .values({
      tenantId: ctx.tenantId,
      object: input.object,
      fileName: input.fileName,
      mode: input.mode,
      header,
      mapping: input.mapping,
      source: input.csv,
      total: rows.length,
      createdByUserId: ctx.userId,
    })
    .returning()
  await audit(tx, ctx, { action: 'import', entityType: input.object, entityId: row!.id, after: { fileName: input.fileName, rows: rows.length, mode: input.mode } })
  return row!
}

// Queued in the worker; without one (tests, scripts) it runs right away.
export async function startImport(ctx: TenantContext, importId: string) {
  const job: ImportJob = { tenantId: ctx.tenantId, userId: ctx.userId, importId, role: ctx.role }
  if (boss) await boss.send(QUEUES.importRun, job, { retryLimit: 0 })
  else await runImport(job)
}

// ---- run -----------------------------------------------------------------------------

type Lookups = {
  members: Map<string, string>
  picklists: Picklists
  pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>
}

async function loadLookups(tx: Tx, ctx: TenantContext): Promise<Lookups> {
  const members = await tx.select({ id: users.id, email: users.email, name: users.name }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
  const memberMap = new Map<string, string>()
  // Owners can be given by email or by full name.
  for (const m of members) {
    memberMap.set(m.email.toLowerCase(), m.id)
    memberMap.set(m.name.toLowerCase(), m.id)
  }
  await ensureDefaultPipeline(tx, ctx)
  const p = await tx.select().from(pipelines).orderBy(asc(pipelines.position))
  const s = await tx.select().from(pipelineStages).orderBy(asc(pipelineStages.position))
  return {
    members: memberMap,
    picklists: await getPicklists(tx, ctx),
    pipelines: p.map((x) => ({ id: x.id, name: x.name, stages: s.filter((st) => st.pipelineId === x.id) })),
  }
}

class RowError extends Error {
  constructor(
    public field: string | null,
    public code: string,
  ) {
    super(code)
  }
}

type Outcome = { action: 'created' | 'updated' | 'skipped'; record?: { type: 'contact' | 'company' | 'deal'; id: string; before?: Record<string, unknown> }; extra?: Array<{ type: 'company' | 'contact'; id: string }> }

// Workspace labels for picklists ("Mässa 2026") map to their key.
function picklistKey(lists: Picklists, kind: 'lead_source' | 'industry', value: unknown) {
  if (typeof value !== 'string') return value
  const item = lists[kind]?.find((i) => i.key === value || (i.label && normalizeLabel(i.label) === normalizeLabel(value)))
  return item?.key ?? value
}

function owner(lookups: Lookups, ref: string | undefined) {
  if (!ref) return undefined
  const id = lookups.members.get(ref.toLowerCase())
  if (!id) throw new RowError('owner', 'not_found')
  return id
}

// Finds a live company by name (case-insensitive), or creates it. New companies are undone with the import.
async function companyByName(tx: Tx, ctx: TenantContext, name: string | undefined, created: Outcome['extra']) {
  if (!name) return undefined
  const [found] = await tx
    .select({ id: companies.id })
    .from(companies)
    .where(and(sql`lower(${companies.name}) = ${name.toLowerCase()}`, isNull(companies.deletedAt)))
    .orderBy(asc(companies.createdAt))
    .limit(1)
  if (found) return found.id
  const company = await createCompany(tx, ctx, createCompanySchema.parse({ name }))
  created!.push({ type: 'company', id: company.id })
  return company.id
}

// Only the values the file provides are written when updating an existing record.
const changedFields = (before: Record<string, unknown>, input: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(input).filter((k) => k !== 'tags').map((k) => [k, before[k] ?? null]))

async function importContact(tx: Tx, ctx: TenantContext, mode: string, mapped: MappedRow, lookups: Lookups): Promise<Outcome> {
  const input = { ...mapped.input } as Record<string, unknown> & { email?: string | null; tags?: string[] }
  if ('leadSource' in input) input.leadSource = picklistKey(lookups.picklists, 'lead_source', input.leadSource)
  const ownerUserId = owner(lookups, mapped.refs.owner)
  const extra: Outcome['extra'] = []
  // Looked up only for rows that are written, so a skipped row never creates a company.
  const refs = async () => {
    const companyId = await companyByName(tx, ctx, mapped.refs.company, extra)
    return { ...(companyId ? { companyId } : {}), ...(ownerUserId ? { ownerUserId } : {}) }
  }
  if (input.email) {
    const [existing] = await tx.select().from(contacts).where(and(eq(contacts.email, input.email), isNull(contacts.deletedAt)))
    if (existing) {
      if (mode === 'skip') return { action: 'skipped' }
      const { tags, ...fields } = input
      // Tags from the file are added to the contact's tags, never removed.
      const current = (await tagsFor(tx, 'contact', [existing.id])).get(existing.id) ?? []
      const changes = { ...fields, ...(await refs()), ...(tags?.length ? { tags: [...current, ...tags] } : {}) }
      await updateContact(tx, ctx, existing.id, changes)
      return { action: 'updated', record: { type: 'contact', id: existing.id, before: changedFields(existing, changes) }, extra }
    }
  }
  const contact = await createContact(tx, ctx, { ...createContactSchema.parse(input), ...(await refs()) })
  return { action: 'created', record: { type: 'contact', id: contact.id }, extra }
}

// Shared mailboxes (info@, faktura@ …) belong to the company, not to its contact person.
const ROLE_MAILBOX = /^(info|kontakt|contact|faktura|fakturor|invoice|invoices|ekonomi|order|admin|post|mail|office|kontoret|support|hej|hello|kundtjanst|kundservice)[.+@]/i

// The company's contact person becomes a contact on it, with the row's email and phone, unless the "person"
// is just the company's own name, the company already has a contact with that name, or the email is someone else's.
async function contactPerson(
  tx: Tx,
  ctx: TenantContext,
  company: { id: string; name: string },
  person: { name?: string; email?: string | null; phone?: string | null },
  created: NonNullable<Outcome['extra']>,
) {
  const { name } = person
  const companyId = company.id
  if (!name || normalizeLabel(name) === normalizeLabel(company.name)) return
  const [first = name, ...rest] = name.split(/\s+/)
  const [existing] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.companyId, companyId),
        sql`lower(${contacts.firstName} || ' ' || ${contacts.lastName}) = ${`${first} ${rest.join(' ')}`.toLowerCase()}`,
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1)
  if (existing) return
  let email = person.email && !ROLE_MAILBOX.test(person.email) ? person.email : null
  if (email) {
    const [taken] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.email, email), isNull(contacts.deletedAt))).limit(1)
    if (taken) email = null
  }
  const contact = await createContact(tx, ctx, {
    ...createContactSchema.parse({ firstName: first, lastName: rest.join(' '), email, phone: person.phone ?? null }),
    companyId,
  })
  created.push({ type: 'contact', id: contact.id })
}

async function importCompany(tx: Tx, ctx: TenantContext, mode: string, mapped: MappedRow, lookups: Lookups): Promise<Outcome> {
  const input = { ...mapped.input } as Record<string, unknown> & { orgNumber?: string | null; fortnoxCustomerNumber?: string | null; domain?: string | null }
  if ('industry' in input) input.industry = picklistKey(lookups.picklists, 'industry', input.industry)
  const ownerUserId = owner(lookups, mapped.refs.owner)
  const extra: NonNullable<Outcome['extra']> = []
  const person = { name: mapped.refs.contactName, email: input.email as string | null | undefined, phone: input.phone as string | null | undefined }
  // Same company: same org number, else same Fortnox customer number, else same domain.
  const match = input.orgNumber
    ? eq(companies.orgNumber, input.orgNumber)
    : input.fortnoxCustomerNumber
      ? eq(companies.fortnoxCustomerNumber, input.fortnoxCustomerNumber)
      : input.domain
        ? eq(companies.domain, input.domain)
        : null
  if (match) {
    const [existing] = await tx.select().from(companies).where(and(match, isNull(companies.deletedAt))).limit(1)
    if (existing) {
      if (mode === 'skip') return { action: 'skipped' }
      const changes = { ...input, tags: undefined, ...(ownerUserId ? { ownerUserId } : {}) }
      await updateCompany(tx, ctx, existing.id, changes)
      await contactPerson(tx, ctx, { id: existing.id, name: (input.name as string | undefined) ?? existing.name }, person, extra)
      return { action: 'updated', record: { type: 'company', id: existing.id, before: changedFields(existing, changes) }, extra }
    }
  }
  const company = await createCompany(tx, ctx, { ...createCompanySchema.parse(input), ...(ownerUserId ? { ownerUserId } : {}) })
  await contactPerson(tx, ctx, company, person, extra)
  return { action: 'created', record: { type: 'company', id: company.id }, extra }
}

async function importDeal(tx: Tx, ctx: TenantContext, mode: string, mapped: MappedRow, lookups: Lookups): Promise<Outcome> {
  const { status, ...input } = mapped.input as Record<string, unknown> & { name: string; status?: 'open' | 'won' | 'lost' }
  const ownerUserId = owner(lookups, mapped.refs.owner)
  const pipeline = mapped.refs.pipeline
    ? lookups.pipelines.find((p) => normalizeLabel(p.name) === normalizeLabel(mapped.refs.pipeline!))
    : lookups.pipelines[0]
  if (!pipeline) throw new RowError('pipeline', 'not_found')
  const stage = mapped.refs.stage ? pipeline.stages.find((s) => normalizeLabel(s.name) === normalizeLabel(mapped.refs.stage!)) : pipeline.stages[0]
  if (!stage) throw new RowError('stage', 'not_found')
  let contactIds: string[] = []
  if (mapped.refs.contactEmail) {
    const [c] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.email, mapped.refs.contactEmail), isNull(contacts.deletedAt)))
    if (!c) throw new RowError('contactEmail', 'not_found')
    contactIds = [c.id]
  }
  const extra: Outcome['extra'] = []
  // A company that does not exist yet cannot have the deal either, so it is only created for new deals.
  const [knownCompany] = mapped.refs.company
    ? await tx
        .select({ id: companies.id })
        .from(companies)
        .where(and(sql`lower(${companies.name}) = ${mapped.refs.company.toLowerCase()}`, isNull(companies.deletedAt)))
        .orderBy(asc(companies.createdAt))
        .limit(1)
    : []
  const companyId = knownCompany?.id

  // Same deal: same name and company. A company that does not exist yet has no deals.
  const [existing] = mapped.refs.company && !companyId ? [] : await tx
    .select()
    .from(deals)
    .where(
      and(
        sql`lower(${deals.name}) = ${input.name.toLowerCase()}`,
        companyId ? eq(deals.companyId, companyId) : isNull(deals.companyId),
        isNull(deals.deletedAt),
      ),
    )
    .limit(1)
  if (existing) {
    if (mode === 'skip') return { action: 'skipped' }
    const changes = { ...input, ...(ownerUserId ? { ownerUserId } : {}), ...(contactIds.length ? { contactIds } : {}) }
    await updateDeal(tx, ctx, existing.id, changes)
    return { action: 'updated', record: { type: 'deal', id: existing.id, before: changedFields(existing, { ...changes, contactIds: undefined }) }, extra }
  }
  const deal = await createDeal(tx, ctx, {
    ...(input as Parameters<typeof createDeal>[2]),
    pipelineId: pipeline.id,
    stageId: stage.id,
    contactIds,
    ...(mapped.refs.company ? { companyId: companyId ?? (await companyByName(tx, ctx, mapped.refs.company, extra)) } : {}),
    ...(ownerUserId ? { ownerUserId } : {}),
  })
  // Closed deals come in closed; the lost reason is left empty.
  if (status && status !== 'open') await tx.update(deals).set({ status, closedAt: new Date() }).where(eq(deals.id, deal.id))
  return { action: 'created', record: { type: 'deal', id: deal.id }, extra }
}

const importers = { contacts: importContact, companies: importCompany, deals: importDeal }

// The key that makes two rows in one file the same record.
function fileKey(object: ImportObject, mapped: MappedRow): string | null {
  const i = mapped.input as Record<string, string | undefined>
  if (object === 'contacts') return i.email ? `e:${i.email}` : null
  if (object === 'companies') return i.orgNumber ? `o:${i.orgNumber}` : i.fortnoxCustomerNumber ? `f:${i.fortnoxCustomerNumber}` : i.domain ? `d:${i.domain}` : null
  return i.name ? `n:${i.name.toLowerCase()}|${(mapped.refs.company ?? '').toLowerCase()}` : null
}

function errorFromException(err: unknown): { field: string | null; code: string } {
  if (err instanceof RowError) return { field: err.field, code: err.code }
  // Refused by RLS, e.g. another owner while the workspace shows members only their own records.
  if (isRlsViolation(err)) return { field: 'owner', code: 'forbidden' }
  if (err instanceof HttpError) {
    if (err.code === 'duplicate_email') return { field: 'email', code: 'exists' }
    if (err.code === 'duplicate_org_number') return { field: 'orgNumber', code: 'exists' }
    const detail = Array.isArray(err.details) ? (err.details[0] as { message?: string } | undefined)?.message : undefined
    return { field: null, code: detail ?? err.code }
  }
  throw err
}

export async function runImport(job: ImportJob) {
  const ctx: TenantContext = { tenantId: job.tenantId, userId: job.userId, role: job.role ?? 'member' }
  const row = await withTenant(ctx, async (tx) => {
    const [r] = await tx
      .update(imports)
      .set({ status: 'running' })
      .where(and(eq(imports.id, job.importId), eq(imports.status, 'queued')))
      .returning()
    return r
  })
  if (!row?.source) return

  const { rows } = parseCsv(row.source)
  const mapping = row.mapping as Array<ImportField | null>
  const seen = new Set<string>()
  const errors: ImportError[] = []
  const counts = { created: 0, updated: 0, skipped: 0, failed: 0 }
  const fail = (index: number, values: string[], field: string | null, code: string) => {
    counts.failed++
    if (errors.length < MAX_IMPORT_ERRORS) errors.push({ row: index + 1, field, code, values })
  }

  // Someone pressed Cancel: checked every few rows so a slow import stops quickly.
  const cancelled = async (tx: Tx) => (await tx.select({ status: imports.status }).from(imports).where(eq(imports.id, row.id)))[0]?.status === 'cancelled'
  let stopped = false

  try {
    for (let start = 0; start < rows.length && !stopped; start += CHUNK) {
      await withTenant(ctx, async (tx) => {
        const lookups = await loadLookups(tx, ctx)
        let processed = Math.min(start + CHUNK, rows.length)
        for (let i = start; i < Math.min(start + CHUNK, rows.length); i++) {
          if (i % CANCEL_CHECK === 0 && (await cancelled(tx))) {
            // Rows done so far are kept (and listed for undo); the rest is not imported.
            stopped = true
            processed = i
            break
          }
          const values = rows[i]!
          const mapped = mapRow(row.object, mapping, values)
          if (mapped.issues.length) {
            fail(i, values, mapped.issues[0]!.field ?? null, mapped.issues[0]!.code)
            continue
          }
          const key = fileKey(row.object, mapped)
          if (key && seen.has(key)) {
            counts.skipped++
            if (errors.length < MAX_IMPORT_ERRORS) errors.push({ row: i + 1, field: null, code: 'duplicate_in_file', values })
            continue
          }
          if (key) seen.add(key)
          try {
            // A savepoint per row: a bad row rolls back alone.
            const outcome = await tx.transaction((sp) => importers[row.object](sp, ctx, row.mode, mapped, lookups))
            counts[outcome.action]++
            const tracked = [
              ...(outcome.record && outcome.action !== 'skipped'
                ? [{ recordType: outcome.record.type, recordId: outcome.record.id, action: outcome.action, before: outcome.record.before ?? null }]
                : []),
              ...(outcome.extra ?? []).map((e) => ({ recordType: e.type, recordId: e.id, action: 'created', before: null })),
            ]
            if (tracked.length) await tx.insert(importRecords).values(tracked.map((t) => ({ ...t, tenantId: ctx.tenantId, importId: row.id })))
            // Imported, but changed on the way in: listed so someone can check them.
            for (const n of mapped.notices) if (errors.length < MAX_IMPORT_ERRORS) errors.push({ row: i + 1, field: n.field ?? null, code: n.code, values })
          } catch (err) {
            const { field, code } = errorFromException(err)
            fail(i, values, field, code)
          }
        }
        await tx
          .update(imports)
          .set({ processed, ...counts, errors })
          .where(eq(imports.id, row.id))
      })
    }
    // A cancelled import keeps its status; only a running one becomes done.
    await withTenant(ctx, (tx) =>
      tx
        .update(imports)
        .set({ status: 'done', finishedAt: new Date(), source: null, ...counts, errors })
        .where(and(eq(imports.id, row.id), eq(imports.status, 'running'))),
    )
  } catch (err) {
    console.error('[imports] failed', row.id, err)
    await withTenant(ctx, (tx) =>
      tx
        .update(imports)
        .set({ status: 'failed', finishedAt: new Date(), source: null, ...counts, errors })
        .where(and(eq(imports.id, row.id), eq(imports.status, 'running'))),
    )
  }
}

// ---- cancel ---------------------------------------------------------------------------

// Stops a queued or running import. Rows already imported stay, so the import can then be undone.
// Also releases an import whose worker died (it would otherwise show as running forever).
export async function cancelImport(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx.select().from(imports).where(eq(imports.id, id))
  if (!row) throw new HttpError(404, 'not_found', 'Import not found')
  if (row.createdByUserId !== ctx.userId && !(MANAGERS as readonly string[]).includes(ctx.role)) {
    throw new HttpError(403, 'forbidden', 'Only the person who imported or an admin can cancel it')
  }
  if (row.status !== 'queued' && row.status !== 'running') throw new HttpError(409, 'import_finished', 'The import has already finished')
  await tx.update(imports).set({ status: 'cancelled', finishedAt: new Date(), source: null }).where(eq(imports.id, id))
  await audit(tx, ctx, { action: 'cancel_import', entityType: row.object, entityId: id, after: { processed: row.processed, created: row.created } })
  return getImport(tx, id)
}

// ---- undo ----------------------------------------------------------------------------

const tables = { contact: contacts, company: companies, deal: deals }

// Erases everything the import created and puts back the values it overwrote.
export async function undoImport(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx.select().from(imports).where(eq(imports.id, id))
  if (!row) throw new HttpError(404, 'not_found', 'Import not found')
  if (row.createdByUserId !== ctx.userId && !(MANAGERS as readonly string[]).includes(ctx.role)) {
    throw new HttpError(403, 'forbidden', 'Only the person who imported or an admin can undo it')
  }
  if (row.status !== 'done' && row.status !== 'failed' && row.status !== 'cancelled') throw new HttpError(409, 'import_not_finished', 'The import has not finished')

  const records = await tx.select().from(importRecords).where(eq(importRecords.importId, id))
  const created = (type: 'contact' | 'company' | 'deal') => records.filter((r) => r.recordType === type && r.action === 'created').map((r) => r.recordId)
  const createdContacts = created('contact')
  const createdCompanies = created('company')
  const createdDeals = created('deal')

  // Activities only on records that are about to be erased go with them.
  const linked = createdContacts.length + createdCompanies.length + createdDeals.length
    ? (
        await tx
          .select({ id: activityLinks.activityId })
          .from(activityLinks)
          .where(
            sql`${activityLinks.contactId} in ${createdContacts.length ? createdContacts : [id]}
              or ${activityLinks.companyId} in ${createdCompanies.length ? createdCompanies : [id]}
              or ${activityLinks.dealId} in ${createdDeals.length ? createdDeals : [id]}`,
          )
      ).map((l) => l.id)
    : []

  if (createdCompanies.length) {
    // Records that outlive the import keep existing without the company.
    await tx.update(contacts).set({ companyId: null }).where(inArray(contacts.companyId, createdCompanies))
    await tx.update(deals).set({ companyId: null }).where(inArray(deals.companyId, createdCompanies))
  }
  for (const [type, ids] of [['deal', createdDeals], ['contact', createdContacts], ['company', createdCompanies]] as const) {
    if (ids.length) await tx.delete(tables[type]).where(inArray(tables[type].id, ids))
  }
  if (linked.length) {
    await tx.delete(activities).where(and(inArray(activities.id, linked), sql`not exists (select 1 from ${activityLinks} where ${activityLinks.activityId} = ${activities.id})`))
  }

  let restored = 0
  for (const r of records.filter((x) => x.action === 'updated' && x.before)) {
    const table = tables[r.recordType]
    const done = await tx
      .update(table)
      .set({ ...(r.before as object), updatedAt: new Date() })
      .where(and(eq(table.id, r.recordId), isNull(table.deletedAt)))
      .returning({ id: table.id })
    restored += done.length
  }

  await tx.update(imports).set({ status: 'undone', undoneAt: new Date() }).where(eq(imports.id, id))
  await audit(tx, ctx, {
    action: 'undo_import',
    entityType: row.object,
    entityId: id,
    after: { erased: createdContacts.length + createdCompanies.length + createdDeals.length, restored },
  })
  return getImport(tx, id)
}
