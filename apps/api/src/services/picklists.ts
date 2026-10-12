import { asc, eq, and } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { DEFAULT_PICKLISTS, PICKLIST_KINDS, slugify, type PicklistKind, type Picklists } from '@crm/shared'
import { audit } from '../db/audit.js'
import type { Tx } from '../db/client.js'
import { picklistItems } from '../db/schema.js'
import { asSystem, type TenantContext } from '../db/tenant.js'

// Built-in items are inserted the first time a workspace reads its picklists.
async function ensureDefaults(tx: Tx, ctx: TenantContext) {
  const [any] = await tx.select({ id: picklistItems.id }).from(picklistItems).limit(1)
  if (any) return
  // Any role may read the lists first; inserting the built-ins is the app's own setup work.
  await asSystem(tx, ctx, () => tx
    .insert(picklistItems)
    .values(
      PICKLIST_KINDS.flatMap((kind) =>
        DEFAULT_PICKLISTS[kind].map((key, position) => ({ tenantId: ctx.tenantId, kind, key, label: null, position })),
      ),
    )
    .onConflictDoNothing())
}

export async function getPicklists(tx: Tx, ctx: TenantContext): Promise<Picklists> {
  await ensureDefaults(tx, ctx)
  const rows = await tx.select().from(picklistItems).orderBy(asc(picklistItems.position))
  return Object.fromEntries(
    PICKLIST_KINDS.map((kind) => [kind, rows.filter((r) => r.kind === kind).map((r) => ({ key: r.key, label: r.label }))]),
  ) as Picklists
}

export async function picklistHas(tx: Tx, ctx: TenantContext, kind: PicklistKind, key: string) {
  await ensureDefaults(tx, ctx)
  const [row] = await tx
    .select({ id: picklistItems.id })
    .from(picklistItems)
    .where(and(eq(picklistItems.kind, kind), eq(picklistItems.key, key)))
  return !!row
}

// Replaces the list. Records keep their stored key even if its item is removed.
export async function savePicklist(
  tx: Tx,
  ctx: TenantContext,
  kind: PicklistKind,
  items: Array<{ key?: string; label?: string | null }>,
) {
  await ensureDefaults(tx, ctx)
  const before = (await getPicklists(tx, ctx))[kind]
  const values = items.map((item, position) => ({
    tenantId: ctx.tenantId,
    kind,
    key: item.key || `${slugify(item.label ?? '') || 'item'}-${randomUUID().slice(0, 6)}`,
    label: item.label || null,
    position,
  }))
  await tx.delete(picklistItems).where(eq(picklistItems.kind, kind))
  if (values.length) await tx.insert(picklistItems).values(values)
  await audit(tx, ctx, {
    action: 'update',
    entityType: 'picklist',
    after: { kind, items: values.map((v) => v.label ?? v.key) },
    before: { kind, items: before.map((b) => b.label ?? b.key) },
  })
}
