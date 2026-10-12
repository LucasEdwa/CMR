import { sql } from 'drizzle-orm'
import { bigint, boolean, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { COMPANY_SIZES, CONSENT_BASES, LIFECYCLE_STAGES, ROLES, SAVED_VIEW_OBJECTS } from '@crm/shared'

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
  dateFormat: text('date_format').notNull().default('yyyy-MM-dd'),
  ...timestamps,
})

// Auth tables (users, sessions, accounts, verifications, rate_limits) are global: a user can belong
// to several tenants and login happens before a tenant is chosen. Property names follow Better Auth's
// model fields; only the API reads these tables.
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    locale: text('locale').notNull().default('sv'),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: text('token').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    // The workspace this session is working in. Validated against memberships on every request.
    activeTenantId: uuid('active_tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    ...timestamps,
  },
  (t) => [index('accounts_user_idx').on(t.userId), unique().on(t.providerId, t.accountId)],
)

export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
)

export const rateLimits = pgTable('rate_limits', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
})

// Failed logins per IP + email; cleared on a successful login.
export const loginFailures = pgTable('login_failures', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
})

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

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: membershipRole('role').notNull(),
    // sha256 of the secret part of the link; the link itself is never stored.
    tokenHash: text('token_hash').notNull().unique(),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique().on(t.tenantId, t.id), index('invitations_tenant_email_idx').on(t.tenantId, sql`lower(${t.email})`)],
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

// ---------------------------------------------------------------------------
// CRM records (Sprint 2). Every table is tenant-scoped with forced RLS.
// Child rows reference parents with composite (tenant_id, id) foreign keys so a row
// can never point into another tenant.

export const lifecycleStage = pgEnum('lifecycle_stage', LIFECYCLE_STAGES)
export const consentBasis = pgEnum('consent_basis', CONSENT_BASES)
export const companySize = pgEnum('company_size', COMPANY_SIZES)
export const savedViewObject = pgEnum('saved_view_object', SAVED_VIEW_OBJECTS)

const address = {
  street: text('street'),
  postalCode: text('postal_code'),
  city: text('city'),
  country: text('country').notNull().default('SE'),
}

const recordMeta = {
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  // Lowercased name, email, phone etc. for trigram search; maintained by the service layer.
  searchText: text('search_text').notNull().default(''),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
  // Soft delete: rows stay in Trash for 30 days, then a job erases them.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedByUserId: uuid('deleted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
}

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    orgNumber: text('org_number'),
    vatNumber: text('vat_number'),
    domain: text('domain'),
    industry: text('industry'),
    size: companySize('size'),
    phone: text('phone'),
    ...address,
    ...recordMeta,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    // One live company per org number in a workspace.
    uniqueIndex('companies_tenant_org_number_idx')
      .on(t.tenantId, t.orgNumber)
      .where(sql`${t.deletedAt} is null and ${t.orgNumber} is not null`),
    index('companies_tenant_name_idx').on(t.tenantId, sql`lower(${t.name}) collate "sv-x-icu"`),
    index('companies_tenant_domain_idx').on(t.tenantId, t.domain),
    index('companies_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('companies_tenant_owner_idx').on(t.tenantId, t.ownerUserId),
    index('companies_search_trgm_idx').using('gin', sql`${t.searchText} gin_trgm_ops`),
  ],
)

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull().default(''),
    // Stored lowercased; unique among live contacts in a workspace.
    email: text('email'),
    phone: text('phone'),
    mobilePhone: text('mobile_phone'),
    title: text('title'),
    companyId: uuid('company_id'),
    lifecycleStage: lifecycleStage('lifecycle_stage').notNull().default('lead'),
    leadSource: text('lead_source'),
    marketingConsent: boolean('marketing_consent').notNull().default(false),
    consentBasis: consentBasis('consent_basis'),
    consentUpdatedAt: timestamp('consent_updated_at', { withTimezone: true }),
    ...address,
    ...recordMeta,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id] }),
    uniqueIndex('contacts_tenant_email_idx').on(t.tenantId, t.email).where(sql`${t.deletedAt} is null`),
    index('contacts_tenant_name_idx').on(
      t.tenantId,
      sql`lower(${t.lastName}) collate "sv-x-icu"`,
      sql`lower(${t.firstName}) collate "sv-x-icu"`,
    ),
    index('contacts_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('contacts_tenant_owner_idx').on(t.tenantId, t.ownerUserId),
    index('contacts_tenant_company_idx').on(t.tenantId, t.companyId),
    index('contacts_search_trgm_idx').using('gin', sql`${t.searchText} gin_trgm_ops`),
  ],
)

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.tenantId, t.id), uniqueIndex('tags_tenant_name_idx').on(t.tenantId, sql`lower(${t.name})`)],
)

export const contactTags = pgTable(
  'contact_tags',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').notNull(),
    tagId: uuid('tag_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.contactId, t.tagId] }),
    foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.tagId], foreignColumns: [tags.tenantId, tags.id] }).onDelete('cascade'),
    index('contact_tags_tag_idx').on(t.tenantId, t.tagId),
  ],
)

export const companyTags = pgTable(
  'company_tags',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').notNull(),
    tagId: uuid('tag_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.companyId, t.tagId] }),
    foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.tagId], foreignColumns: [tags.tenantId, tags.id] }).onDelete('cascade'),
    index('company_tags_tag_idx').on(t.tenantId, t.tagId),
  ],
)

// Saved list views. Private views are only visible to their owner (enforced in RLS too).
export const savedViews = pgTable(
  'saved_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    object: savedViewObject('object').notNull(),
    name: text('name').notNull(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    shared: boolean('shared').notNull().default(false),
    config: jsonb('config').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.tenantId, t.id), index('saved_views_tenant_object_idx').on(t.tenantId, t.object)],
)
