import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { companyListQuerySchema, createCompanySchema, updateCompanySchema } from '@crm/shared'
import { WRITERS, inWorkspace, requireTenant } from '../auth/context.js'
import { withTenant } from '../db/tenant.js'
import {
  createCompany,
  deleteCompany,
  getCompany,
  listCompanies,
  restoreCompany,
  suggestCompanyForEmail,
  updateCompany,
} from '../services/companies.js'

const idParam = z.object({ id: z.uuid() })

export async function companyRoutes(app: FastifyInstance) {
  app.get('/companies', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    const query = companyListQuerySchema.parse(request.query)
    return withTenant(ctx, (tx) => listCompanies(tx, ctx, query))
  })

  // Registered before /companies/:id so "suggest" is not taken for an id.
  app.get('/companies/suggest', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    const { email } = z.object({ email: z.string().max(320) }).parse(request.query)
    return { company: await withTenant(ctx, (tx) => suggestCompanyForEmail(tx, email)) }
  })

  app.get('/companies/:id', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    const { id } = idParam.parse(request.params)
    return withTenant(ctx, (tx) => getCompany(tx, id))
  })

  app.post('/companies', { preHandler: inWorkspace(WRITERS) }, async (request, reply) => {
    const ctx = requireTenant(request, WRITERS)
    const input = createCompanySchema.parse(request.body)
    return reply.status(201).send(await withTenant(ctx, (tx) => createCompany(tx, ctx, input)))
  })

  app.patch('/companies/:id', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    const input = updateCompanySchema.parse(request.body)
    return withTenant(ctx, (tx) => updateCompany(tx, ctx, id, input))
  })

  app.delete('/companies/:id', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    await withTenant(ctx, (tx) => deleteCompany(tx, ctx, id))
    return { ok: true }
  })

  app.post('/companies/:id/restore', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    return withTenant(ctx, (tx) => restoreCompany(tx, ctx, id))
  })
}
