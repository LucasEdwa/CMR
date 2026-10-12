// Every queue the app uses. Queues are created by the migrate script (owner role),
// so the app (app_user) never needs DDL rights on the pgboss schema.
export const QUEUES = {
  // Sprint 0: proves jobs run end to end with tenant context.
  ping: 'system.ping',
  // Transactional email. Not tenant-scoped: signup and password reset happen outside a workspace.
  email: 'email.send',
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

// Job payloads always carry the tenant and the acting user; handlers run inside withTenant.
export type TenantJob<T = Record<string, unknown>> = T & {
  tenantId: string
  userId: string
}
