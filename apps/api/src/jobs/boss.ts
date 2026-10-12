import { PgBoss } from 'pg-boss'
import type { Role } from '@crm/shared'
import { withTenant } from '../db/tenant.js'
import type { Tx } from '../db/client.js'
import type { QueueName, TenantJob } from './queues.js'

export const BOSS_SCHEMA = 'pgboss'

export function createBoss(connectionString: string, options: { migrate?: boolean } = {}) {
  const boss = new PgBoss({
    connectionString,
    schema: BOSS_SCHEMA,
    migrate: options.migrate ?? false,
    max: 4,
  })
  boss.on('error', (err) => console.error('[pg-boss]', err))
  return boss
}

export async function enqueue<T extends Record<string, unknown>>(
  boss: PgBoss,
  queue: QueueName,
  data: TenantJob<T>,
  options: { singletonKey?: string; startAfter?: Date | number } = {},
) {
  return boss.send(queue, data, options)
}

// Workers resolve the role from the job (system jobs act as the user who caused them).
export async function workTenant<T extends Record<string, unknown>>(
  boss: PgBoss,
  queue: QueueName,
  handler: (tx: Tx, data: TenantJob<T>) => Promise<void>,
  options: { role?: Role; pollingIntervalSeconds?: number } = {},
) {
  return boss.work<TenantJob<T>>(
    queue,
    { pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 },
    async (jobs) => {
      for (const job of jobs) {
        await withTenant(
          { tenantId: job.data.tenantId, userId: job.data.userId, role: options.role ?? 'member' },
          (tx) => handler(tx, job.data),
        )
      }
    },
  )
}
