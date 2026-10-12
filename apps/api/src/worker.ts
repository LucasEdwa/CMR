import { env } from './env.js'
import { createBoss, workTenant } from './jobs/boss.js'
import { QUEUES } from './jobs/queues.js'
import { audit } from './db/audit.js'

// Runs inside the API process when RUN_WORKER=true. Split into its own service when load needs it.
export async function startWorker() {
  const boss = createBoss(env.DATABASE_URL)
  await boss.start()

  await workTenant(boss, QUEUES.ping, async (tx, data) => {
    await audit(tx, { tenantId: data.tenantId, userId: data.userId, role: 'member' }, {
      action: 'ping',
      entityType: 'system',
    })
  })

  return boss
}
