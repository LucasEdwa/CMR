import type { TenantContext } from './tenant.js'
import type { Tx } from './client.js'
import { auditLog } from './schema.js'

export type AuditAction = 'create' | 'update' | 'delete' | 'restore' | 'erase' | (string & {})

export type AuditEntry = {
  action: AuditAction
  entityType: string
  entityId?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}

// Only the fields that changed are stored, as { field: [before, after] }.
export function diffRecords(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, [unknown, unknown]> {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  const diff: Record<string, [unknown, unknown]> = {}
  for (const key of keys) {
    if (key === 'updatedAt') continue
    const a = before?.[key] ?? null
    const b = after?.[key] ?? null
    if (JSON.stringify(a) !== JSON.stringify(b)) diff[key] = [a, b]
  }
  return diff
}

// Call inside the same withTenant transaction as the mutation, so the audit row commits or rolls back with it.
export async function audit(tx: Tx, ctx: TenantContext, entry: AuditEntry) {
  await tx.insert(auditLog).values({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    diff: diffRecords(entry.before, entry.after),
  })
}
