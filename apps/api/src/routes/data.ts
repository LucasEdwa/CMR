import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  MAX_IMPORT_BYTES,
  bulkCompaniesSchema,
  bulkContactsSchema,
  bulkDealsSchema,
  companyListQuerySchema,
  contactListQuerySchema,
  createImportSchema,
  dealListQuerySchema,
  auditQuerySchema,
  dashboardQuerySchema,
  mergeContactsSchema,
  recordRefSchema,
} from '@crm/shared'
import { MANAGERS, WRITERS, inWorkspace, requireTenant } from '../auth/context.js'
import type { Tx } from '../db/client.js'
import { audit } from '../db/audit.js'
import { withTenant, type TenantContext } from '../db/tenant.js'
import { limit } from '../http/limits.js'
import { listAudit } from '../services/auditLog.js'
import { bulkCompanies, bulkContacts, bulkDeals } from '../services/bulk.js'
import { getDashboard } from '../services/dashboard.js'
import { listCompanies } from '../services/companies.js'
import { listContacts } from '../services/contacts.js'
import { listDeals } from '../services/deals.js'
import { findDuplicates, mergeContacts } from '../services/duplicates.js'
import { createImport, getImport, listImports, startImport, undoImport } from '../services/imports.js'
import { recentRecords, recordView, search } from '../services/search.js'

const idParam = z.object({ id: z.uuid() })
const EXPORT_MAX = 50_000
const EXPORT_PAGE = 5_000

// One audit row per export: who, what, with which filters, how many rows.
async function audited<T extends { items: unknown[]; total: number }>(tx: Tx, ctx: TenantContext, object: string, query: object, result: T) {
  await audit(tx, ctx, { action: 'export', entityType: object, after: { filters: query, rows: result.items.length } })
  return result
}

// All records matching a list's filters (in its sort order), fetched page by page.
async function exportAll<T>(list: (page: number, pageSize: number) => Promise<{ items: T[]; total: number }>) {
  const items: T[] = []
  let total = 0
  for (let page = 1; items.length < EXPORT_MAX; page++) {
    const res = await list(page, EXPORT_PAGE)
    total = res.total
    items.push(...res.items)
    if (res.items.length < EXPORT_PAGE) break
  }
  return { items, total, truncated: total > items.length }
}

export async function dataRoutes(app: FastifyInstance) {
  // ---- dashboard (every role; RLS limits it to what the caller may see) ----
  app.get('/dashboard', { preHandler: inWorkspace(), config: limit('dashboard', 60, '1 minute') }, async (request) => {
    const ctx = requireTenant(request)
    const query = dashboardQuerySchema.parse(request.query)
    return withTenant(ctx, (tx) => getDashboard(tx, ctx, query))
  })

  // ---- audit log (owners and admins) ----
  app.get('/audit', { preHandler: inWorkspace(MANAGERS), config: limit('audit', 60, '1 minute') }, async (request) => {
    const ctx = requireTenant(request, MANAGERS)
    const query = auditQuerySchema.parse(request.query)
    return withTenant(ctx, (tx) => listAudit(tx, ctx, query))
  })

  // ---- import ----
  app.post(
    '/imports',
    // The CSV travels as JSON text; allow for escaping on top of the file size limit.
    { preHandler: inWorkspace(WRITERS), bodyLimit: Math.ceil(MAX_IMPORT_BYTES * 1.5), config: limit('import', 20, '1 hour', 'workspace') },
    async (request, reply) => {
      const ctx = requireTenant(request, WRITERS)
      const input = createImportSchema.parse(request.body)
      const row = await withTenant(ctx, (tx) => createImport(tx, ctx, input))
      await startImport(ctx, row.id)
      return reply.status(202).send({ id: row.id })
    },
  )

  app.get('/imports', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    return withTenant(ctx, (tx) => listImports(tx))
  })

  app.get('/imports/:id', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    return withTenant(ctx, (tx) => getImport(tx, id))
  })

  app.post('/imports/:id/undo', { preHandler: inWorkspace(WRITERS), config: limit('undo-import', 20, '1 hour', 'workspace') }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    return withTenant(ctx, (tx) => undoImport(tx, ctx, id))
  })

  // ---- export: the list's own filters, every page (viewers included) ----
  // Exports are how data leaves a workspace: limited per person, and every one is in the audit log.
  const exportLimit = { preHandler: inWorkspace(), config: limit('export', 20, '10 minutes') }

  app.get('/contacts/export', exportLimit, async (request) => {
    const ctx = requireTenant(request)
    const q = contactListQuerySchema.parse(request.query)
    return withTenant(ctx, async (tx: Tx) =>
      audited(tx, ctx, 'contacts', q, await exportAll((page, pageSize) => listContacts(tx, ctx, { ...q, page, pageSize }))),
    )
  })

  app.get('/companies/export', exportLimit, async (request) => {
    const ctx = requireTenant(request)
    const q = companyListQuerySchema.parse(request.query)
    return withTenant(ctx, async (tx: Tx) =>
      audited(tx, ctx, 'companies', q, await exportAll((page, pageSize) => listCompanies(tx, ctx, { ...q, page, pageSize }))),
    )
  })

  app.get('/deals/export', exportLimit, async (request) => {
    const ctx = requireTenant(request)
    const q = dealListQuerySchema.parse(request.query)
    return withTenant(ctx, async (tx: Tx) =>
      audited(tx, ctx, 'deals', q, await exportAll((page, pageSize) => listDeals(tx, ctx, { ...q, page, pageSize }))),
    )
  })

  // ---- search and recently viewed ----
  app.get('/search', { preHandler: inWorkspace(), config: limit('search', 120, '1 minute') }, async (request) => {
    const ctx = requireTenant(request)
    const { q } = z.object({ q: z.string().trim().min(1).max(100) }).parse(request.query)
    return { hits: await withTenant(ctx, (tx) => search(tx, q)) }
  })

  app.get('/recent', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    return { hits: await withTenant(ctx, (tx) => recentRecords(tx, ctx)) }
  })

  app.post('/recent', { preHandler: inWorkspace(), config: limit('recent', 300, '1 minute') }, async (request) => {
    const ctx = requireTenant(request)
    const ref = recordRefSchema.parse(request.body)
    await withTenant(ctx, (tx) => recordView(tx, ctx, ref))
    return { ok: true }
  })

  // ---- bulk ----
  app.post('/contacts/bulk', { preHandler: inWorkspace(WRITERS), config: limit('bulk', 30, '1 minute') }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const input = bulkContactsSchema.parse(request.body)
    return withTenant(ctx, (tx) => bulkContacts(tx, ctx, input))
  })

  app.post('/companies/bulk', { preHandler: inWorkspace(WRITERS), config: limit('bulk', 30, '1 minute') }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const input = bulkCompaniesSchema.parse(request.body)
    return withTenant(ctx, (tx) => bulkCompanies(tx, ctx, input))
  })

  app.post('/deals/bulk', { preHandler: inWorkspace(WRITERS), config: limit('bulk', 30, '1 minute') }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const input = bulkDealsSchema.parse(request.body)
    return withTenant(ctx, (tx) => bulkDeals(tx, ctx, input))
  })

  // ---- duplicates ----
  app.get('/contacts/duplicates', { preHandler: inWorkspace(WRITERS), config: limit('duplicates', 30, '1 minute') }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    return { groups: await withTenant(ctx, (tx) => findDuplicates(tx)) }
  })

  app.post('/contacts/merge', { preHandler: inWorkspace(WRITERS), config: limit('merge', 60, '1 minute') }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const input = mergeContactsSchema.parse(request.body)
    return withTenant(ctx, (tx) => mergeContacts(tx, ctx, input))
  })
}
