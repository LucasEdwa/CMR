import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  createActivitySchema,
  createTaskSchema,
  myTasksQuerySchema,
  recordTasksQuerySchema,
  timelineQuerySchema,
  updateActivitySchema,
  updateTaskSchema,
} from '@crm/shared'
import { WRITERS, inWorkspace, requireTenant } from '../auth/context.js'
import { withTenant } from '../db/tenant.js'
import { createActivity, deleteActivity, getTimeline, updateActivity } from '../services/activities.js'
import { listNotifications, markAllRead, markRead } from '../services/notifications.js'
import { createTask, deleteTask, myTasks, recordTasks, updateTask } from '../services/tasks.js'

const idParam = z.object({ id: z.uuid() })

export async function activityRoutes(app: FastifyInstance) {
  // ---- activities ----
  app.get('/timeline', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    const query = timelineQuerySchema.parse(request.query)
    return withTenant(ctx, (tx) => getTimeline(tx, ctx, query))
  })

  app.post('/activities', { preHandler: inWorkspace(WRITERS) }, async (request, reply) => {
    const ctx = requireTenant(request, WRITERS)
    const input = createActivitySchema.parse(request.body)
    return reply.status(201).send(await withTenant(ctx, (tx) => createActivity(tx, ctx, input)))
  })

  // Author or owner/admin only (checked in the service).
  app.patch('/activities/:id', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    const input = updateActivitySchema.parse(request.body)
    return withTenant(ctx, (tx) => updateActivity(tx, ctx, id, input))
  })

  app.delete('/activities/:id', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    await withTenant(ctx, (tx) => deleteActivity(tx, ctx, id))
    return { ok: true }
  })

  // ---- tasks ----
  app.get('/tasks/my', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    const { assignee } = myTasksQuerySchema.parse(request.query)
    return withTenant(ctx, (tx) => myTasks(tx, ctx, assignee === 'me' ? ctx.userId : assignee))
  })

  app.get('/tasks', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    const { type, id } = recordTasksQuerySchema.parse(request.query)
    return withTenant(ctx, (tx) => recordTasks(tx, type, id))
  })

  app.post('/tasks', { preHandler: inWorkspace(WRITERS) }, async (request, reply) => {
    const ctx = requireTenant(request, WRITERS)
    const input = createTaskSchema.parse(request.body)
    return reply.status(201).send(await withTenant(ctx, (tx) => createTask(tx, ctx, input)))
  })

  app.patch('/tasks/:id', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    const input = updateTaskSchema.parse(request.body)
    return withTenant(ctx, (tx) => updateTask(tx, ctx, id, input))
  })

  app.delete('/tasks/:id', { preHandler: inWorkspace(WRITERS) }, async (request) => {
    const ctx = requireTenant(request, WRITERS)
    const { id } = idParam.parse(request.params)
    await withTenant(ctx, (tx) => deleteTask(tx, ctx, id))
    return { ok: true }
  })

  // ---- notifications (every role, own notifications only) ----
  app.get('/notifications', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    return withTenant(ctx, (tx) => listNotifications(tx, ctx))
  })

  app.post('/notifications/read-all', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    await withTenant(ctx, (tx) => markAllRead(tx, ctx))
    return { ok: true }
  })

  app.post('/notifications/:id/read', { preHandler: inWorkspace() }, async (request) => {
    const ctx = requireTenant(request)
    const { id } = idParam.parse(request.params)
    await withTenant(ctx, (tx) => markRead(tx, ctx, id))
    return { ok: true }
  })
}
