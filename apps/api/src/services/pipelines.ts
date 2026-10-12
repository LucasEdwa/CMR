import { and, asc, count, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import { DEFAULT_STAGES, type Locale, type Pipeline, type SaveStagesInput } from '@crm/shared'
import { audit } from '../db/audit.js'
import type { Tx } from '../db/client.js'
import { deals, pipelineStages, pipelines, tenants } from '../db/schema.js'
import type { TenantContext } from '../db/tenant.js'
import { HttpError } from '../errors.js'

async function insertPipeline(tx: Tx, ctx: TenantContext, name: string, position: number, locale: Locale) {
  const [pipeline] = await tx.insert(pipelines).values({ tenantId: ctx.tenantId, name, position }).returning()
  await tx.insert(pipelineStages).values(
    DEFAULT_STAGES[locale].map(([stageName, probability], i) => ({
      tenantId: ctx.tenantId,
      pipelineId: pipeline!.id,
      name: stageName,
      probability,
      position: i,
    })),
  )
  return pipeline!
}

// Every workspace has at least one pipeline. Created on first use, so workspaces from before
// deals existed need no backfill.
export async function ensureDefaultPipeline(tx: Tx, ctx: TenantContext, locale: Locale = 'sv') {
  const [first] = await tx.select().from(pipelines).orderBy(asc(pipelines.position)).limit(1)
  if (first) return first
  // Serialise concurrent first requests in the same workspace.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pipelines:${ctx.tenantId}`}))`)
  const [again] = await tx.select().from(pipelines).orderBy(asc(pipelines.position)).limit(1)
  return again ?? insertPipeline(tx, ctx, locale === 'en' ? 'Sales' : 'Försäljning', 0, locale)
}

export async function listPipelines(tx: Tx, ctx: TenantContext, locale: Locale): Promise<{ pipelines: Pipeline[]; staleDays: number }> {
  await ensureDefaultPipeline(tx, ctx, locale)
  const [rows, stages, openCounts, [tenant]] = await Promise.all([
    tx.select().from(pipelines).orderBy(asc(pipelines.position), asc(pipelines.createdAt)),
    tx.select().from(pipelineStages).orderBy(asc(pipelineStages.position)),
    tx
      .select({ pipelineId: deals.pipelineId, n: count() })
      .from(deals)
      .where(and(eq(deals.status, 'open'), isNull(deals.deletedAt)))
      .groupBy(deals.pipelineId),
    tx.select({ staleDays: tenants.staleDealDays }).from(tenants).where(eq(tenants.id, ctx.tenantId)),
  ])
  return {
    staleDays: tenant!.staleDays,
    pipelines: rows.map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      openDeals: openCounts.find((c) => c.pipelineId === p.id)?.n ?? 0,
      stages: stages
        .filter((s) => s.pipelineId === p.id)
        .map((s) => ({ id: s.id, name: s.name, position: s.position, probability: s.probability })),
    })),
  }
}

export async function createPipeline(tx: Tx, ctx: TenantContext, name: string, locale: Locale) {
  await ensureDefaultPipeline(tx, ctx, locale)
  const [{ max }] = (await tx.select({ max: sql<number>`coalesce(max(${pipelines.position}), -1)::int` }).from(pipelines)) as [
    { max: number },
  ]
  const pipeline = await insertPipeline(tx, ctx, name, max + 1, locale)
  await audit(tx, ctx, { action: 'create', entityType: 'pipeline', entityId: pipeline.id, after: { name } })
  return pipeline
}

async function getPipeline(tx: Tx, id: string) {
  const [p] = await tx.select().from(pipelines).where(eq(pipelines.id, id))
  if (!p) throw new HttpError(404, 'not_found', 'Pipeline not found')
  return p
}

export async function renamePipeline(tx: Tx, ctx: TenantContext, id: string, name: string) {
  const before = await getPipeline(tx, id)
  await tx.update(pipelines).set({ name, updatedAt: new Date() }).where(eq(pipelines.id, id))
  await audit(tx, ctx, { action: 'update', entityType: 'pipeline', entityId: id, before: { name: before.name }, after: { name } })
}

// Only empty pipelines can be deleted (deals in Trash count too), and never the last one.
export async function deletePipeline(tx: Tx, ctx: TenantContext, id: string) {
  const p = await getPipeline(tx, id)
  const [{ n: total }] = (await tx.select({ n: count() }).from(pipelines)) as [{ n: number }]
  if (total <= 1) throw new HttpError(409, 'last_pipeline', 'A workspace needs at least one pipeline')
  const [{ n: dealCount }] = (await tx.select({ n: count() }).from(deals).where(eq(deals.pipelineId, id))) as [{ n: number }]
  if (dealCount > 0) throw new HttpError(409, 'pipeline_has_deals', 'Move or delete the deals first', { count: dealCount })
  await tx.delete(pipelines).where(eq(pipelines.id, id))
  await audit(tx, ctx, { action: 'delete', entityType: 'pipeline', entityId: id, before: { name: p.name } })
}

// Replaces the stage list: order is the array order, new stages have no id, missing ones are removed.
export async function saveStages(tx: Tx, ctx: TenantContext, pipelineId: string, input: SaveStagesInput) {
  await getPipeline(tx, pipelineId)
  const existing = await tx.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, pipelineId))
  const keep = input.stages.filter((s) => s.id).map((s) => s.id!)
  const unknown = keep.filter((id) => !existing.some((e) => e.id === id))
  if (unknown.length) throw new HttpError(400, 'validation_error', 'Unknown stage', [{ message: 'invalid_stage' }])

  const removed = existing.filter((e) => !keep.includes(e.id))
  if (removed.length) {
    const blocked = await tx
      .select({ stageId: deals.stageId, n: count() })
      .from(deals)
      .where(inArray(deals.stageId, removed.map((r) => r.id)))
      .groupBy(deals.stageId)
    if (blocked.length) {
      const stage = removed.find((r) => r.id === blocked[0]!.stageId)!
      throw new HttpError(409, 'stage_has_deals', 'Move the deals out of the stage first', { stage: stage.name, count: blocked[0]!.n })
    }
    await tx.delete(pipelineStages).where(and(eq(pipelineStages.pipelineId, pipelineId), notInArray(pipelineStages.id, keep.length ? keep : ['00000000-0000-0000-0000-000000000000'])))
  }

  for (const [position, stage] of input.stages.entries()) {
    if (stage.id) {
      await tx
        .update(pipelineStages)
        .set({ name: stage.name, probability: stage.probability, position, updatedAt: new Date() })
        .where(eq(pipelineStages.id, stage.id))
    } else {
      await tx.insert(pipelineStages).values({ tenantId: ctx.tenantId, pipelineId, name: stage.name, probability: stage.probability, position })
    }
  }
  await audit(tx, ctx, {
    action: 'update',
    entityType: 'pipeline_stages',
    entityId: pipelineId,
    before: { stages: existing.sort((a, b) => a.position - b.position).map((s) => `${s.name} (${s.probability}%)`) },
    after: { stages: input.stages.map((s) => `${s.name} (${s.probability}%)`) },
  })
}

export async function setStaleDays(tx: Tx, ctx: TenantContext, staleDays: number) {
  await tx.update(tenants).set({ staleDealDays: staleDays, updatedAt: new Date() }).where(eq(tenants.id, ctx.tenantId))
  await audit(tx, ctx, { action: 'update', entityType: 'workspace', entityId: ctx.tenantId, after: { staleDealDays: staleDays } })
}
