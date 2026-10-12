import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { contactListQuerySchema, createContactSchema, updateContactSchema } from '@crm/shared'
import { WRITERS, inWorkspace, requireTenant } from '../auth/context.js'
import { withTenant } from '../db/tenant.js'
import {
  createContact,
  deleteContact,
  getContact,
  listContacts,
  restoreContact,
  updateContact,
} from '../services/contacts.js'

const idParam = z.object({ id: z.uuid() })

export async function contactRoutes(app: FastifyInstance) {
  app.get('/contacts', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    const query = contactListQuerySchema.parse(request.query)
    return withTenant(ctx, (tx) => listContacts(tx, ctx, query))
  })

  app.get('/contacts/:id', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    const { id } = idParam.parse(request.params)
    return withTenant(ctx, (tx) => getContact(tx, id))
  })

  app.post('/contacts', { preHandler: inWorkspace(WRITERS) }, async (request, reply) => {
    const ctx = requireTenant(request, WRITERS)
    const input = createContactSchema.parse(request.body)
    return reply.status(201).send(await withTenant(ctx, (tx) => createContact(tx, ctx, input)))
  })

  app.patch('/contacts/:id', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    const input = updateContactSchema.parse(request.body)
    return withTenant(ctx, (tx) => updateContact(tx, ctx, id, input))
  })

  app.delete('/contacts/:id', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    await withTenant(ctx, (tx) => deleteContact(tx, ctx, id))
    return { ok: true }
  })

  app.post('/contacts/:id/restore', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    return withTenant(ctx, (tx) => restoreContact(tx, ctx, id))
  })
}
