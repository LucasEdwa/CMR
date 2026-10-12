import { env } from './env.js'
import { createBoss, workTenant } from './jobs/boss.js'
import { QUEUES } from './jobs/queues.js'
import { audit } from './db/audit.js'
import { deliver, useEmailQueue } from './email/send.js'
import type { EmailMessage } from './email/templates.js'
import { purgeRecord, usePurgeQueue, type PurgeJob } from './services/purge.js'
import { sendTaskReminder, useReminderQueue, type ReminderJob } from './services/tasks.js'
import { runImport, useImportQueue, type ImportJob } from './services/imports.js'
import { deleteIfDue, useWorkspaceDeleteQueue, type WorkspaceDeleteJob } from './services/workspaceDeletion.js'

// Runs inside the API process when RUN_WORKER=true. Split into its own service when load needs it.
export async function startWorker() {
  const boss = createBoss(env.DATABASE_URL)
  await boss.start()

  await workTenant(boss, QUEUES.ping, async (tx, data) => {
    await audit(tx, { tenantId: data.tenantId, userId: data.userId, role: 'system' }, {
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

  // Runs as the assignee, so the notification and the task lookup stay inside their workspace.
  await workTenant<ReminderJob>(boss, QUEUES.taskReminder, async (tx, data) => {
    await sendTaskReminder(tx, data)
  })
  useReminderQueue(boss)

  // Imports manage their own transactions (one per chunk of rows), so they skip workTenant.
  await boss.work<ImportJob>(QUEUES.importRun, async (jobs) => {
    for (const job of jobs) await runImport(job.data)
  })
  useImportQueue(boss)

  // Workspace deletions after their grace period; the job re-checks that nobody cancelled.
  await boss.work<WorkspaceDeleteJob>(QUEUES.workspaceDelete, async (jobs) => {
    for (const job of jobs) await deleteIfDue(job.data)
  })
  useWorkspaceDeleteQueue(boss)

  return boss
}
