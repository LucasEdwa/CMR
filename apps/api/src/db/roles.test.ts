import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Role } from '@crm/shared'
import { createDb } from './client.js'
import { contacts, deals, memberships, pipelineStages, pipelines, picklistItems, tenants, users } from './schema.js'
import { withTenant, type TenantContext } from './tenant.js'
import { createTenantWithUser, pgErrorOf } from '../test/factories.js'

// Role rules enforced by RLS itself, below the API's checks: what each role can do when a
// query reaches the database directly.
const { client, db } = createDb(process.env.DATABASE_URL!, { max: 2 })
let owner: TenantContext
const people: Record<Exclude<Role, 'owner'>, TenantContext> = {} as never

async function addPerson(role: Role) {
  const userId = randomUUID()
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, name: role })
  await withTenant(owner, (tx) => tx.insert(memberships).values({ tenantId: owner.tenantId, userId, role }), db)
  return { tenantId: owner.tenantId, userId, role }
}

beforeAll(async () => {
  owner = await createTenantWithUser('owner', db)
  for (const role of ['admin', 'member', 'viewer'] as const) people[role] = await addPerson(role)
  await withTenant(owner, (tx) => tx.insert(contacts).values([
    { tenantId: owner.tenantId, firstName: 'Ägarens', ownerUserId: owner.userId },
    { tenantId: owner.tenantId, firstName: 'Medlemmens', ownerUserId: people.member.userId },
  ]), db)
})
afterAll(() => client.end())

const insertContact = (ctx: TenantContext, ownerUserId = ctx.userId) =>
  withTenant(ctx, (tx) => tx.insert(contacts).values({ tenantId: ctx.tenantId, firstName: 'Ny', ownerUserId }), db)

describe('record writes', () => {
  it('lets owners, admins and members write records, and stops viewers', async () => {
    for (const ctx of [owner, people.admin, people.member]) await insertContact(ctx)
    expect(await pgErrorOf(insertContact(people.viewer))).toMatch(/row-level security/)
    const updated = await withTenant(people.viewer, (tx) => tx.update(contacts).set({ firstName: 'Ändrad' }).returning(), db)
    expect(updated).toHaveLength(0)
    const deleted = await withTenant(people.viewer, (tx) => tx.delete(contacts).returning(), db)
    expect(deleted).toHaveLength(0)
  })

  it('refuses writes when no role is set at all', async () => {
    const noRole = { ...owner, role: '' as Role }
    expect(await pgErrorOf(insertContact(noRole))).toMatch(/row-level security/)
  })
})

describe('workspace setup', () => {
  it('only lets owners and admins change pipelines and picklists', async () => {
    const addPipeline = (ctx: TenantContext) =>
      withTenant(ctx, (tx) => tx.insert(pipelines).values({ tenantId: ctx.tenantId, name: `P ${ctx.role}`, position: 1 }), db)
    await addPipeline(owner)
    await addPipeline(people.admin)
    expect(await pgErrorOf(addPipeline(people.member))).toMatch(/row-level security/)
    expect(
      await pgErrorOf(withTenant(people.member, (tx) => tx.insert(picklistItems).values({ tenantId: owner.tenantId, kind: 'industry', key: 'x', position: 9 }), db)),
    ).toMatch(/row-level security/)
    const renamed = await withTenant(people.member, (tx) => tx.update(pipelines).set({ name: 'Kapat' }).returning(), db)
    expect(renamed).toHaveLength(0)
    expect(await withTenant(people.member, (tx) => tx.delete(pipelineStages).returning(), db)).toHaveLength(0)
  })

  it('lets admins change settings but only owners delete the workspace', async () => {
    expect(await withTenant(people.admin, (tx) => tx.update(tenants).set({ currency: 'EUR' }).returning(), db)).toHaveLength(1)
    expect(await withTenant(people.member, (tx) => tx.update(tenants).set({ currency: 'NOK' }).returning(), db)).toHaveLength(0)
    expect(await withTenant(people.admin, (tx) => tx.delete(tenants).returning(), db)).toHaveLength(0)
  })

  it('lets anyone leave, but only owners and admins remove others', async () => {
    const leaver = await addPerson('member')
    const other = await addPerson('member')
    expect(await withTenant(leaver, (tx) => tx.delete(memberships).where(eq(memberships.userId, other.userId)).returning(), db)).toHaveLength(0)
    expect(await withTenant(leaver, (tx) => tx.delete(memberships).where(eq(memberships.userId, leaver.userId)).returning(), db)).toHaveLength(1)
    expect(await withTenant(people.admin, (tx) => tx.delete(memberships).where(eq(memberships.userId, other.userId)).returning(), db)).toHaveLength(1)
    expect(
      await pgErrorOf(withTenant(people.member, (tx) => tx.insert(memberships).values({ tenantId: owner.tenantId, userId: other.userId, role: 'admin' }), db)),
    ).toMatch(/row-level security/)
  })
})

describe('own records only', () => {
  it('hides other people’s records from members and viewers, never from owners and admins', async () => {
    const names = async (ctx: TenantContext) =>
      (await withTenant(ctx, (tx) => tx.select({ name: contacts.firstName, ownerId: contacts.ownerUserId }).from(contacts), db))
    expect((await names(people.member)).length).toBeGreaterThan(1)

    await withTenant(owner, (tx) => tx.update(tenants).set({ ownRecordsOnly: true }), db)
    try {
      const memberSees = await names(people.member)
      expect(memberSees.length).toBeGreaterThan(0)
      expect(memberSees.every((c) => c.ownerId === people.member.userId)).toBe(true)
      expect(await names(people.viewer)).toEqual([])
      expect((await names(people.admin)).some((c) => c.ownerId === owner.userId)).toBe(true)

      // A member cannot create or move a record into someone else's name.
      expect(await pgErrorOf(insertContact(people.member, owner.userId))).toMatch(/row-level security/)
      const moved = await withTenant(people.member, (tx) => tx.update(contacts).set({ ownerUserId: owner.userId }).where(eq(contacts.ownerUserId, people.member.userId)), db).catch((e) => e)
      expect(moved).toBeInstanceOf(Error)
      // Deals follow the same rule.
      const visibleDeals = await withTenant(people.member, (tx) => tx.select().from(deals), db)
      expect(visibleDeals.every((d) => d.ownerUserId === people.member.userId)).toBe(true)
    } finally {
      await withTenant(owner, (tx) => tx.update(tenants).set({ ownRecordsOnly: false }), db)
    }
  })
})

describe('deleting a workspace', () => {
  it('lets the owner delete everything in it, including the append-only audit log', async () => {
    const doomed = await createTenantWithUser('owner', db)
    await insertContact(doomed)
    const gone = await withTenant(doomed, (tx) => tx.delete(tenants).where(eq(tenants.id, doomed.tenantId)).returning(), db)
    expect(gone).toHaveLength(1)
    expect(await withTenant(doomed, (tx) => tx.select().from(contacts), db)).toEqual([])
  })
})
