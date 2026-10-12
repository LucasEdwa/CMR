import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type { Dashboard, DashboardPeriod, dashboardQuerySchema } from '@crm/shared'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { Tx } from '../db/client.js'
import { activities, companies, contacts, deals, memberships, pipelineStages, pipelines, tasks, tenants, users } from '../db/schema.js'
import type { TenantContext } from '../db/tenant.js'
import { HttpError } from '../errors.js'
import { ensureDefaultPipeline } from './pipelines.js'

// Period start (inclusive) and end (exclusive) as local dates in the workspace timezone.
const PERIOD_SQL: Record<DashboardPeriod, SQL> = {
  this_month: sql`date_trunc('month', l.today), date_trunc('month', l.today) + interval '1 month'`,
  last_month: sql`date_trunc('month', l.today) - interval '1 month', date_trunc('month', l.today)`,
  this_quarter: sql`date_trunc('quarter', l.today), date_trunc('quarter', l.today) + interval '3 months'`,
  this_year: sql`date_trunc('year', l.today), date_trunc('year', l.today) + interval '1 year'`,
  last_30_days: sql`l.today - interval '29 days', l.today + interval '1 day'`,
}

const OVERDUE_SHOWN = 8

// One query per tile, every one of them under the caller's RLS (so "own records only" applies too).
export async function getDashboard(tx: Tx, ctx: TenantContext, q: z.output<typeof dashboardQuerySchema>): Promise<Dashboard> {
  const [tenant] = await tx.select({ tz: tenants.timezone, currency: tenants.currency }).from(tenants).where(eq(tenants.id, ctx.tenantId))
  const tz = tenant!.tz
  const currency = tenant!.currency as Dashboard['currency']
  const ownerId = q.owner === 'me' ? ctx.userId : q.owner

  const [range] = await tx.execute<{ from: string; to: string; start: string; end: string }>(sql`
    with l as (select (now() at time zone ${tz})::date::timestamp as today),
    p(a, b) as (select ${PERIOD_SQL[q.period]} from l)
    select a::date::text as "from", b::date::text as "to",
      (a at time zone ${tz})::text as start, (b at time zone ${tz})::text as "end" from p`)
  const start = new Date(range!.start)
  const end = new Date(range!.end)
  const inPeriod = (column: PgColumn) => sql`${column} >= ${start.toISOString()}::timestamptz and ${column} < ${end.toISOString()}::timestamptz`

  // ---- pipeline (open deals now, not tied to the period) ----
  const pipeline = q.pipelineId
    ? (await tx.select().from(pipelines).where(eq(pipelines.id, q.pipelineId)))[0]
    : await ensureDefaultPipeline(tx, ctx)
  if (!pipeline) throw new HttpError(404, 'not_found', 'Pipeline not found')
  const dealOwner = ownerId ? eq(deals.ownerUserId, ownerId) : undefined
  const stageRows = await tx
    .select({
      id: pipelineStages.id,
      name: pipelineStages.name,
      probability: pipelineStages.probability,
      count: sql<number>`count(${deals.id}) filter (where ${deals.currency} = ${currency})::int`,
      other: sql<number>`count(${deals.id}) filter (where ${deals.currency} <> ${currency})::int`,
      value: sql<number>`coalesce(sum(${deals.value}) filter (where ${deals.currency} = ${currency}), 0)::bigint`,
    })
    .from(pipelineStages)
    .leftJoin(
      deals,
      and(eq(deals.stageId, pipelineStages.id), eq(deals.tenantId, pipelineStages.tenantId), eq(deals.status, 'open'), isNull(deals.deletedAt), dealOwner),
    )
    .where(eq(pipelineStages.pipelineId, pipeline.id))
    .groupBy(pipelineStages.id)
    .orderBy(asc(pipelineStages.position))
  const stages = stageRows.map((s) => {
    const value = Number(s.value)
    return { id: s.id, name: s.name, probability: s.probability, count: s.count, value, weighted: Math.round((value * s.probability) / 100) }
  })

  // ---- closed in the period ----
  const closedOwner = dealOwner ? [dealOwner] : []
  const closed = await tx
    .select({
      status: deals.status,
      count: sql<number>`count(*)::int`,
      value: sql<number>`coalesce(sum(${deals.value}) filter (where ${deals.currency} = ${currency}), 0)::bigint`,
    })
    .from(deals)
    .where(and(isNull(deals.deletedAt), sql`${deals.status} in ('won', 'lost')`, inPeriod(deals.closedAt), ...closedOwner))
    .groupBy(deals.status)
  const won = closed.find((c) => c.status === 'won')
  const lost = closed.find((c) => c.status === 'lost')
  const wonCount = won?.count ?? 0
  const lostCount = lost?.count ?? 0

  const [created] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(deals)
    .where(and(isNull(deals.deletedAt), inPeriod(deals.createdAt), ...closedOwner))

  const lostReasons = await tx
    .select({ reason: deals.lostReason, count: sql<number>`count(*)::int` })
    .from(deals)
    .where(and(isNull(deals.deletedAt), eq(deals.status, 'lost'), inPeriod(deals.closedAt), ...closedOwner))
    .groupBy(deals.lostReason)
    .orderBy(sql`count(*) desc`)

  // ---- activities per user in the period (every member listed, also with zero) ----
  const perUser = await tx
    .select({
      id: users.id,
      name: users.name,
      note: sql<number>`count(${activities.id}) filter (where ${activities.type} = 'note')::int`,
      call: sql<number>`count(${activities.id}) filter (where ${activities.type} = 'call')::int`,
      meeting: sql<number>`count(${activities.id}) filter (where ${activities.type} = 'meeting')::int`,
      email: sql<number>`count(${activities.id}) filter (where ${activities.type} = 'email')::int`,
      total: sql<number>`count(${activities.id})::int`,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(activities, and(eq(activities.authorUserId, memberships.userId), eq(activities.tenantId, memberships.tenantId), inPeriod(activities.occurredAt)))
    .where(and(sql`${memberships.role} <> 'viewer'`, ownerId ? eq(memberships.userId, ownerId) : undefined))
    .groupBy(users.id)
    .orderBy(sql`count(${activities.id}) desc`, asc(users.name))

  // ---- overdue tasks now ----
  const overdueWhere = and(isNull(tasks.completedAt), sql`${tasks.dueAt} < now()`, ownerId ? eq(tasks.assigneeUserId, ownerId) : undefined)
  const [overdueCount] = await tx.select({ n: sql<number>`count(*)::int` }).from(tasks).where(overdueWhere)
  const overdue = await tx
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      assignee: users.name,
      contactId: tasks.contactId,
      contactName: sql<string | null>`trim(${contacts.firstName} || ' ' || ${contacts.lastName})`,
      companyId: tasks.companyId,
      companyName: companies.name,
      dealId: tasks.dealId,
      dealName: deals.name,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeUserId))
    .leftJoin(contacts, and(eq(contacts.id, tasks.contactId), eq(contacts.tenantId, tasks.tenantId)))
    .leftJoin(companies, and(eq(companies.id, tasks.companyId), eq(companies.tenantId, tasks.tenantId)))
    .leftJoin(deals, and(eq(deals.id, tasks.dealId), eq(deals.tenantId, tasks.tenantId)))
    .where(overdueWhere)
    .orderBy(asc(tasks.dueAt))
    .limit(OVERDUE_SHOWN)

  const sum = (key: 'count' | 'value' | 'weighted') => stages.reduce((n, s) => n + s[key], 0)
  return {
    period: { key: q.period, from: range!.from, to: range!.to },
    currency,
    pipeline: {
      id: pipeline.id,
      name: pipeline.name,
      stages,
      count: sum('count'),
      value: sum('value'),
      weighted: sum('weighted'),
      otherCurrencyCount: stageRows.reduce((n, s) => n + s.other, 0),
    },
    won: { count: wonCount, value: Number(won?.value ?? 0) },
    lost: { count: lostCount, value: Number(lost?.value ?? 0) },
    winRate: wonCount + lostCount ? wonCount / (wonCount + lostCount) : null,
    newDeals: created!.n,
    lostReasons,
    activities: perUser.map(({ id, name, ...counts }) => ({ user: { id, name }, ...counts })),
    overdueTasks: {
      count: overdueCount!.n,
      items: overdue.map((t) => ({
        id: t.id,
        title: t.title,
        dueDate: t.dueDate,
        assignee: t.assignee,
        record:
          t.dealId && t.dealName
            ? { type: 'deal' as const, id: t.dealId, name: t.dealName }
            : t.contactId && t.contactName
              ? { type: 'contact' as const, id: t.contactId, name: t.contactName }
              : t.companyId && t.companyName
                ? { type: 'company' as const, id: t.companyId, name: t.companyName }
                : null,
      })),
    },
  }
}
