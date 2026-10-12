import { sql } from 'drizzle-orm'
import { bigint, boolean, check, date, doublePrecision, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, time, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import {
  ACTIVITY_TYPES,
  CALL_OUTCOMES,
  COMPANY_SIZES,
  CONSENT_BASES,
  DEAL_STATUSES,
  DEFAULT_STALE_DAYS,
  EMAIL_DIRECTIONS,
  IMPORT_MODES,
  IMPORT_OBJECTS,
  IMPORT_STATUSES,
  RECORD_TYPES,
  LIFECYCLE_STAGES,
  NOTIFICATION_TYPES,
  PICKLIST_KINDS,
  ROLES,
  SAVED_VIEW_OBJECTS,
  TASK_PRIORITIES,
  type ImportError,
  type RichDoc,
} from '@crm/shared'

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
  // An open deal with no activity for this many days is shown as stale.
  staleDealDays: integer('stale_deal_days').notNull().default(DEFAULT_STALE_DAYS),
  // Members and viewers only see contacts, companies and deals they own (enforced in RLS).
  ownRecordsOnly: boolean('own_records_only').notNull().default(false),
  // Everyone in the workspace must use two-factor login (set by owners and admins).
  requireTwoFactor: boolean('require_two_factor').notNull().default(false),
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
    // IANA name; null means the workspace timezone. Drives "today" and reminder times.
    timezone: text('timezone'),
    // Set by Better Auth's two-factor plugin once an authenticator app is confirmed.
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
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
// TOTP secrets and backup codes (Better Auth encrypts both with BETTER_AUTH_SECRET).
export const twoFactors = pgTable(
  'two_factors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (t) => [index('two_factors_user_idx').on(t.userId), index('two_factors_secret_idx').on(t.secret)],
)

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

// ---------------------------------------------------------------------------
// Deals and pipelines (Sprint 3)

export const dealStatus = pgEnum('deal_status', DEAL_STATUSES)
export const picklistKind = pgEnum('picklist_kind', PICKLIST_KINDS)

export const pipelines = pgTable(
  'pipelines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.tenantId, t.id), index('pipelines_tenant_idx').on(t.tenantId, t.position)],
)

export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    pipelineId: uuid('pipeline_id').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    probability: integer('probability').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    // A stage always belongs to a pipeline of the same tenant; deleting a pipeline deletes its stages.
    foreignKey({ columns: [t.tenantId, t.pipelineId], foreignColumns: [pipelines.tenantId, pipelines.id] }).onDelete('cascade'),
    index('pipeline_stages_pipeline_idx').on(t.tenantId, t.pipelineId, t.position),
  ],
)

export const deals = pgTable(
  'deals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Integer minor units (öre for SEK).
    value: bigint('value', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull().default('SEK'),
    pipelineId: uuid('pipeline_id').notNull(),
    stageId: uuid('stage_id').notNull(),
    // Order within the stage column on the board.
    position: doublePrecision('position').notNull().default(0),
    status: dealStatus('status').notNull().default('open'),
    lostReason: text('lost_reason'),
    lostNote: text('lost_note'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    expectedCloseDate: date('expected_close_date'),
    companyId: uuid('company_id'),
    // Bumped by changes now and by logged activities from Sprint 4; drives the stale marker.
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true }).notNull().defaultNow(),
    ...recordMeta,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.pipelineId], foreignColumns: [pipelines.tenantId, pipelines.id] }),
    foreignKey({ columns: [t.tenantId, t.stageId], foreignColumns: [pipelineStages.tenantId, pipelineStages.id] }),
    foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id] }),
    index('deals_board_idx').on(t.tenantId, t.pipelineId, t.stageId, t.position).where(sql`${t.deletedAt} is null and ${t.status} = 'open'`),
    index('deals_tenant_updated_idx').on(t.tenantId, t.updatedAt.desc()),
    index('deals_tenant_company_idx').on(t.tenantId, t.companyId),
    index('deals_tenant_owner_idx').on(t.tenantId, t.ownerUserId),
    index('deals_search_trgm_idx').using('gin', sql`${t.searchText} gin_trgm_ops`),
  ],
)

export const dealContacts = pgTable(
  'deal_contacts',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').notNull(),
    contactId: uuid('contact_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.dealId, t.contactId] }),
    foreignKey({ columns: [t.tenantId, t.dealId], foreignColumns: [deals.tenantId, deals.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }).onDelete('cascade'),
    index('deal_contacts_contact_idx').on(t.tenantId, t.contactId),
  ],
)

// One row per stage a deal has been in; left_at is null for the current one.
export const dealStageHistory = pgTable(
  'deal_stage_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').notNull(),
    // Names are copied so history survives renamed or deleted stages.
    stageId: uuid('stage_id'),
    stageName: text('stage_name').notNull(),
    pipelineName: text('pipeline_name').notNull(),
    enteredAt: timestamp('entered_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
    changedByUserId: uuid('changed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.dealId], foreignColumns: [deals.tenantId, deals.id] }).onDelete('cascade'),
    index('deal_stage_history_deal_idx').on(t.tenantId, t.dealId, t.enteredAt),
  ],
)

export const picklistItems = pgTable(
  'picklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    kind: picklistKind('kind').notNull(),
    // Stable value stored on records. Built-in keys are translated; label overrides the translation.
    key: text('key').notNull(),
    label: text('label'),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('picklist_items_key_idx').on(t.tenantId, t.kind, t.key)],
)

// ---------------------------------------------------------------------------
// Activities, tasks and notifications (Sprint 4)

export const activityType = pgEnum('activity_type', ACTIVITY_TYPES)
export const callOutcome = pgEnum('call_outcome', CALL_OUTCOMES)
export const emailDirection = pgEnum('email_direction', EMAIL_DIRECTIONS)
export const taskPriority = pgEnum('task_priority', TASK_PRIORITIES)
export const notificationType = pgEnum('notification_type', NOTIFICATION_TYPES)

export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    type: activityType('type').notNull(),
    subject: text('subject'),
    // Editor JSON, validated against the shared allowlist; body_text is its plain-text form.
    body: jsonb('body').$type<RichDoc>(),
    bodyText: text('body_text').notNull().default(''),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    durationMinutes: integer('duration_minutes'),
    outcome: callOutcome('outcome'),
    direction: emailDirection('direction'),
    pinned: boolean('pinned').notNull().default(false),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [unique().on(t.tenantId, t.id), index('activities_tenant_occurred_idx').on(t.tenantId, t.occurredAt.desc())],
)

// Which records an activity shows on. Exactly one of the three ids is set per row.
export const activityLinks = pgTable(
  'activity_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id').notNull(),
    contactId: uuid('contact_id'),
    companyId: uuid('company_id'),
    dealId: uuid('deal_id'),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.activityId], foreignColumns: [activities.tenantId, activities.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.dealId], foreignColumns: [deals.tenantId, deals.id] }).onDelete('cascade'),
    check('activity_links_one_record', sql`num_nonnulls(${t.contactId}, ${t.companyId}, ${t.dealId}) = 1`),
    index('activity_links_activity_idx').on(t.tenantId, t.activityId),
    uniqueIndex('activity_links_contact_idx').on(t.tenantId, t.contactId, t.activityId).where(sql`${t.contactId} is not null`),
    uniqueIndex('activity_links_company_idx').on(t.tenantId, t.companyId, t.activityId).where(sql`${t.companyId} is not null`),
    uniqueIndex('activity_links_deal_idx').on(t.tenantId, t.dealId, t.activityId).where(sql`${t.dealId} is not null`),
  ],
)

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    notes: text('notes'),
    // Calendar date and optional wall-clock time as entered, in the assignee's timezone.
    dueDate: date('due_date').notNull(),
    dueTime: time('due_time'),
    // When the task becomes overdue: due_time, or the end of due_date, in the assignee's timezone.
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    priority: taskPriority('priority').notNull().default('normal'),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
    // At most one related record. Tasks go with their record when it is erased.
    contactId: uuid('contact_id'),
    companyId: uuid('company_id'),
    dealId: uuid('deal_id'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedByUserId: uuid('completed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    // The due date the reminder email was sent for; a new due date gets a new reminder.
    reminderSentFor: date('reminder_sent_for'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.dealId], foreignColumns: [deals.tenantId, deals.id] }).onDelete('cascade'),
    check('tasks_one_record', sql`num_nonnulls(${t.contactId}, ${t.companyId}, ${t.dealId}) <= 1`),
    index('tasks_assignee_open_idx').on(t.tenantId, t.assigneeUserId, t.dueAt).where(sql`${t.completedAt} is null`),
    index('tasks_assignee_done_idx').on(t.tenantId, t.assigneeUserId, t.completedAt.desc()).where(sql`${t.completedAt} is not null`),
    index('tasks_contact_idx').on(t.tenantId, t.contactId),
    index('tasks_company_idx').on(t.tenantId, t.companyId),
    index('tasks_deal_idx').on(t.tenantId, t.dealId, t.dueAt),
  ],
)

// Only the recipient can read, mark or delete a notification (restrictive RLS policies);
// anyone in the workspace can create one for a member.
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationType('type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    // Snapshot for display and the link: { title, record: {type,id,name} | null, taskId?, activityId? }.
    data: jsonb('data').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.tenantId, t.userId, t.createdAt.desc())],
)

// ---------------------------------------------------------------------------
// Imports and recently viewed records (Sprint 5)

export const importObject = pgEnum('import_object', IMPORT_OBJECTS)
export const importStatus = pgEnum('import_status', IMPORT_STATUSES)
export const importMode = pgEnum('import_mode', IMPORT_MODES)
export const recordType = pgEnum('record_type', RECORD_TYPES)

export const imports = pgTable(
  'imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    object: importObject('object').notNull(),
    fileName: text('file_name').notNull(),
    mode: importMode('mode').notNull(),
    status: importStatus('status').notNull().default('queued'),
    header: jsonb('header').$type<string[]>().notNull(),
    mapping: jsonb('mapping').$type<Array<string | null>>().notNull(),
    // The uploaded file, kept only until the import has run.
    source: text('source'),
    total: integer('total').notNull().default(0),
    processed: integer('processed').notNull().default(0),
    created: integer('created').notNull().default(0),
    updated: integer('updated').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    // At most MAX_IMPORT_ERRORS rows, with their original values for the error report.
    errors: jsonb('errors').$type<ImportError[]>().notNull().default([]),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
  },
  (t) => [unique().on(t.tenantId, t.id), index('imports_tenant_created_idx').on(t.tenantId, t.createdAt.desc())],
)

// Every record an import created or changed, so the whole import can be undone.
export const importRecords = pgTable(
  'import_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    importId: uuid('import_id').notNull(),
    recordType: recordType('record_type').notNull(),
    recordId: uuid('record_id').notNull(),
    // 'created', or 'updated' with the values the import overwrote.
    action: text('action').notNull(),
    before: jsonb('before').$type<Record<string, unknown>>(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.importId], foreignColumns: [imports.tenantId, imports.id] }).onDelete('cascade'),
    index('import_records_import_idx').on(t.tenantId, t.importId),
  ],
)

// The last records each user opened, for the search palette. Only visible to that user.
export const recentViews = pgTable(
  'recent_views',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recordType: recordType('record_type').notNull(),
    recordId: uuid('record_id').notNull(),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId, t.recordType, t.recordId] }),
    index('recent_views_user_idx').on(t.tenantId, t.userId, t.viewedAt.desc()),
  ],
)

// ---------------------------------------------------------------------------
// Account security log: logins, password and 2FA changes. Per user, not per workspace, so it has
// no tenant_id; RLS lets each user read only their own events (see the migration).
export const securityEvents = pgTable(
  'security_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('security_events_user_idx').on(t.userId, t.createdAt.desc())],
)
