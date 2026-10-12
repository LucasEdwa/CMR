import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createDb } from './client.js'
import { auditLog, memberships, tenants, users } from './schema.js'
import { withTenant, withUser, type TenantContext } from './tenant.js'
import { audit } from './audit.js'
import { createTenantWithUser, pgErrorOf } from '../test/factories.js'

// A single-connection pool, so every transaction reuses the same session. This catches
// tenant context leaking from one transaction into the next on a pooled connection.
const { client, db } = createDb(process.env.DATABASE_URL!, { max: 1 })

let A: TenantContext
let B: TenantContext

beforeAll(async () => {
  A = await createTenantWithUser('owner', db)
  B = await createTenantWithUser('owner', db)
  await withTenant(A, (tx) => audit(tx, A, { action: 'create', entityType: 'test', after: { tenant: 'A' } }), db)
  await withTenant(B, (tx) => audit(tx, B, { action: 'create', entityType: 'test', after: { tenant: 'B' } }), db)
})

afterAll(() => client.end())

const tenantTables = [
  { name: 'memberships', table: memberships },
  { name: 'audit_log', table: auditLog },
] as const

describe.each(tenantTables)('$name isolation', ({ table }) => {
  it('only returns rows of the current tenant', async () => {
    const rows = await withTenant(A, (tx) => tx.select().from(table), db)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.tenantId === A.tenantId)).toBe(true)
  })

  it("cannot read another tenant's row by id", async () => {
    const [bRow] = await withTenant(B, (tx) => tx.select().from(table).limit(1), db)
    const found = await withTenant(A, (tx) => tx.select().from(table).where(eq(table.id, bRow!.id)), db)
    expect(found).toHaveLength(0)
  })

  it('returns zero rows without tenant context, also after a context was used on the same connection', async () => {
    await withTenant(A, (tx) => tx.select().from(table), db)
    const rows = await db.select().from(table)
    expect(rows).toHaveLength(0)
  })
})

describe('memberships writes', () => {
  it("cannot update or delete another tenant's membership", async () => {
    const updated = await withTenant(
      A,
      (tx) => tx.update(memberships).set({ role: 'viewer' }).where(eq(memberships.tenantId, B.tenantId)).returning(),
      db,
    )
    expect(updated).toHaveLength(0)
    const deleted = await withTenant(
      A,
      (tx) => tx.delete(memberships).where(eq(memberships.tenantId, B.tenantId)).returning(),
      db,
    )
    expect(deleted).toHaveLength(0)
  })

  it("rejects inserting a row with another tenant's id", async () => {
    const userId = randomUUID()
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, name: 'X' })
    expect(
      await pgErrorOf(withTenant(A, (tx) => tx.insert(memberships).values({ tenantId: B.tenantId, userId, role: 'member' }), db)),
    ).toMatch(/row-level security/)
  })
})

describe('audit_log', () => {
  it('rejects writing an audit row into another tenant', async () => {
    expect(
      await pgErrorOf(withTenant(A, (tx) => audit(tx, { ...A, tenantId: B.tenantId }, { action: 'create', entityType: 'x' }), db)),
    ).toMatch(/row-level security/)
  })

  it('is append-only for the app role', async () => {
    expect(await pgErrorOf(withTenant(A, (tx) => tx.update(auditLog).set({ action: 'tampered' }), db))).toMatch(/permission denied/)
    expect(await pgErrorOf(withTenant(A, (tx) => tx.delete(auditLog), db))).toMatch(/permission denied/)
  })
})

describe('tenants', () => {
  it('shows the current tenant and none of the others', async () => {
    const rows = await withTenant(A, (tx) => tx.select().from(tenants), db)
    expect(rows.map((r) => r.id)).toEqual([A.tenantId])
  })

  it('cannot rename another tenant', async () => {
    const updated = await withTenant(
      A,
      (tx) => tx.update(tenants).set({ name: 'Hacked' }).where(eq(tenants.id, B.tenantId)).returning(),
      db,
    )
    expect(updated).toHaveLength(0)
  })

  it('lets a user list only the workspaces they are a member of (workspace switcher)', async () => {
    // Make A's user a member of a second tenant C.
    const C = await createTenantWithUser('owner', db)
    await withTenant(C, (tx) => tx.insert(memberships).values({ tenantId: C.tenantId, userId: A.userId, role: 'member' }), db)

    const visible = await withUser(A.userId, (tx) => tx.select({ id: tenants.id }).from(tenants), db)
    expect(visible.map((t) => t.id).sort()).toEqual([A.tenantId, C.tenantId].sort())
    expect(visible.map((t) => t.id)).not.toContain(B.tenantId)
  })
})

describe('app role', () => {
  it('is not a superuser and cannot bypass RLS', async () => {
    const [role] = await db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    )
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false })
  })
})
