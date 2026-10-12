import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import { TRASH_RETENTION_DAYS } from '@crm/shared'
import { audit } from '../db/audit.js'
import type { Tx } from '../db/client.js'
import { activities, activityLinks, companies, contacts, deals, tasks } from '../db/schema.js'
import type { TenantContext } from '../db/tenant.js'
import { QUEUES, type TenantJob } from '../jobs/queues.js'

export type PurgeJob = TenantJob<{ type: 'contact' | 'company' | 'deal'; id: string }>

const RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000

let boss: PgBoss | null = null
export function usePurgeQueue(instance: PgBoss) {
  boss = instance
}

// One job per deleted record, due when its 30 days in Trash are over. A per-record job keeps the
// work inside one tenant's RLS context; there is no cross-tenant sweep.
export async function schedulePurge(ctx: TenantContext, type: PurgeJob['type'], id: string) {
  if (!boss) return
  const data: PurgeJob = { tenantId: ctx.tenantId, userId: ctx.userId, type, id }
  await boss.send(QUEUES.purgeRecord, data, {
    startAfter: new Date(Date.now() + RETENTION_MS + 60_000),
    // Default retention (14 days) is shorter than the delay.
    retentionSeconds: (TRASH_RETENTION_DAYS + 10) * 24 * 60 * 60,
  })
}

// Only erases the record if it is still deleted and has been for the full period
// (it may have been restored, or deleted again later).
export async function purgeRecord(tx: Tx, job: PurgeJob) {
  const cutoff = new Date(Date.now() - RETENTION_MS)
  const table = { contact: contacts, company: companies, deal: deals }[job.type]
  if (job.type === 'company') {
    const [stillDeleted] = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, job.id), lt(companies.deletedAt, cutoff)))
    if (!stillDeleted) return false
    // Contacts and deals outlive their company: unlink them before the company is erased.
    await tx.update(contacts).set({ companyId: null }).where(eq(contacts.companyId, job.id))
    await tx.update(deals).set({ companyId: null }).where(eq(deals.companyId, job.id))
  }
  const linkColumn = { contact: activityLinks.contactId, company: activityLinks.companyId, deal: activityLinks.dealId }[job.type]
  const linked = (await tx.select({ id: activityLinks.activityId }).from(activityLinks).where(eq(linkColumn, job.id))).map((l) => l.id)
  const taskColumn = { contact: tasks.contactId, company: tasks.companyId, deal: tasks.dealId }[job.type]
  const taskIds = (await tx.select({ id: tasks.id }).from(tasks).where(eq(taskColumn, job.id))).map((t) => t.id)
  // Tasks and activity links go with the record (ON DELETE CASCADE).
  const [gone] = await tx
    .delete(table)
    .where(and(eq(table.id, job.id), lt(table.deletedAt, cutoff)))
    .returning({ id: table.id })
  let erasedActivities: string[] = []
  if (gone && linked.length) {
    // Activities that were only on this record have nowhere left to show: erase them too.
    erasedActivities = (
      await tx
        .delete(activities)
        .where(and(inArray(activities.id, linked), sql`not exists (select 1 from ${activityLinks} where ${activityLinks.activityId} = ${activities.id})`))
        .returning({ id: activities.id })
    ).map((a) => a.id)
  }
  if (gone) {
    // The old values in the audit log are personal data too: clear them, keep the events.
    const erased = [
      { type: job.type, id: job.id },
      ...erasedActivities.map((id) => ({ type: 'activity', id })),
      ...taskIds.map((id) => ({ type: 'task', id })),
    ]
    for (const e of erased) await tx.execute(sql`select app_redact_erased_audit(${e.type}, ${e.id}::uuid)`)
    await audit(tx, { tenantId: job.tenantId, userId: job.userId, role: 'system' }, {
      action: 'purge',
      entityType: job.type,
      entityId: job.id,
    })
  }
  return !!gone
}
