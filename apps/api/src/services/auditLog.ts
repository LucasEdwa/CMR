import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type { AuditEntry, auditQuerySchema } from '@crm/shared'
import type { Tx } from '../db/client.js'
import { auditLog, companies, contacts, deals, tenants, users } from '../db/schema.js'
import type { TenantContext } from '../db/tenant.js'

// Never shown, even to admins: secrets, internal search text and other noise.
const HIDDEN_FIELDS = new Set(['tokenHash', 'searchText', 'password', 'source', 'tenantId', 'createdAt', 'updatedAt', 'id'])

// Current names of the contacts, companies and deals on one page (Trash included).
async function namesFor(tx: Tx, rows: Array<{ entityType: string; entityId: string | null }>) {
  const ids = (type: string) => [...new Set(rows.filter((r) => r.entityType === type && r.entityId).map((r) => r.entityId!))]
  const names = new Map<string, string>()
  const [c, co, d] = await Promise.all([
    ids('contact').length
      ? tx.select({ id: contacts.id, name: sql<string>`trim(${contacts.firstName} || ' ' || ${contacts.lastName})` }).from(contacts).where(inArray(contacts.id, ids('contact')))
      : [],
    ids('company').length ? tx.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, ids('company'))) : [],
    ids('deal').length ? tx.select({ id: deals.id, name: deals.name }).from(deals).where(inArray(deals.id, ids('deal'))) : [],
  ])
  for (const r of [...c, ...co, ...d]) names.set(r.id, r.name)
  return names
}

export async function listAudit(tx: Tx, ctx: TenantContext, q: z.output<typeof auditQuerySchema>) {
  const [tenant] = await tx.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId))
  const local = sql`(${auditLog.createdAt} at time zone ${tenant!.tz})::date`
  const where: SQL[] = []
  if (q.actor) where.push(eq(auditLog.actorUserId, q.actor))
  if (q.entityType) where.push(eq(auditLog.entityType, q.entityType))
  if (q.entityId) where.push(eq(auditLog.entityId, q.entityId))
  if (q.from) where.push(sql`${local} >= ${q.from}::date`)
  if (q.to) where.push(sql`${local} <= ${q.to}::date`)
  // Job heartbeats are not something people did.
  where.push(sql`${auditLog.action} <> 'ping'`)

  const [rows, [count]] = await Promise.all([
    tx
      .select({ a: auditLog, actor: users.name })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(and(...where))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    tx.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(and(...where)),
  ])
  const names = await namesFor(tx, rows.map((r) => r.a))
  const items: AuditEntry[] = rows.map(({ a, actor }) => ({
    id: a.id,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    entityName: (a.entityId && names.get(a.entityId)) ?? null,
    actor,
    createdAt: a.createdAt.toISOString(),
    changes: Object.entries((a.diff ?? {}) as Record<string, [unknown, unknown]>)
      .filter(([field]) => !HIDDEN_FIELDS.has(field))
      .map(([field, [before, after]]) => ({ field, before, after })),
  }))
  return { items, total: count!.n, page: q.page, pageSize: q.pageSize }
}
