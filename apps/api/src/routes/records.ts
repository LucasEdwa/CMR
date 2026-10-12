import type { FastifyInstance } from 'fastify'
import { and, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import {
  SAVED_VIEW_OBJECTS,
  TRASH_RETENTION_DAYS,
  createSavedViewSchema,
  updateSavedViewSchema,
  type SavedView,
  type TrashItem,
} from '@crm/shared'
import { WRITERS, inWorkspace, requireTenant } from '../auth/context.js'
import { companies, contacts, deals, savedViews, users } from '../db/schema.js'
import { withTenant } from '../db/tenant.js'
import { HttpError } from '../errors.js'
import { listTags } from '../services/tags.js'

const idParam = z.object({ id: z.uuid() })
const DAY_MS = 24 * 60 * 60 * 1000

export async function recordRoutes(app: FastifyInstance) {
  app.get('/tags', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    return withTenant(ctx, (tx) => listTags(tx))
  })

  // ---- saved views ----
  app.get('/saved-views', { preHandler: inWorkspace() }, async (request): Promise<SavedView[]> => {
    const ctx = requireTenant(request)
    const { object } = z.object({ object: z.enum(SAVED_VIEW_OBJECTS) }).parse(request.query)
    const rows = await withTenant(ctx, (tx) =>
      tx
        .select({ view: savedViews, ownerName: users.name })
        .from(savedViews)
        .innerJoin(users, eq(users.id, savedViews.ownerUserId))
        .where(eq(savedViews.object, object))
        .orderBy(sql`lower(${savedViews.name})`),
    )
    return rows.map(({ view, ownerName }) => ({
      id: view.id,
      object: view.object,
      name: view.name,
      shared: view.shared,
      mine: view.ownerUserId === ctx.userId,
      ownerName,
      config: view.config as SavedView['config'],
    }))
  })

  app.post('/saved-views', { preHandler: inWorkspace() }, async (request, reply) => {
    const ctx = requireTenant(request)
    const input = createSavedViewSchema.parse(request.body)
    const [view] = await withTenant(ctx, (tx) =>
      tx
        .insert(savedViews)
        .values({ ...input, tenantId: ctx.tenantId, ownerUserId: ctx.userId })
        .returning({ id: savedViews.id }),
    )
    return reply.status(201).send(view)
  })

  app.patch('/saved-views/:id', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    const { id } = idParam.parse(request.params)
    const input = updateSavedViewSchema.parse(request.body)
    // RLS only lets the owner update; anyone else gets "not found".
    const [view] = await withTenant(ctx, (tx) =>
      tx
        .update(savedViews)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(savedViews.id, id))
        .returning({ id: savedViews.id }),
    )
    if (!view) throw new HttpError(404, 'not_found', 'View not found')
    return view
  })

  app.delete('/saved-views/:id', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    const { id } = idParam.parse(request.params)
    const [view] = await withTenant(ctx, (tx) =>
      tx.delete(savedViews).where(eq(savedViews.id, id)).returning({ id: savedViews.id }),
    )
    if (!view) throw new HttpError(404, 'not_found', 'View not found')
    return { ok: true }
  })

  // ---- trash ----
  app.get('/trash', { preHandler: inWorkspace(WRITERS) }, async (request): Promise<TrashItem[]> => {
    const ctx = requireTenant(request, WRITERS)
    const deleter = alias(users, 'deleter')
    const since = new Date(Date.now() - TRASH_RETENTION_DAYS * DAY_MS)
    const [deletedContacts, deletedCompanies, deletedDeals] = await withTenant(ctx, (tx) =>
      Promise.all([
        tx
          .select({
            id: contacts.id,
            name: sql<string>`trim(${contacts.firstName} || ' ' || ${contacts.lastName})`,
            deletedAt: contacts.deletedAt,
            deletedBy: deleter.name,
          })
          .from(contacts)
          .leftJoin(deleter, eq(deleter.id, contacts.deletedByUserId))
          .where(and(sql`${contacts.deletedAt} > ${since.toISOString()}::timestamptz`)),
        tx
          .select({ id: companies.id, name: companies.name, deletedAt: companies.deletedAt, deletedBy: deleter.name })
          .from(companies)
          .leftJoin(deleter, eq(deleter.id, companies.deletedByUserId))
          .where(sql`${companies.deletedAt} > ${since.toISOString()}::timestamptz`),
        tx
          .select({ id: deals.id, name: deals.name, deletedAt: deals.deletedAt, deletedBy: deleter.name })
          .from(deals)
          .leftJoin(deleter, eq(deleter.id, deals.deletedByUserId))
          .where(sql`${deals.deletedAt} > ${since.toISOString()}::timestamptz`),
      ]),
    )
    const item = (type: TrashItem['type']) => (r: { id: string; name: string; deletedAt: Date | null; deletedBy: string | null }) => ({
      type,
      id: r.id,
      name: r.name,
      deletedAt: r.deletedAt!.toISOString(),
      deletedBy: r.deletedBy,
      purgeAt: new Date(r.deletedAt!.getTime() + TRASH_RETENTION_DAYS * DAY_MS).toISOString(),
    })
    return [...deletedContacts.map(item('contact')), ...deletedCompanies.map(item('company')), ...deletedDeals.map(item('deal'))].sort((a, b) =>
      b.deletedAt.localeCompare(a.deletedAt),
    )
  })
}

