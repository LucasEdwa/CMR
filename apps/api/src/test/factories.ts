import { randomUUID } from 'node:crypto'
import type { Role } from '@crm/shared'
import { db as defaultDb, type Db } from '../db/client.js'
import { memberships, tenants, users } from '../db/schema.js'
import { withTenant, type TenantContext } from '../db/tenant.js'

// Every test creates its own tenants with random ids, so tests never depend on each other's data.
export async function createTenantWithUser(
  role: Role = 'owner',
  db: Db = defaultDb,
): Promise<TenantContext & { slug: string }> {
  const tenantId = randomUUID()
  const userId = randomUUID()
  const slug = `t-${tenantId.slice(0, 8)}`
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, name: 'Test User' })
  const ctx = { tenantId, userId, role }
  await withTenant(
    ctx,
    async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `Tenant ${slug}`, slug })
      await tx.insert(memberships).values({ tenantId, userId, role })
    },
    db,
  )
  return { ...ctx, slug }
}

// Drizzle wraps driver errors ("Failed query: ..."); the Postgres message is on `cause`.
export async function pgErrorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (err) {
    const e = err as Error & { cause?: Error }
    return e.cause?.message ?? e.message
  }
  throw new Error('Expected the query to fail, but it succeeded')
}
