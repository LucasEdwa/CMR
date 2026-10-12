import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { z } from 'zod'
import type {
  Board,
  Deal,
  DealDetail,
  createDealSchema,
  dealListQuerySchema,
  updateDealSchema,
} from '@crm/shared'
import { audit } from '../db/audit.js'
import type { Tx } from '../db/client.js'
import { companies, contacts, dealContacts, dealStageHistory, deals, pipelineStages, pipelines, tenants, users } from '../db/schema.js'
import type { TenantContext } from '../db/tenant.js'
import { HttpError } from '../errors.js'
import { assertMember, buildSearchText, likePattern, ownerFilter, ownerRef, sv } from './common.js'
import { ensureDefaultPipeline } from './pipelines.js'
import { picklistHas } from './picklists.js'
import { schedulePurge } from './purge.js'
import { nextTasksForDeals } from './tasks.js'

type DealRow = typeof deals.$inferSelect
type Currency = Deal['currency']
const DAY_MS = 86_400_000

const owner = alias(users, 'owner')

const selection = {
  deal: deals,
  pipelineName: pipelines.name,
  stageName: pipelineStages.name,
  stagePosition: pipelineStages.position,
  probability: pipelineStages.probability,
  ownerName: owner.name,
  companyName: companies.name,
}

const baseQuery = (tx: Tx) =>
  tx
    .select(selection)
    .from(deals)
    .innerJoin(pipelines, and(eq(pipelines.id, deals.pipelineId), eq(pipelines.tenantId, deals.tenantId)))
    .innerJoin(pipelineStages, and(eq(pipelineStages.id, deals.stageId), eq(pipelineStages.tenantId, deals.tenantId)))
    .leftJoin(owner, eq(owner.id, deals.ownerUserId))
    .leftJoin(
      companies,
      and(eq(companies.id, deals.companyId), eq(companies.tenantId, deals.tenantId), isNull(companies.deletedAt)),
    )

type Row = Awaited<ReturnType<ReturnType<typeof baseQuery>['execute']>>[number]

async function staleDaysOf(tx: Tx, ctx: TenantContext) {
  const [t] = await tx.select({ d: tenants.staleDealDays }).from(tenants).where(eq(tenants.id, ctx.tenantId))
  return t?.d ?? 14
}

// Linked contacts for a page of deals, in one query.
async function contactsFor(tx: Tx, ids: string[]) {
  const map = new Map<string, Array<{ id: string; name: string }>>()
  if (!ids.length) return map
  const rows = await tx
    .select({ dealId: dealContacts.dealId, id: contacts.id, first: contacts.firstName, last: contacts.lastName })
    .from(dealContacts)
    .innerJoin(contacts, and(eq(contacts.id, dealContacts.contactId), eq(contacts.tenantId, dealContacts.tenantId)))
    .where(and(inArray(dealContacts.dealId, ids), isNull(contacts.deletedAt)))
    .orderBy(sv(contacts.lastName), sv(contacts.firstName))
  for (const r of rows) map.set(r.dealId, [...(map.get(r.dealId) ?? []), { id: r.id, name: `${r.first} ${r.last}`.trim() }])
  return map
}

async function toDeals(tx: Tx, ctx: TenantContext, rows: Row[]): Promise<Deal[]> {
  const ids = rows.map((r) => r.deal.id)
  const [linked, staleDays, nextTasks] = await Promise.all([contactsFor(tx, ids), staleDaysOf(tx, ctx), nextTasksForDeals(tx, ids)])
  const staleBefore = Date.now() - staleDays * DAY_MS
  return rows.map(({ deal: d, ...r }) => ({
    id: d.id,
    name: d.name,
    value: d.value,
    currency: d.currency as Currency,
    status: d.status,
    pipeline: { id: d.pipelineId, name: r.pipelineName },
    stage: { id: d.stageId, name: r.stageName, probability: r.probability },
    lostReason: d.lostReason,
    lostNote: d.lostNote,
    closedAt: d.closedAt?.toISOString() ?? null,
    expectedCloseDate: d.expectedCloseDate,
    owner: ownerRef(d.ownerUserId, r.ownerName),
    company: d.companyId && r.companyName ? { id: d.companyId, name: r.companyName } : null,
    contacts: linked.get(d.id) ?? [],
    stale: d.status === 'open' && d.lastActivityAt.getTime() < staleBefore,
    nextTask: d.status === 'open' ? (nextTasks.get(d.id) ?? null) : null,
    lastActivityAt: d.lastActivityAt.toISOString(),
    stageEnteredAt: d.stageEnteredAt.toISOString(),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }))
}

// ---- reads -------------------------------------------------------------------

export async function listDeals(tx: Tx, ctx: TenantContext, q: z.output<typeof dealListQuerySchema>) {
  const where: SQL[] = [isNull(deals.deletedAt)]
  if (q.q) where.push(sql`${deals.searchText} like ${likePattern(q.q)}`)
  if (q.pipelineId) where.push(eq(deals.pipelineId, q.pipelineId))
  if (q.status.length) where.push(inArray(deals.status, q.status))
  if (q.stage.length) where.push(inArray(deals.stageId, q.stage))
  if (q.companyId) where.push(eq(deals.companyId, q.companyId))
  if (q.contactId) {
    where.push(sql`${deals.id} in (select deal_id from ${dealContacts} where contact_id = ${q.contactId})`)
  }
  const ownerCond = ownerFilter(deals.ownerUserId, q.owner, ctx)
  if (ownerCond) where.push(ownerCond)

  const dir = q.dir === 'desc' ? desc : asc
  const order: SQL[] = {
    name: [dir(sv(deals.name))],
    value: [dir(deals.value)],
    expectedCloseDate: [sql`${deals.expectedCloseDate} ${sql.raw(q.dir)} nulls last`],
    stage: [dir(pipelineStages.position)],
    createdAt: [dir(deals.createdAt)],
    updatedAt: [dir(deals.updatedAt)],
  }[q.sort]

  const [rows, [total]] = await Promise.all([
    baseQuery(tx)
      .where(and(...where))
      .orderBy(...order, asc(deals.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    tx.select({ n: sql<number>`count(*)::int` }).from(deals).where(and(...where)),
  ])
  return { items: await toDeals(tx, ctx, rows), total: total!.n, page: q.page, pageSize: q.pageSize }
}

// Open deals of one pipeline, grouped by stage, with count and value totals per currency.
export async function getBoard(tx: Tx, ctx: TenantContext, pipelineId: string): Promise<Board> {
  const stages = await tx
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, pipelineId))
    .orderBy(asc(pipelineStages.position))
  if (!stages.length) throw new HttpError(404, 'not_found', 'Pipeline not found')
  const rows = await baseQuery(tx)
    .where(and(eq(deals.pipelineId, pipelineId), eq(deals.status, 'open'), isNull(deals.deletedAt)))
    .orderBy(asc(deals.position), asc(deals.createdAt))
  const all = await toDeals(tx, ctx, rows)
  return {
    pipelineId,
    columns: stages.map((stage) => {
      const inStage = all.filter((d) => d.stage.id === stage.id)
      const totals = new Map<Currency, number>()
      for (const d of inStage) totals.set(d.currency, (totals.get(d.currency) ?? 0) + d.value)
      return {
        stage: { id: stage.id, name: stage.name, position: stage.position, probability: stage.probability },
        count: inStage.length,
        totals: [...totals].map(([currency, sum]) => ({ currency, sum })),
        deals: inStage,
      }
    }),
  }
}

async function getRow(tx: Tx, id: string) {
  const [row] = await baseQuery(tx).where(and(eq(deals.id, id), isNull(deals.deletedAt)))
  if (!row) throw new HttpError(404, 'not_found', 'Deal not found')
  return row
}

export async function getDeal(tx: Tx, ctx: TenantContext, id: string): Promise<DealDetail> {
  const row = await getRow(tx, id)
  const [deal] = await toDeals(tx, ctx, [row])
  const changer = alias(users, 'changer')
  const history = await tx
    .select({ h: dealStageHistory, by: changer.name })
    .from(dealStageHistory)
    .leftJoin(changer, eq(changer.id, dealStageHistory.changedByUserId))
    .where(eq(dealStageHistory.dealId, id))
    .orderBy(asc(dealStageHistory.enteredAt))
  // A closed deal's time in its last stage stops at the close.
  const end = row.deal.closedAt?.getTime() ?? Date.now()
  return {
    ...deal!,
    history: history.map(({ h, by }) => ({
      stage: h.stageName,
      pipeline: h.pipelineName,
      enteredAt: h.enteredAt.toISOString(),
      leftAt: h.leftAt?.toISOString() ?? null,
      duration: Math.max(0, (h.leftAt?.getTime() ?? end) - h.enteredAt.getTime()),
      by,
    })),
  }
}

// ---- writes ------------------------------------------------------------------

async function resolveStage(tx: Tx, ctx: TenantContext, pipelineId?: string, stageId?: string) {
  if (stageId) {
    const [stage] = await tx
      .select({ stage: pipelineStages, pipelineName: pipelines.name })
      .from(pipelineStages)
      .innerJoin(pipelines, eq(pipelines.id, pipelineStages.pipelineId))
      .where(eq(pipelineStages.id, stageId))
    if (!stage || (pipelineId && stage.stage.pipelineId !== pipelineId)) {
      throw new HttpError(400, 'validation_error', 'Stage not found', [{ message: 'invalid_stage' }])
    }
    return { ...stage.stage, pipelineName: stage.pipelineName }
  }
  const pipeline = pipelineId
    ? (await tx.select().from(pipelines).where(eq(pipelines.id, pipelineId)))[0]
    : await ensureDefaultPipeline(tx, ctx)
  if (!pipeline) throw new HttpError(400, 'validation_error', 'Pipeline not found', [{ message: 'invalid_pipeline' }])
  const [first] = await tx
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, pipeline.id))
    .orderBy(asc(pipelineStages.position))
    .limit(1)
  return { ...first!, pipelineName: pipeline.name }
}

async function assertContacts(tx: Tx, ids: string[]) {
  if (!ids.length) return
  const found = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(inArray(contacts.id, ids), isNull(contacts.deletedAt)))
  if (found.length !== new Set(ids).size) throw new HttpError(400, 'validation_error', 'Contact not found', [{ message: 'invalid_contact' }])
}

async function assertCompany(tx: Tx, id: string | null | undefined) {
  if (!id) return
  const [c] = await tx.select({ id: companies.id }).from(companies).where(and(eq(companies.id, id), isNull(companies.deletedAt)))
  if (!c) throw new HttpError(400, 'validation_error', 'Company not found', [{ message: 'invalid_company' }])
}

async function setContacts(tx: Tx, ctx: TenantContext, dealId: string, ids: string[]) {
  await tx.delete(dealContacts).where(eq(dealContacts.dealId, dealId))
  const unique = [...new Set(ids)]
  if (unique.length) await tx.insert(dealContacts).values(unique.map((contactId) => ({ tenantId: ctx.tenantId, dealId, contactId })))
}

// New and reopened deals go to the top of their column.
async function topPosition(tx: Tx, stageId: string) {
  const [r] = await tx
    .select({ min: sql<number | null>`min(${deals.position})` })
    .from(deals)
    .where(and(eq(deals.stageId, stageId), eq(deals.status, 'open'), isNull(deals.deletedAt)))
  return (r?.min ?? 1) - 1
}

async function openHistory(tx: Tx, ctx: TenantContext, dealId: string, stage: { id: string; name: string; pipelineName: string }, at: Date) {
  await tx.insert(dealStageHistory).values({
    tenantId: ctx.tenantId,
    dealId,
    stageId: stage.id,
    stageName: stage.name,
    pipelineName: stage.pipelineName,
    enteredAt: at,
    changedByUserId: ctx.userId,
  })
}

const auditable = (d: DealRow) => ({ ...d, searchText: undefined, position: undefined, lastActivityAt: undefined })

export async function createDeal(tx: Tx, ctx: TenantContext, input: z.output<typeof createDealSchema>) {
  const { contactIds, pipelineId, stageId, ...fields } = input
  const stage = await resolveStage(tx, ctx, pipelineId, stageId)
  const ownerUserId = fields.ownerUserId === undefined ? ctx.userId : fields.ownerUserId
  await assertMember(tx, ownerUserId)
  await assertCompany(tx, fields.companyId)
  await assertContacts(tx, contactIds)
  const [tenant] = await tx.select({ currency: tenants.currency }).from(tenants).where(eq(tenants.id, ctx.tenantId))
  const now = new Date()

  const [row] = await tx
    .insert(deals)
    .values({
      ...fields,
      tenantId: ctx.tenantId,
      currency: fields.currency ?? tenant!.currency,
      pipelineId: stage.pipelineId,
      stageId: stage.id,
      position: await topPosition(tx, stage.id),
      ownerUserId,
      createdByUserId: ctx.userId,
      searchText: buildSearchText([fields.name]),
      lastActivityAt: now,
      stageEnteredAt: now,
    })
    .returning()
  await setContacts(tx, ctx, row!.id, contactIds)
  await openHistory(tx, ctx, row!.id, stage, now)
  await audit(tx, ctx, { action: 'create', entityType: 'deal', entityId: row!.id, after: { ...auditable(row!), contactIds } })
  return getDeal(tx, ctx, row!.id)
}

async function liveDeal(tx: Tx, id: string) {
  const [d] = await tx.select().from(deals).where(and(eq(deals.id, id), isNull(deals.deletedAt)))
  if (!d) throw new HttpError(404, 'not_found', 'Deal not found')
  return d
}

export async function updateDeal(tx: Tx, ctx: TenantContext, id: string, input: z.output<typeof updateDealSchema>) {
  const { contactIds, ...fields } = input
  const before = await liveDeal(tx, id)
  if (fields.ownerUserId !== undefined) await assertMember(tx, fields.ownerUserId)
  if (fields.companyId !== undefined) await assertCompany(tx, fields.companyId)
  if (contactIds) await assertContacts(tx, contactIds)
  const beforeContacts = (await tx.select({ id: dealContacts.contactId }).from(dealContacts).where(eq(dealContacts.dealId, id))).map((c) => c.id)

  const now = new Date()
  const [after] = await tx
    .update(deals)
    .set({ ...fields, searchText: buildSearchText([fields.name ?? before.name]), updatedAt: now, lastActivityAt: now })
    .where(eq(deals.id, id))
    .returning()
  if (contactIds) await setContacts(tx, ctx, id, contactIds)
  await audit(tx, ctx, {
    action: 'update',
    entityType: 'deal',
    entityId: id,
    before: { ...auditable(before), contactIds: beforeContacts.sort() },
    after: { ...auditable(after!), contactIds: (contactIds ?? beforeContacts).sort() },
  })
  return getDeal(tx, ctx, id)
}

export async function moveDeal(tx: Tx, ctx: TenantContext, id: string, stageId: string, index?: number) {
  const before = await liveDeal(tx, id)
  if (before.status !== 'open') throw new HttpError(409, 'deal_closed', 'Reopen the deal before moving it')
  const stage = await resolveStage(tx, ctx, undefined, stageId)

  // Position between the neighbours at `index` in the target column (excluding this deal).
  const column = await tx
    .select({ id: deals.id, position: deals.position })
    .from(deals)
    .where(and(eq(deals.stageId, stage.id), eq(deals.status, 'open'), isNull(deals.deletedAt), ne(deals.id, id)))
    .orderBy(asc(deals.position), asc(deals.createdAt))
  const i = Math.min(index ?? column.length, column.length)
  const prev = column[i - 1]?.position
  const next = column[i]?.position
  const position = prev === undefined && next === undefined ? 0 : prev === undefined ? next! - 1 : next === undefined ? prev + 1 : (prev + next) / 2

  const now = new Date()
  const changed = stage.id !== before.stageId
  await tx
    .update(deals)
    .set({
      stageId: stage.id,
      pipelineId: stage.pipelineId,
      position,
      updatedAt: now,
      ...(changed ? { stageEnteredAt: now, lastActivityAt: now } : {}),
    })
    .where(eq(deals.id, id))

  if (changed) {
    await tx
      .update(dealStageHistory)
      .set({ leftAt: now })
      .where(and(eq(dealStageHistory.dealId, id), isNull(dealStageHistory.leftAt)))
    await openHistory(tx, ctx, id, stage, now)
    const [from] = await tx.select({ name: pipelineStages.name }).from(pipelineStages).where(eq(pipelineStages.id, before.stageId))
    await audit(tx, ctx, { action: 'move', entityType: 'deal', entityId: id, before: { stage: from?.name ?? null }, after: { stage: stage.name } })
  }
  return getDeal(tx, ctx, id)
}

export async function closeDeal(
  tx: Tx,
  ctx: TenantContext,
  id: string,
  outcome: { status: 'won' } | { status: 'lost'; reason: string; note?: string },
) {
  const before = await liveDeal(tx, id)
  if (before.status !== 'open') throw new HttpError(409, 'deal_closed', 'The deal is already closed')
  if (outcome.status === 'lost' && !(await picklistHas(tx, ctx, 'lost_reason', outcome.reason))) {
    throw new HttpError(400, 'validation_error', 'Pick a lost reason from the list', [{ message: 'invalid_lost_reason' }])
  }
  const now = new Date()
  await tx
    .update(deals)
    .set({
      status: outcome.status,
      lostReason: outcome.status === 'lost' ? outcome.reason : null,
      lostNote: outcome.status === 'lost' ? (outcome.note ?? null) : null,
      closedAt: now,
      updatedAt: now,
      lastActivityAt: now,
    })
    .where(eq(deals.id, id))
  await audit(tx, ctx, {
    action: outcome.status,
    entityType: 'deal',
    entityId: id,
    before: { status: 'open' },
    after: { status: outcome.status, ...(outcome.status === 'lost' ? { lostReason: outcome.reason } : {}) },
  })
  return getDeal(tx, ctx, id)
}

export async function reopenDeal(tx: Tx, ctx: TenantContext, id: string) {
  const before = await liveDeal(tx, id)
  if (before.status === 'open') return getDeal(tx, ctx, id)
  const now = new Date()
  await tx
    .update(deals)
    .set({ status: 'open', lostReason: null, lostNote: null, closedAt: null, position: await topPosition(tx, before.stageId), updatedAt: now, lastActivityAt: now })
    .where(eq(deals.id, id))
  await audit(tx, ctx, { action: 'reopen', entityType: 'deal', entityId: id, before: { status: before.status }, after: { status: 'open' } })
  return getDeal(tx, ctx, id)
}

export async function deleteDeal(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx
    .update(deals)
    .set({ deletedAt: new Date(), deletedByUserId: ctx.userId })
    .where(and(eq(deals.id, id), isNull(deals.deletedAt)))
    .returning({ id: deals.id })
  if (!row) throw new HttpError(404, 'not_found', 'Deal not found')
  await audit(tx, ctx, { action: 'delete', entityType: 'deal', entityId: id })
  await schedulePurge(ctx, 'deal', id)
}

export async function restoreDeal(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx.select().from(deals).where(and(eq(deals.id, id), sql`${deals.deletedAt} is not null`))
  if (!row) throw new HttpError(404, 'not_found', 'Deal not found in Trash')
  await tx.update(deals).set({ deletedAt: null, deletedByUserId: null, updatedAt: new Date() }).where(eq(deals.id, id))
  await audit(tx, ctx, { action: 'restore', entityType: 'deal', entityId: id })
  return getDeal(tx, ctx, id)
}

