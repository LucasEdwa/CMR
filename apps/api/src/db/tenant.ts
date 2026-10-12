import { sql } from 'drizzle-orm'
import type { Role } from '@crm/shared'
import { db as defaultDb, type Db, type Tx } from './client.js'

export type TenantContext = {
  tenantId: string
  userId: string
  role: Role
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

// User-scoped context without a tenant, e.g. listing the workspaces a user belongs to.
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>, db: Db = defaultDb): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`)
    return fn(tx)
  })
}
