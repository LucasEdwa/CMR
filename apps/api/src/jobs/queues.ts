// Every queue the app uses. Queues are created by the migrate script (owner role),
// so the app (app_user) never needs DDL rights on the pgboss schema.
export const QUEUES = {
  // Sprint 0: proves jobs run end to end with tenant context.
  ping: 'system.ping',
  // Transactional email. Not tenant-scoped: signup and password reset happen outside a workspace.
  email: 'email.send',
  // Erases one soft-deleted record once it has been in Trash for 30 days.
  purgeRecord: 'records.purge',
  // Sends one task's reminder (email + notification) on the morning of its due date.
  taskReminder: 'tasks.reminder',
  // Runs one CSV import (Sprint 5).
  importRun: 'imports.run',
  // Erases a workspace whose deletion grace period is over.
  workspaceDelete: 'workspaces.delete',
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

// Job payloads always carry the tenant and the acting user; handlers run inside withTenant.
export type TenantJob<T = Record<string, unknown>> = T & {
  tenantId: string
  userId: string
}
