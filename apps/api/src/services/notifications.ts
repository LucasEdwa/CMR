import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { notificationSchema, type Notification, type NotificationType, type Notifications } from '@crm/shared'
import type { Tx } from '../db/client.js'
import { memberships, notifications, users } from '../db/schema.js'
import type { TenantContext } from '../db/tenant.js'
import { HttpError } from '../errors.js'
import type { NamedRecord } from './records.js'

export type NotificationData = {
  title: string
  record: NamedRecord | null
  taskId?: string
  activityId?: string
}

// Notifies workspace members. The actor never notifies themselves, and ids that are not
// members of the workspace are ignored (RLS would reject them as well).
export async function notify(
  tx: Tx,
  ctx: TenantContext,
  recipients: Array<string | null | undefined>,
  type: NotificationType,
  data: NotificationData,
  { includeSelf = false } = {},
) {
  const ids = [...new Set(recipients.filter((id): id is string => !!id && (includeSelf || id !== ctx.userId)))]
  if (!ids.length) return []
  const members = await tx.select({ id: memberships.userId }).from(memberships).where(inArray(memberships.userId, ids))
  if (!members.length) return []
  // No .returning(): the rows belong to other users, so RLS hides them from the actor.
  await tx.insert(notifications).values(
    members.map((m) => ({
      tenantId: ctx.tenantId,
      userId: m.id,
      type,
      actorUserId: includeSelf ? null : ctx.userId,
      data,
    })),
  )
  return members.map((m) => m.id)
}

export async function listNotifications(tx: Tx, ctx: TenantContext, limit = 30): Promise<Notifications> {
  const mine = eq(notifications.userId, ctx.userId)
  const [rows, [unread]] = await Promise.all([
    tx
      .select({ n: notifications, actor: users.name })
      .from(notifications)
      .leftJoin(users, eq(users.id, notifications.actorUserId))
      .where(mine)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(mine, isNull(notifications.readAt))),
  ])
  return {
    items: rows.map(({ n, actor }): Notification => {
      const data = n.data as NotificationData
      return notificationSchema.parse({
        id: n.id,
        type: n.type,
        actor,
        title: data.title,
        record: data.record ?? null,
        taskId: data.taskId ?? null,
        activityId: data.activityId ?? null,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })
    }),
    unread: unread!.count,
  }
}

export async function markRead(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, ctx.userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id })
  if (row) return
  const [exists] = await tx.select({ id: notifications.id }).from(notifications).where(eq(notifications.id, id))
  if (!exists) throw new HttpError(404, 'not_found', 'Notification not found')
}

export async function markAllRead(tx: Tx, ctx: TenantContext) {
  await tx
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt)))
}
