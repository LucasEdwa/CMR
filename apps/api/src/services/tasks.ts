import { and, asc, desc, eq, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { PgBoss } from 'pg-boss'
import type { z } from 'zod'
import {
  REMINDER_HOUR,
  type Locale,
  type MyTasks,
  type RecordType,
  type Task,
  type createTaskSchema,
  type updateTaskSchema,
} from '@crm/shared'
import { audit } from '../db/audit.js'
import type { Tx } from '../db/client.js'
import { companies, contacts, deals, tasks, tenants, users } from '../db/schema.js'
import type { TenantContext } from '../db/tenant.js'
import { sendEmail } from '../email/send.js'
import { emails } from '../email/templates.js'
import { env } from '../env.js'
import { HttpError } from '../errors.js'
import { QUEUES, type TenantJob } from '../jobs/queues.js'
import { assertMember } from './common.js'
import { notify } from './notifications.js'
import { recordColumns, requireRecord, type NamedRecord } from './records.js'

type TaskRow = typeof tasks.$inferSelect
export type ReminderJob = TenantJob<{ taskId: string; dueDate: string }>

const DONE_SHOWN = 20

let boss: PgBoss | null = null
export function useReminderQueue(instance: PgBoss) {
  boss = instance
}

// A user's own timezone, or the workspace's when they have not set one.
export async function timezoneOf(tx: Tx, ctx: TenantContext, userId: string | null) {
  const [row] = await tx
    .select({ tz: sql<string>`coalesce(${users.timezone}, ${tenants.timezone})` })
    .from(tenants)
    .leftJoin(users, userId ? eq(users.id, userId) : sql`false`)
    .where(eq(tenants.id, ctx.tenantId))
  return row?.tz ?? 'Europe/Stockholm'
}

// The moment a task becomes overdue: its time on the due date, or the following midnight,
// in the assignee's timezone. Postgres does the timezone arithmetic (DST included).
async function computeDueAt(tx: Tx, dueDate: string, dueTime: string | null, tz: string) {
  const local = dueTime ? sql`${dueDate}::date + ${dueTime}::time` : sql`${dueDate}::date + 1`
  const [row] = await tx.execute<{ at: string }>(sql`select ((${local})::timestamp at time zone ${tz})::text as at`)
  return new Date(row!.at)
}

// After a timezone change: recompute when open tasks become overdue. Pass a user to limit it
// to their tasks; without one, it covers assignees who follow the workspace timezone.
export async function retimeOpenTasks(tx: Tx, userId?: string) {
  await tx.execute(sql`
    update ${tasks} t
    set due_at = (case when t.due_time is null then (t.due_date + 1)::timestamp else t.due_date + t.due_time end)
      at time zone coalesce(u.timezone, tn.timezone)
    from ${tenants} tn, ${users} u
    where tn.id = t.tenant_id and u.id = t.assignee_user_id and t.completed_at is null
      and ${userId ? sql`u.id = ${userId}` : sql`u.timezone is null`}`)
}

// ---- reads ---------------------------------------------------------------------

const assignee = alias(users, 'assignee')
const creator = alias(users, 'creator')
const completer = alias(users, 'completer')

const baseQuery = (tx: Tx) =>
  tx
    .select({
      t: tasks,
      assigneeName: assignee.name,
      creatorName: creator.name,
      completerName: completer.name,
      contactName: sql<string | null>`trim(${contacts.firstName} || ' ' || ${contacts.lastName})`,
      companyName: companies.name,
      dealName: deals.name,
    })
    .from(tasks)
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeUserId))
    .leftJoin(creator, eq(creator.id, tasks.createdByUserId))
    .leftJoin(completer, eq(completer.id, tasks.completedByUserId))
    .leftJoin(contacts, and(eq(contacts.id, tasks.contactId), eq(contacts.tenantId, tasks.tenantId)))
    .leftJoin(companies, and(eq(companies.id, tasks.companyId), eq(companies.tenantId, tasks.tenantId)))
    .leftJoin(deals, and(eq(deals.id, tasks.dealId), eq(deals.tenantId, tasks.tenantId)))

type Row = Awaited<ReturnType<ReturnType<typeof baseQuery>['execute']>>[number]

// Tasks about a record in Trash are hidden until the record is restored.
const recordLive: SQL = and(
  or(isNull(tasks.contactId), isNull(contacts.deletedAt)),
  or(isNull(tasks.companyId), isNull(companies.deletedAt)),
  or(isNull(tasks.dealId), isNull(deals.deletedAt)),
)!

function recordOf(r: Row): NamedRecord | null {
  const t = r.t
  const pick = (type: RecordType, id: string | null, name: string | null) => (id && name ? { type, id, name } : null)
  return pick('contact', t.contactId, r.contactName) ?? pick('company', t.companyId, r.companyName) ?? pick('deal', t.dealId, r.dealName)
}

function toTask(r: Row, now = Date.now()): Task {
  const t = r.t
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    dueDate: t.dueDate,
    dueTime: t.dueTime?.slice(0, 5) ?? null,
    dueAt: t.dueAt.toISOString(),
    overdue: !t.completedAt && t.dueAt.getTime() < now,
    priority: t.priority,
    assignee: t.assigneeUserId && r.assigneeName ? { id: t.assigneeUserId, name: r.assigneeName } : null,
    record: recordOf(r),
    completedAt: t.completedAt?.toISOString() ?? null,
    completedBy: r.completerName,
    createdBy: r.creatorName,
    createdAt: t.createdAt.toISOString(),
  }
}

// Open tasks grouped by the assignee's own "today", plus the latest completed ones.
export async function myTasks(tx: Tx, ctx: TenantContext, assigneeId: string): Promise<MyTasks> {
  const tz = await timezoneOf(tx, ctx, assigneeId)
  const [row] = await tx.execute<{ today: string }>(sql`select (now() at time zone ${tz})::date::text as today`)
  const today = row!.today
  const mine = and(eq(tasks.assigneeUserId, assigneeId), recordLive)
  const [open, done] = await Promise.all([
    baseQuery(tx)
      .where(and(mine, isNull(tasks.completedAt)))
      .orderBy(asc(tasks.dueAt), asc(tasks.createdAt)),
    baseQuery(tx)
      .where(and(mine, isNotNull(tasks.completedAt)))
      .orderBy(desc(tasks.completedAt))
      .limit(DONE_SHOWN),
  ])
  const now = Date.now()
  const all = open.map((r) => toTask(r, now))
  return {
    overdue: all.filter((t) => t.overdue),
    today: all.filter((t) => !t.overdue && t.dueDate <= today),
    upcoming: all.filter((t) => !t.overdue && t.dueDate > today),
    done: done.map((r) => toTask(r, now)),
  }
}

const recordColumn = { contact: tasks.contactId, company: tasks.companyId, deal: tasks.dealId }

// Tasks on one record: open ones by due date, then the latest completed ones.
export async function recordTasks(tx: Tx, type: RecordType, id: string) {
  const on = eq(recordColumn[type], id)
  const [open, done] = await Promise.all([
    baseQuery(tx)
      .where(and(on, isNull(tasks.completedAt)))
      .orderBy(asc(tasks.dueAt)),
    baseQuery(tx)
      .where(and(on, isNotNull(tasks.completedAt)))
      .orderBy(desc(tasks.completedAt))
      .limit(DONE_SHOWN),
  ])
  const now = Date.now()
  return { open: open.map((r) => toTask(r, now)), done: done.map((r) => toTask(r, now)) }
}

async function getTask(tx: Tx, id: string) {
  const [row] = await baseQuery(tx).where(eq(tasks.id, id))
  if (!row) throw new HttpError(404, 'not_found', 'Task not found')
  return toTask(row)
}

// Next open task per deal, for board cards.
export async function nextTasksForDeals(tx: Tx, dealIds: string[]) {
  const map = new Map<string, { dueDate: string; dueTime: string | null; overdue: boolean }>()
  if (!dealIds.length) return map
  const rows = await tx
    .selectDistinctOn([tasks.dealId], { dealId: tasks.dealId, dueDate: tasks.dueDate, dueTime: tasks.dueTime, dueAt: tasks.dueAt })
    .from(tasks)
    .where(and(sql`${tasks.dealId} in ${dealIds}`, isNull(tasks.completedAt)))
    .orderBy(tasks.dealId, asc(tasks.dueAt))
  const now = Date.now()
  for (const r of rows) {
    map.set(r.dealId!, { dueDate: r.dueDate, dueTime: r.dueTime?.slice(0, 5) ?? null, overdue: r.dueAt.getTime() < now })
  }
  return map
}

// ---- reminders -------------------------------------------------------------------

// One job per task and due date, at REMINDER_HOUR on the due date in the assignee's timezone.
// If that hour has passed but the task is not overdue yet (e.g. created at noon for today),
// the reminder goes out right away. The job re-checks everything before sending.
async function scheduleReminder(tx: Tx, ctx: TenantContext, task: TaskRow) {
  if (!boss || task.completedAt || !task.assigneeUserId) return
  const now = Date.now()
  if (task.dueAt.getTime() <= now || task.reminderSentFor === task.dueDate) return
  const tz = await timezoneOf(tx, ctx, task.assigneeUserId)
  const [row] = await tx.execute<{ at: string }>(
    sql`select ((${task.dueDate}::date + make_time(${REMINDER_HOUR}, 0, 0))::timestamp at time zone ${tz})::text as at`,
  )
  const at = new Date(row!.at)
  const data: ReminderJob = { tenantId: ctx.tenantId, userId: task.assigneeUserId, taskId: task.id, dueDate: task.dueDate }
  // A reminder that cannot be queued must not stop the task from being saved.
  try {
    await boss.send(QUEUES.taskReminder, data, at.getTime() > now ? { startAfter: at } : {})
  } catch (err) {
    console.error('[tasks] could not schedule reminder', task.id, err)
  }
}

// Runs in the worker as the assignee. Sends at most one reminder per task and due date.
export async function sendTaskReminder(tx: Tx, job: ReminderJob) {
  const ctx: TenantContext = { tenantId: job.tenantId, userId: job.userId, role: 'system' }
  const [row] = await baseQuery(tx).where(
    and(
      eq(tasks.id, job.taskId),
      eq(tasks.assigneeUserId, job.userId),
      eq(tasks.dueDate, job.dueDate),
      isNull(tasks.completedAt),
      sql`${tasks.reminderSentFor} is distinct from ${tasks.dueDate}`,
      recordLive,
    ),
  )
  if (!row) return false
  const [claimed] = await tx
    .update(tasks)
    .set({ reminderSentFor: job.dueDate })
    .where(and(eq(tasks.id, job.taskId), sql`${tasks.reminderSentFor} is distinct from ${tasks.dueDate}`))
    .returning({ id: tasks.id })
  if (!claimed) return false

  const task = toTask(row)
  await notify(tx, ctx, [job.userId], 'task_reminder', { title: task.title, record: task.record, taskId: task.id }, { includeSelf: true })
  const [user] = await tx.select({ email: users.email, name: users.name, locale: users.locale }).from(users).where(eq(users.id, job.userId))
  if (user) {
    const locale: Locale = user.locale === 'en' ? 'en' : 'sv'
    await sendEmail(
      emails.taskReminder(user.email, locale, {
        name: user.name,
        title: task.title,
        time: task.dueTime,
        record: task.record?.name ?? null,
        url: `${env.WEB_ORIGIN}/tasks`,
      }),
    )
  }
  return true
}

// ---- writes ----------------------------------------------------------------------

const auditable = (t: TaskRow) => ({ ...t, dueAt: undefined, reminderSentFor: undefined })

async function notifyAssignee(tx: Tx, ctx: TenantContext, task: Task) {
  if (task.assignee) await notify(tx, ctx, [task.assignee.id], 'task_assigned', { title: task.title, record: task.record, taskId: task.id })
}

export async function createTask(tx: Tx, ctx: TenantContext, input: z.output<typeof createTaskSchema>) {
  const { record, assigneeUserId = ctx.userId, dueTime = null, ...fields } = input
  await assertMember(tx, assigneeUserId)
  if (record) await requireRecord(tx, record)
  const tz = await timezoneOf(tx, ctx, assigneeUserId)
  const [row] = await tx
    .insert(tasks)
    .values({
      ...fields,
      tenantId: ctx.tenantId,
      dueTime,
      dueAt: await computeDueAt(tx, fields.dueDate, dueTime, tz),
      assigneeUserId,
      ...recordColumns(record),
      createdByUserId: ctx.userId,
    })
    .returning()
  await audit(tx, ctx, { action: 'create', entityType: 'task', entityId: row!.id, after: auditable(row!) })
  const task = await getTask(tx, row!.id)
  await notifyAssignee(tx, ctx, task)
  await scheduleReminder(tx, ctx, row!)
  return task
}

export async function updateTask(tx: Tx, ctx: TenantContext, id: string, input: z.output<typeof updateTaskSchema>) {
  const [before] = await tx.select().from(tasks).where(eq(tasks.id, id))
  if (!before) throw new HttpError(404, 'not_found', 'Task not found')
  const { record, completed, ...fields } = input
  if (fields.assigneeUserId) await assertMember(tx, fields.assigneeUserId)
  if (record) await requireRecord(tx, record)

  const now = new Date()
  const next: Partial<TaskRow> = { ...fields, updatedAt: now }
  if (record !== undefined) Object.assign(next, recordColumns(record))
  if (completed !== undefined && completed !== !!before.completedAt) {
    next.completedAt = completed ? now : null
    next.completedByUserId = completed ? ctx.userId : null
  }
  const assigneeId = fields.assigneeUserId ?? before.assigneeUserId
  const timing = fields.dueDate !== undefined || fields.dueTime !== undefined || fields.assigneeUserId !== undefined
  if (timing) {
    const dueTime = fields.dueTime !== undefined ? fields.dueTime : before.dueTime
    next.dueAt = await computeDueAt(tx, fields.dueDate ?? before.dueDate, dueTime, await timezoneOf(tx, ctx, assigneeId))
  }
  const [after] = await tx.update(tasks).set(next).where(eq(tasks.id, id)).returning()
  await audit(tx, ctx, {
    action: next.completedAt ? 'complete' : completed === false && before.completedAt ? 'reopen' : 'update',
    entityType: 'task',
    entityId: id,
    before: auditable(before),
    after: auditable(after!),
  })

  // Completing a deal's task counts as activity on the deal.
  if (next.completedAt && after!.dealId) await tx.update(deals).set({ lastActivityAt: now }).where(eq(deals.id, after!.dealId))

  const task = await getTask(tx, id)
  if (fields.assigneeUserId && fields.assigneeUserId !== before.assigneeUserId) await notifyAssignee(tx, ctx, task)
  if (timing || completed === false) await scheduleReminder(tx, ctx, after!)
  return task
}

export async function deleteTask(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx.delete(tasks).where(eq(tasks.id, id)).returning()
  if (!row) throw new HttpError(404, 'not_found', 'Task not found')
  await audit(tx, ctx, { action: 'delete', entityType: 'task', entityId: id, before: auditable(row) })
}
