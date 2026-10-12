import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createDb } from './client.js'
import {
  activities,
  activityLinks,
  auditLog,
  importRecords,
  imports,
  recentViews,
  companies,
  contacts,
  deals,
  invitations,
  memberships,
  notifications,
  pipelineStages,
  pipelines,
  picklistItems,
  savedViews,
  tags,
  tasks,
  tenants,
  users,
} from './schema.js'
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
  for (const ctx of [A, B]) {
    await withTenant(
      ctx,
      (tx) =>
        tx.insert(invitations).values({
          tenantId: ctx.tenantId,
          email: `${randomUUID()}@test.local`,
          role: 'member',
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 60_000),
        }),
      db,
    )
    await withTenant(
      ctx,
      async (tx) => {
        const [company] = await tx.insert(companies).values({ tenantId: ctx.tenantId, name: 'Isolerat AB' }).returning()
        await tx.insert(contacts).values({ tenantId: ctx.tenantId, firstName: 'Iso', companyId: company!.id })
        await tx.insert(tags).values({ tenantId: ctx.tenantId, name: `tag-${randomUUID()}` })
        const [pipeline] = await tx.insert(pipelines).values({ tenantId: ctx.tenantId, name: 'Iso', position: 0 }).returning()
        const [stage] = await tx
          .insert(pipelineStages)
          .values({ tenantId: ctx.tenantId, pipelineId: pipeline!.id, name: 'S', position: 0 })
          .returning()
        const [deal] = await tx
          .insert(deals)
          .values({ tenantId: ctx.tenantId, name: 'Iso', pipelineId: pipeline!.id, stageId: stage!.id })
          .returning()
        const [activity] = await tx.insert(activities).values({ tenantId: ctx.tenantId, type: 'note', bodyText: 'Iso' }).returning()
        await tx.insert(activityLinks).values({ tenantId: ctx.tenantId, activityId: activity!.id, dealId: deal!.id })
        await tx.insert(tasks).values({ tenantId: ctx.tenantId, title: 'Iso', dueDate: '2026-11-09', dueAt: new Date(), dealId: deal!.id })
        await tx.insert(notifications).values({ tenantId: ctx.tenantId, userId: ctx.userId, type: 'mention', data: { title: 'Iso' } })
        const [imp] = await tx
          .insert(imports)
          .values({ tenantId: ctx.tenantId, object: 'contacts', fileName: 'iso.csv', mode: 'skip', header: [], mapping: [] })
          .returning()
        await tx.insert(importRecords).values({ tenantId: ctx.tenantId, importId: imp!.id, recordType: 'deal', recordId: deal!.id, action: 'created' })
        await tx.insert(recentViews).values({ tenantId: ctx.tenantId, userId: ctx.userId, recordType: 'deal', recordId: deal!.id })
        await tx.insert(picklistItems).values({ tenantId: ctx.tenantId, kind: 'lost_reason', key: 'iso', position: 0 })
        await tx.insert(savedViews).values({
          tenantId: ctx.tenantId,
          object: 'contacts',
          name: 'Delad',
          shared: true,
          ownerUserId: ctx.userId,
          config: { query: {}, columns: [] },
        })
      },
      db,
    )
  }
})

afterAll(() => client.end())

const tenantTables = [
  { name: 'memberships', table: memberships },
  { name: 'audit_log', table: auditLog },
  { name: 'invitations', table: invitations },
  { name: 'companies', table: companies },
  { name: 'contacts', table: contacts },
  { name: 'tags', table: tags },
  { name: 'saved_views', table: savedViews },
  { name: 'pipelines', table: pipelines },
  { name: 'pipeline_stages', table: pipelineStages },
  { name: 'deals', table: deals },
  { name: 'activities', table: activities },
  { name: 'activity_links', table: activityLinks },
  { name: 'tasks', table: tasks },
  { name: 'notifications', table: notifications },
  { name: 'imports', table: imports },
  { name: 'import_records', table: importRecords },
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

describe('composite foreign keys', () => {
  it("cannot link a contact to another tenant's company, even by id", async () => {
    const [bCompany] = await withTenant(B, (tx) => tx.select().from(companies).limit(1), db)
    expect(
      await pgErrorOf(
        withTenant(A, (tx) => tx.insert(contacts).values({ tenantId: A.tenantId, firstName: 'X', companyId: bCompany!.id }), db),
      ),
    ).toMatch(/foreign key/)
  })
})

describe('notifications', () => {
  it('are only visible to their recipient, while workspace colleagues can create them', async () => {
    const colleague = { ...A, userId: randomUUID(), role: 'member' as const }
    await db.insert(users).values({ id: colleague.userId, email: `${colleague.userId}@test.local`, name: 'Colleague' })
    await withTenant(A, (tx) => tx.insert(memberships).values({ tenantId: A.tenantId, userId: colleague.userId, role: 'member' }), db)

    const seen = await withTenant(colleague, (tx) => tx.select().from(notifications), db)
    expect(seen).toHaveLength(0)
    await withTenant(colleague, (tx) => tx.insert(notifications).values({ tenantId: A.tenantId, userId: A.userId, type: 'mention', data: { title: 'Hej' } }), db)
    const mine = await withTenant(A, (tx) => tx.select().from(notifications), db)
    expect(mine.map((n) => (n.data as { title: string }).title)).toContain('Hej')

    const marked = await withTenant(colleague, (tx) => tx.update(notifications).set({ readAt: new Date() }).returning(), db)
    expect(marked).toHaveLength(0)
    const removed = await withTenant(colleague, (tx) => tx.delete(notifications).returning(), db)
    expect(removed).toHaveLength(0)
  })

  it('cannot be sent to someone outside the workspace', async () => {
    expect(
      await pgErrorOf(
        withTenant(A, (tx) => tx.insert(notifications).values({ tenantId: A.tenantId, userId: B.userId, type: 'mention', data: { title: 'x' } }), db),
      ),
    ).toMatch(/row-level security/)
  })

  it('can only be marked read, never rewritten', async () => {
    await withTenant(A, (tx) => tx.update(notifications).set({ readAt: new Date() }), db)
    expect(await pgErrorOf(withTenant(A, (tx) => tx.update(notifications).set({ data: { title: 'changed' } }), db))).toMatch(
      /permission denied/,
    )
  })
})

describe('recent_views', () => {
  it('are only visible to the user who viewed the records', async () => {
    const colleague = { ...A, userId: randomUUID(), role: 'member' as const }
    await db.insert(users).values({ id: colleague.userId, email: `${colleague.userId}@test.local`, name: 'Colleague' })
    await withTenant(A, (tx) => tx.insert(memberships).values({ tenantId: A.tenantId, userId: colleague.userId, role: 'member' }), db)
    expect(await withTenant(A, (tx) => tx.select().from(recentViews), db)).toHaveLength(1)
    expect(await withTenant(colleague, (tx) => tx.select().from(recentViews), db)).toHaveLength(0)
    expect(await withTenant(B, (tx) => tx.select().from(recentViews).where(eq(recentViews.userId, A.userId)), db)).toHaveLength(0)
    expect(
      await pgErrorOf(
        withTenant(colleague, (tx) => tx.insert(recentViews).values({ tenantId: A.tenantId, userId: A.userId, recordType: 'deal', recordId: randomUUID() }), db),
      ),
    ).toMatch(/row-level security/)
  })
})

describe('activity links', () => {
  it("cannot attach an activity to another tenant's deal", async () => {
    const [bDeal] = await withTenant(B, (tx) => tx.select().from(deals).limit(1), db)
    const [aActivity] = await withTenant(A, (tx) => tx.select().from(activities).limit(1), db)
    expect(
      await pgErrorOf(
        withTenant(A, (tx) => tx.insert(activityLinks).values({ tenantId: A.tenantId, activityId: aActivity!.id, dealId: bDeal!.id }), db),
      ),
    ).toMatch(/foreign key/)
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

  it('inside a workspace, shows only that workspace, even to a user who is in several', async () => {
    const C = await createTenantWithUser('owner', db)
    await withTenant(C, (tx) => tx.insert(memberships).values({ tenantId: C.tenantId, userId: B.userId, role: 'member' }), db)
    const inB = await withTenant(B, (tx) => tx.select().from(memberships).where(eq(memberships.userId, B.userId)), db)
    expect(inB.map((m) => m.tenantId)).toEqual([B.tenantId])
    expect((await withTenant(B, (tx) => tx.select({ id: tenants.id }).from(tenants), db)).map((t) => t.id)).toEqual([B.tenantId])
    // Without a workspace (login, switcher) the user sees all of their own memberships.
    const all = await withUser(B.userId, (tx) => tx.select().from(memberships), db)
    expect(all.map((m) => m.tenantId).sort()).toEqual([B.tenantId, C.tenantId].sort())
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
