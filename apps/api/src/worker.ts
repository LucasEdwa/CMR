import { env } from './env.js'
import { createBoss, workTenant } from './jobs/boss.js'
import { QUEUES } from './jobs/queues.js'
import { audit } from './db/audit.js'
import { deliver, useEmailQueue } from './email/send.js'
import type { EmailMessage } from './email/templates.js'
import { purgeRecord, usePurgeQueue, type PurgeJob } from './services/purge.js'

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

  await boss.work<EmailMessage>(QUEUES.email, async (jobs) => {
    for (const job of jobs) await deliver(job.data)
  })
  useEmailQueue(boss)

  await workTenant<PurgeJob>(boss, QUEUES.purgeRecord, async (tx, data) => {
    await purgeRecord(tx, data)
  })
  usePurgeQueue(boss)

  return boss
}
