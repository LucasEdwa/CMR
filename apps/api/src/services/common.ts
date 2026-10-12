import { eq, sql, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { memberships, tenants } from '../db/schema.js'
import type { Tx } from '../db/client.js'
import type { TenantContext } from '../db/tenant.js'
import { HttpError } from '../errors.js'

// Lowercased text the trigram index searches. Phone numbers are added digits-only as well,
// so "0701234567" finds "070-123 45 67".
export function buildSearchText(parts: Array<string | null | undefined>, phones: Array<string | null | undefined> = []) {
  const digits = phones.filter(Boolean).map((p) => p!.replace(/\D/g, ''))
  return [...parts, ...phones, ...digits]
    .filter((p): p is string => !!p && p.trim() !== '')
    .join(' ')
    .toLowerCase()
}

// Swedish alphabetical order (Å, Ä, Ö after Z) for every name sort. Indexes use the same collation.
export const sv = (column: PgColumn) => sql`lower(${column}) collate "sv-x-icu"`

export const likePattern = (q: string) => `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`

// The owner of a record must be a member of the workspace.
export async function assertMember(tx: Tx, userId: string | null | undefined) {
  if (!userId) return
  const [m] = await tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, userId))
  if (!m) throw new HttpError(400, 'validation_error', 'Owner must be a member of the workspace', [{ message: 'invalid_owner' }])
}

export async function tenantTimezone(tx: Tx, ctx: TenantContext) {
  const [t] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId))
  return t?.timezone ?? 'Europe/Stockholm'
}

// owner filter values: user ids, "me" and "none".
export function ownerFilter(column: PgColumn, values: string[], ctx: TenantContext): SQL | undefined {
  if (!values.length) return undefined
  const ids = values.filter((v) => v !== 'none').map((v) => (v === 'me' ? ctx.userId : v))
  const parts: SQL[] = []
  if (ids.length) parts.push(sql`${column} in ${ids}`)
  if (values.includes('none')) parts.push(sql`${column} is null`)
  return sql`(${sql.join(parts, sql` or `)})`
}

export function createdRange(column: PgColumn, tz: string, from?: string, to?: string): SQL[] {
  const local = sql`(${column} at time zone ${tz})::date`
  return [from ? sql`${local} >= ${from}::date` : undefined, to ? sql`${local} <= ${to}::date` : undefined].filter(
    (x): x is SQL => !!x,
  )
}

export const ownerRef = (ownerId: string | null, ownerName: string | null) =>
  ownerId && ownerName ? { id: ownerId, name: ownerName } : null
