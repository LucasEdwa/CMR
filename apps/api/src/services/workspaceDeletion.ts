import { and, eq, isNotNull, lte } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import { verifyPassword } from 'better-auth/crypto'
import type { Locale } from '@crm/shared'
import { audit } from '../db/audit.js'
import { db } from '../db/client.js'
import { accounts, memberships, tenants, users } from '../db/schema.js'
import { withTenant, type TenantContext } from '../db/tenant.js'
import { sendEmail } from '../email/send.js'
import { emails } from '../email/templates.js'
import { env } from '../env.js'
import { HttpError } from '../errors.js'
import { QUEUES, type TenantJob } from '../jobs/queues.js'

// Deleting a workspace is the one action that cannot be undone: it needs the owner's password,
// and the data stays for DELETION_GRACE_DAYS so any owner can cancel (and export first).
export const DELETION_GRACE_DAYS = 7

export type WorkspaceDeleteJob = TenantJob

let boss: PgBoss | null = null
export function useWorkspaceDeleteQueue(instance: PgBoss) {
  boss = instance
}

export async function checkPassword(userId: string, password: string) {
  const [account] = await db
    .select({ hash: accounts.password })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
  if (!account?.hash || !(await verifyPassword({ hash: account.hash, password }))) {
    throw new HttpError(403, 'INVALID_PASSWORD', 'Wrong password')
  }
}

async function emailOwners(ctx: TenantContext, kind: 'scheduled' | 'cancelled', workspace: string, when: Date | null, actor: string) {
  const owners = await withTenant(ctx, (tx) =>
    tx
      .select({ email: users.email, name: users.name, locale: users.locale })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.role, 'owner')),
  )
  for (const o of owners) {
    const locale: Locale = o.locale === 'en' ? 'en' : 'sv'
    await sendEmail(emails.workspaceDeletion(o.email, locale, { kind, workspace, when, actor, url: `${env.WEB_ORIGIN}/settings` }))
  }
}

export async function scheduleDeletion(ctx: TenantContext, actorName: string) {
  const when = new Date(Date.now() + DELETION_GRACE_DAYS * 86_400_000)
  const tenant = await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .update(tenants)
      .set({ deletionScheduledFor: when, deletionRequestedBy: ctx.userId, updatedAt: new Date() })
      .where(eq(tenants.id, ctx.tenantId))
      .returning()
    await audit(tx, ctx, { action: 'schedule_delete', entityType: 'workspace', entityId: ctx.tenantId, after: { deletionScheduledFor: when.toISOString() } })
    return row!
  })
  if (boss) {
    const job: WorkspaceDeleteJob = { tenantId: ctx.tenantId, userId: ctx.userId }
    await boss.send(QUEUES.workspaceDelete, job, { startAfter: new Date(when.getTime() + 60_000), retentionSeconds: (DELETION_GRACE_DAYS + 7) * 86_400 })
  }
  await emailOwners(ctx, 'scheduled', tenant.name, when, actorName)
  return tenant
}

export async function cancelDeletion(ctx: TenantContext, actorName: string) {
  const tenant = await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .update(tenants)
      .set({ deletionScheduledFor: null, deletionRequestedBy: null, updatedAt: new Date() })
      .where(and(eq(tenants.id, ctx.tenantId), isNotNull(tenants.deletionScheduledFor)))
      .returning()
    if (!row) throw new HttpError(409, 'not_scheduled', 'The workspace is not scheduled for deletion')
    await audit(tx, ctx, { action: 'cancel_delete', entityType: 'workspace', entityId: ctx.tenantId })
    return row
  })
  await emailOwners(ctx, 'cancelled', tenant.name, null, actorName)
  return tenant
}

// The job: erases the workspace only if it is still scheduled and the time has come
// (an owner may have cancelled, or cancelled and scheduled again later).
export async function deleteIfDue(job: WorkspaceDeleteJob) {
  const ctx: TenantContext = { tenantId: job.tenantId, userId: job.userId, role: 'system' }
  return withTenant(ctx, async (tx) => {
    const gone = await tx
      .delete(tenants)
      .where(and(eq(tenants.id, job.tenantId), isNotNull(tenants.deletionScheduledFor), lte(tenants.deletionScheduledFor, new Date())))
      .returning({ id: tenants.id })
    return gone.length > 0
  })
}
