import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  PICKLIST_KINDS,
  createDealSchema,
  createPipelineSchema,
  dealListQuerySchema,
  localeSchema,
  loseDealSchema,
  moveDealSchema,
  pipelineSettingsSchema,
  savePicklistSchema,
  saveStagesSchema,
  updateDealSchema,
  updatePipelineSchema,
} from '@crm/shared'
import { MANAGERS, WRITERS, inWorkspace, requireTenant } from '../auth/context.js'
import { withTenant } from '../db/tenant.js'
import {
  closeDeal,
  createDeal,
  deleteDeal,
  getBoard,
  getDeal,
  listDeals,
  moveDeal,
  reopenDeal,
  restoreDeal,
  updateDeal,
} from '../services/deals.js'
import { getPicklists, savePicklist } from '../services/picklists.js'
import { createPipeline, deletePipeline, listPipelines, renamePipeline, saveStages, setStaleDays } from '../services/pipelines.js'

const idParam = z.object({ id: z.uuid() })
// Default pipeline and stage names follow the language of whoever creates them.
const localeOf = (request: FastifyRequest) => localeSchema.catch('sv').parse(request.authSession?.user.locale)

export async function dealRoutes(app: FastifyInstance) {
  // ---- pipelines ----
  app.get('/pipelines', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    return withTenant(ctx, (tx) => listPipelines(tx, ctx, localeOf(request)))
  })

  app.post('/pipelines', { preHandler: inWorkspace(MANAGERS) }, async (request, reply) => {
    const ctx = requireTenant(request, MANAGERS)
    const { name } = createPipelineSchema.parse(request.body)
    const pipeline = await withTenant(ctx, (tx) => createPipeline(tx, ctx, name, localeOf(request)))
    return reply.status(201).send({ id: pipeline.id })
  })

  app.patch('/pipelines/:id', { preHandler: inWorkspace(MANAGERS) }, async (request) => {
    const ctx = requireTenant(request, MANAGERS)
    const { id } = idParam.parse(request.params)
    const { name } = updatePipelineSchema.parse(request.body)
    await withTenant(ctx, (tx) => renamePipeline(tx, ctx, id, name))
    return { ok: true }
  })

  app.delete('/pipelines/:id', { preHandler: inWorkspace(MANAGERS) }, async (request) => {
    const ctx = requireTenant(request, MANAGERS)
    const { id } = idParam.parse(request.params)
    await withTenant(ctx, (tx) => deletePipeline(tx, ctx, id))
    return { ok: true }
  })

  app.put('/pipelines/:id/stages', { preHandler: inWorkspace(MANAGERS) }, async (request) => {
    const ctx = requireTenant(request, MANAGERS)
    const { id } = idParam.parse(request.params)
    const input = saveStagesSchema.parse(request.body)
    await withTenant(ctx, (tx) => saveStages(tx, ctx, id, input))
    return { ok: true }
  })

  app.patch('/pipeline-settings', { preHandler: inWorkspace(MANAGERS) }, async (request) => {
    const ctx = requireTenant(request, MANAGERS)
    const { staleDays } = pipelineSettingsSchema.parse(request.body)
    await withTenant(ctx, (tx) => setStaleDays(tx, ctx, staleDays))
    return { ok: true }
  })

  // ---- picklists ----
  app.get('/picklists', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    return withTenant(ctx, (tx) => getPicklists(tx, ctx))
  })

  app.put('/picklists/:kind', { preHandler: inWorkspace(MANAGERS) }, async (request) => {
    const ctx = requireTenant(request, MANAGERS)
    const { kind } = z.object({ kind: z.enum(PICKLIST_KINDS) }).parse(request.params)
    const { items } = savePicklistSchema.parse(request.body)
    await withTenant(ctx, (tx) => savePicklist(tx, ctx, kind, items))
    return { ok: true }
  })

  // ---- deals ----
  app.get('/deals', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    const query = dealListQuerySchema.parse(request.query)
    return withTenant(ctx, (tx) => listDeals(tx, ctx, query))
  })

  app.get('/deals/board', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    const { pipelineId } = z.object({ pipelineId: z.uuid() }).parse(request.query)
    return withTenant(ctx, (tx) => getBoard(tx, ctx, pipelineId))
  })

  app.get('/deals/:id', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    const { id } = idParam.parse(request.params)
    return withTenant(ctx, (tx) => getDeal(tx, ctx, id))
  })

  app.post('/deals', { preHandler: inWorkspace(WRITERS) }, async (request, reply) => {
    const ctx = requireTenant(request, WRITERS)
    const input = createDealSchema.parse(request.body)
    return reply.status(201).send(await withTenant(ctx, (tx) => createDeal(tx, ctx, input)))
  })

  app.patch('/deals/:id', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    const input = updateDealSchema.parse(request.body)
    return withTenant(ctx, (tx) => updateDeal(tx, ctx, id, input))
  })

  app.post('/deals/:id/move', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    const { stageId, index } = moveDealSchema.parse(request.body)
    return withTenant(ctx, (tx) => moveDeal(tx, ctx, id, stageId, index))
  })

  app.post('/deals/:id/won', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    return withTenant(ctx, (tx) => closeDeal(tx, ctx, id, { status: 'won' }))
  })

  app.post('/deals/:id/lost', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    const { reason, note } = loseDealSchema.parse(request.body)
    return withTenant(ctx, (tx) => closeDeal(tx, ctx, id, { status: 'lost', reason, note }))
  })

  app.post('/deals/:id/reopen', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    return withTenant(ctx, (tx) => reopenDeal(tx, ctx, id))
  })

  app.delete('/deals/:id', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    await withTenant(ctx, (tx) => deleteDeal(tx, ctx, id))
    return { ok: true }
  })

  app.post('/deals/:id/restore', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    return withTenant(ctx, (tx) => restoreDeal(tx, ctx, id))
  })
}
