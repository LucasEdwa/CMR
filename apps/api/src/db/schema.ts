import { sql } from 'drizzle-orm'
import { index, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { ROLES } from '@crm/shared'

// Every table with a tenant_id column needs RLS enabled + forced and a policy.
// Policies live in hand-written SQL migrations (drizzle/*_rls*.sql); the RLS meta-test enforces this.

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

export const membershipRole = pgEnum('membership_role', ROLES)

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  orgNumber: text('org_number'),
  currency: text('currency').notNull().default('SEK'),
  timezone: text('timezone').notNull().default('Europe/Stockholm'),
  ...timestamps,
})

// Global table: a user can belong to several tenants, so users carry no tenant_id.
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    locale: text('locale').notNull().default('sv'),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`)],
)

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull(),
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    unique().on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId, t.tenantId),
  ],
)

// Append-only: app_user gets SELECT and INSERT only.
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    diff: jsonb('diff'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('audit_log_tenant_entity_idx').on(t.tenantId, t.entityType, t.entityId),
  ],
)
