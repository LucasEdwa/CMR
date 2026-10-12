import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import {
  mentionedUserIds,
  relabelMentions,
  richTextToPlain,
  type Activity,
  type RecordRef,
  type RichDoc,
  type Timeline,
  type createActivitySchema,
  type timelineQuerySchema,
  type updateActivitySchema,
} from '@crm/shared'
import { audit } from '../db/audit.js'
import type { Tx } from '../db/client.js'
import { activities, activityLinks, companies, contacts, dealContacts, deals, memberships, users } from '../db/schema.js'
import type { TenantContext } from '../db/tenant.js'
import { HttpError } from '../errors.js'
import { MANAGERS } from '../auth/context.js'
import { notify } from './notifications.js'
import { requireRecord, type NamedRecord } from './records.js'

type ActivityRow = typeof activities.$inferSelect
type Links = { contacts: string[]; companies: string[]; deals: string[] }

// Pinned items are listed in full above the timeline; this is only a safety cap.
const MAX_PINNED = 100
const linkColumn = { contact: activityLinks.contactId, company: activityLinks.companyId, deal: activityLinks.dealId }

// An activity shows on the record it was logged on and on the records around it:
// a deal's contacts and company, a contact's company. Records in Trash are skipped.
async function linkTargets(tx: Tx, ref: RecordRef): Promise<Links> {
  const links: Links = { contacts: [], companies: [], deals: [] }
  if (ref.type === 'deal') {
    links.deals.push(ref.id)
    const [deal] = await tx.select({ companyId: deals.companyId }).from(deals).where(eq(deals.id, ref.id))
    const linked = await tx
      .select({ id: contacts.id })
      .from(dealContacts)
      .innerJoin(contacts, and(eq(contacts.id, dealContacts.contactId), eq(contacts.tenantId, dealContacts.tenantId)))
      .where(and(eq(dealContacts.dealId, ref.id), isNull(contacts.deletedAt)))
    links.contacts.push(...linked.map((c) => c.id))
    if (deal?.companyId) links.companies.push(deal.companyId)
  } else if (ref.type === 'contact') {
    links.contacts.push(ref.id)
    const [contact] = await tx.select({ companyId: contacts.companyId }).from(contacts).where(eq(contacts.id, ref.id))
    if (contact?.companyId) links.companies.push(contact.companyId)
  } else {
    links.companies.push(ref.id)
  }
  if (links.companies.length) {
    const live = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(and(inArray(companies.id, links.companies), isNull(companies.deletedAt)))
    links.companies = live.map((c) => c.id)
  }
  return links
}

// Names of the live records each activity is linked to, for one page of activities.
async function linksFor(tx: Tx, ids: string[]) {
  const map = new Map<string, Activity['links']>()
  if (!ids.length) return map
  const rows = await tx
    .select({
      activityId: activityLinks.activityId,
      contactId: contacts.id,
      contactName: sql<string | null>`trim(${contacts.firstName} || ' ' || ${contacts.lastName})`,
      companyId: companies.id,
      companyName: companies.name,
      dealId: deals.id,
      dealName: deals.name,
    })
    .from(activityLinks)
    .leftJoin(contacts, and(eq(contacts.id, activityLinks.contactId), eq(contacts.tenantId, activityLinks.tenantId), isNull(contacts.deletedAt)))
    .leftJoin(companies, and(eq(companies.id, activityLinks.companyId), eq(companies.tenantId, activityLinks.tenantId), isNull(companies.deletedAt)))
    .leftJoin(deals, and(eq(deals.id, activityLinks.dealId), eq(deals.tenantId, activityLinks.tenantId), isNull(deals.deletedAt)))
    .where(inArray(activityLinks.activityId, ids))
  for (const r of rows) {
    const entry = map.get(r.activityId) ?? { contacts: [], companies: [], deals: [] }
    if (r.contactId && r.contactName) entry.contacts.push({ id: r.contactId, name: r.contactName })
    if (r.companyId && r.companyName) entry.companies.push({ id: r.companyId, name: r.companyName })
    if (r.dealId && r.dealName) entry.deals.push({ id: r.dealId, name: r.dealName })
    map.set(r.activityId, entry)
  }
  return map
}

const canEdit = (ctx: TenantContext, row: ActivityRow) =>
  row.authorUserId === ctx.userId || (MANAGERS as readonly string[]).includes(ctx.role)

async function toActivities(tx: Tx, ctx: TenantContext, rows: Array<{ a: ActivityRow; authorName: string | null }>): Promise<Activity[]> {
  const links = await linksFor(tx, rows.map((r) => r.a.id))
  return rows.map(({ a, authorName }) => ({
    id: a.id,
    type: a.type,
    subject: a.subject,
    body: a.body ?? null,
    occurredAt: a.occurredAt.toISOString(),
    durationMinutes: a.durationMinutes,
    outcome: a.outcome,
    direction: a.direction,
    pinned: a.pinned,
    author: a.authorUserId && authorName ? { id: a.authorUserId, name: authorName } : null,
    links: links.get(a.id) ?? { contacts: [], companies: [], deals: [] },
    canEdit: canEdit(ctx, a),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  }))
}

const selectActivities = (tx: Tx) =>
  tx.select({ a: activities, authorName: users.name }).from(activities).leftJoin(users, eq(users.id, activities.authorUserId))

// The cursor is the last item's occurred_at and id. occurred_at is always written from a JS Date,
// so millisecond precision round-trips exactly.
const encodeCursor = (a: ActivityRow) => `${a.occurredAt.toISOString()}_${a.id}`
function decodeCursor(cursor: string) {
  const [at, id] = cursor.split('_')
  if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/.test(id)) {
    throw new HttpError(400, 'validation_error', 'Invalid cursor')
  }
  return { at, id }
}

export async function getTimeline(tx: Tx, ctx: TenantContext, q: z.output<typeof timelineQuerySchema>): Promise<Timeline> {
  const onRecord = sql`${activities.id} in (select ${activityLinks.activityId} from ${activityLinks} where ${linkColumn[q.type]} = ${q.id})`
  const where: SQL[] = [onRecord]
  if (q.types.length) where.push(inArray(activities.type, q.types))
  const order = [desc(activities.occurredAt), desc(activities.id)]

  const pagedWhere = [...where, eq(activities.pinned, false)]
  if (q.cursor) {
    const { at, id } = decodeCursor(q.cursor)
    pagedWhere.push(sql`(${activities.occurredAt}, ${activities.id}) < (${at}::timestamptz, ${id}::uuid)`)
  }
  const [pinned, page] = await Promise.all([
    q.cursor ? Promise.resolve([]) : selectActivities(tx).where(and(...where, eq(activities.pinned, true))).orderBy(...order).limit(MAX_PINNED),
    selectActivities(tx).where(and(...pagedWhere)).orderBy(...order).limit(q.limit + 1),
  ])
  const more = page.length > q.limit
  const items = page.slice(0, q.limit)
  return {
    pinned: await toActivities(tx, ctx, pinned),
    items: await toActivities(tx, ctx, items),
    nextCursor: more ? encodeCursor(items.at(-1)!.a) : null,
  }
}

async function getActivity(tx: Tx, ctx: TenantContext, id: string) {
  const rows = await selectActivities(tx).where(eq(activities.id, id))
  if (!rows.length) throw new HttpError(404, 'not_found', 'Activity not found')
  return (await toActivities(tx, ctx, rows))[0]!
}

// Logged activity counts as deal activity: it resets the stale marker.
async function touchDeals(tx: Tx, ids: string[], at: Date) {
  if (ids.length) await tx.update(deals).set({ lastActivityAt: at }).where(and(inArray(deals.id, ids), sql`${deals.lastActivityAt} < ${at.toISOString()}::timestamptz`))
}

// Where an @mention notification links to: the deal if there is one, then a contact, then a company.
async function primaryRecord(tx: Tx, activityId: string): Promise<NamedRecord | null> {
  const links = (await linksFor(tx, [activityId])).get(activityId)
  const deal = links?.deals[0]
  if (deal) return { type: 'deal', ...deal }
  const contact = links?.contacts[0]
  if (contact) return { type: 'contact', ...contact }
  const company = links?.companies[0]
  return company ? { type: 'company', ...company } : null
}

async function notifyMentions(tx: Tx, ctx: TenantContext, activity: ActivityRow, userIds: string[]) {
  if (!userIds.length) return
  const excerpt = activity.bodyText.length > 120 ? `${activity.bodyText.slice(0, 117)}...` : activity.bodyText
  await notify(tx, ctx, userIds, 'mention', {
    title: excerpt,
    record: await primaryRecord(tx, activity.id),
    activityId: activity.id,
  })
}

// Mention labels come from the member list, not from the browser.
async function withMemberLabels(tx: Tx, body: RichDoc): Promise<RichDoc> {
  const ids = mentionedUserIds(body)
  const members = ids.length
    ? await tx.select({ id: users.id, name: users.name }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(inArray(memberships.userId, ids))
    : []
  return relabelMentions(body, new Map(members.map((m) => [m.id, m.name])))
}

const auditable = (a: ActivityRow) => ({ ...a, body: undefined, bodyText: a.bodyText.slice(0, 200) })

export async function createActivity(tx: Tx, ctx: TenantContext, input: z.output<typeof createActivitySchema>) {
  const { record, body: sent, occurredAt, ...fields } = input
  const body = sent ? await withMemberLabels(tx, sent) : sent
  await requireRecord(tx, record)
  const links = await linkTargets(tx, record)
  const now = new Date()
  const [row] = await tx
    .insert(activities)
    .values({
      ...fields,
      tenantId: ctx.tenantId,
      body: body ?? null,
      bodyText: richTextToPlain(body),
      occurredAt: occurredAt ? new Date(occurredAt) : now,
      // Calls carry an outcome and emails a direction; the other fields are ignored for other types.
      outcome: input.type === 'call' ? (fields.outcome ?? null) : null,
      direction: input.type === 'email' ? (fields.direction ?? null) : null,
      authorUserId: ctx.userId,
    })
    .returning()
  const linkRows = [
    ...links.contacts.map((contactId) => ({ contactId })),
    ...links.companies.map((companyId) => ({ companyId })),
    ...links.deals.map((dealId) => ({ dealId })),
  ].map((l) => ({ tenantId: ctx.tenantId, activityId: row!.id, ...l }))
  await tx.insert(activityLinks).values(linkRows)
  await touchDeals(tx, links.deals, now)
  await audit(tx, ctx, { action: 'create', entityType: 'activity', entityId: row!.id, after: { ...auditable(row!), record } })
  await notifyMentions(tx, ctx, row!, mentionedUserIds(body))
  return getActivity(tx, ctx, row!.id)
}

async function editableActivity(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx.select().from(activities).where(eq(activities.id, id))
  if (!row) throw new HttpError(404, 'not_found', 'Activity not found')
  if (!canEdit(ctx, row)) throw new HttpError(403, 'forbidden', 'Only the author or an admin can change this')
  return row
}

export async function updateActivity(tx: Tx, ctx: TenantContext, id: string, input: z.output<typeof updateActivitySchema>) {
  const before = await editableActivity(tx, ctx, id)
  const { body: sent, occurredAt, ...fields } = input
  const body = sent ? await withMemberLabels(tx, sent) : sent
  const next = {
    ...fields,
    ...(body !== undefined ? { body, bodyText: richTextToPlain(body) } : {}),
    ...(occurredAt ? { occurredAt: new Date(occurredAt) } : {}),
  }
  const after = { ...before, ...next }
  if (after.type === 'note' ? !after.bodyText : !after.subject && !after.bodyText) {
    throw new HttpError(400, 'validation_error', 'The activity needs some text', [{ path: ['body'], message: 'content_required' }])
  }
  const [row] = await tx
    .update(activities)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(activities.id, id))
    .returning()
  await audit(tx, ctx, { action: 'update', entityType: 'activity', entityId: id, before: auditable(before), after: auditable(row!) })
  // Only people who were not mentioned before get a notification.
  if (body !== undefined) {
    const already = new Set(mentionedUserIds(before.body))
    await notifyMentions(tx, ctx, row!, mentionedUserIds(body).filter((u) => !already.has(u)))
  }
  return getActivity(tx, ctx, id)
}

export async function deleteActivity(tx: Tx, ctx: TenantContext, id: string) {
  const before = await editableActivity(tx, ctx, id)
  await tx.delete(activities).where(eq(activities.id, id))
  await audit(tx, ctx, { action: 'delete', entityType: 'activity', entityId: id, before: auditable(before) })
}
