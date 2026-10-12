import { sql } from 'drizzle-orm'
import type { Role } from '@crm/shared'
import { db as defaultDb, type Db, type Tx } from './client.js'

// 'system' is work the server starts itself after its own checks (defaults, verified invitations,
// background jobs). RLS lets it write like an owner or admin. It never comes from a request.
export type TenantContext = {
  tenantId: string
  userId: string
  role: Role | 'system'
}

// Runs fn in a transaction with the tenant context set transaction-locally (set_config(..., true)).
// Never use a plain SET: on a pooled connection it would leak into the next request.
// tenantId must come from the verified session + a membership lookup, never straight from the client.
export async function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>, db: Db = defaultDb): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.tenant_id', ${ctx.tenantId}, true),
      set_config('app.user_id', ${ctx.userId}, true),
      set_config('app.role', ${ctx.role}, true)`)
    return fn(tx)
  })
}

// Runs fn with the 'system' role inside the current transaction, then restores the caller's role.
// Only for writes the caller may trigger but not do by hand, e.g. creating a workspace's default pipeline.
export async function asSystem<T>(tx: Tx, ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  await tx.execute(sql`select set_config('app.role', 'system', true)`)
  try {
    return await fn()
  } finally {
    await tx.execute(sql`select set_config('app.role', ${ctx.role}, true)`)
  }
}

// User-scoped context without a tenant, e.g. listing the workspaces a user belongs to.
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>, db: Db = defaultDb): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`)
    return fn(tx)
  })
}

// Tenant-only context for flows without a member yet, e.g. looking up an invitation link
// whose token names the tenant. Never use it with a tenant id the caller merely claims
// unless the following query also checks a secret (like the invitation token hash).
export async function withTenantOnly<T>(tenantId: string, fn: (tx: Tx) => Promise<T>, db: Db = defaultDb): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`)
    return fn(tx)
  })
}
