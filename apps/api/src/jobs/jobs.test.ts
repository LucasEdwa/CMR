import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import { createBoss, enqueue, workTenant } from './boss.js'
import { QUEUES } from './queues.js'
import { audit } from '../db/audit.js'
import { auditLog } from '../db/schema.js'
import { withTenant } from '../db/tenant.js'
import { createTenantWithUser } from '../test/factories.js'

let boss: PgBoss

// Connects as app_user, so this also proves the migrate script granted the pg-boss rights.
beforeAll(async () => {
  boss = createBoss(process.env.DATABASE_URL!)
  await boss.start()
})
afterAll(() => boss.stop({ graceful: false }))

describe('background jobs', () => {
  it('run with the tenant context of the job', async () => {
    const A = await createTenantWithUser()
    const B = await createTenantWithUser()

    await workTenant(
      boss,
      QUEUES.ping,
      async (tx, data) => {
        await audit(tx, { tenantId: data.tenantId, userId: data.userId, role: 'member' }, { action: 'ping', entityType: 'system' })
      },
      { pollingIntervalSeconds: 0.5 },
    )
    await enqueue(boss, QUEUES.ping, { tenantId: A.tenantId, userId: A.userId })

    const pingsIn = (ctx: typeof A) =>
      withTenant(ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.action, 'ping'))))

    await expect.poll(() => pingsIn(A).then((r) => r.length), { timeout: 10_000, interval: 250 }).toBe(1)
    expect(await pingsIn(B)).toHaveLength(0)
  })
})
