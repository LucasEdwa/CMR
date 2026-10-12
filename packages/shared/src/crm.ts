import { z } from 'zod'
import { normalizeOrgNumber } from './validation.js'

export const LIFECYCLE_STAGES = ['lead', 'mql', 'sql', 'opportunity', 'customer', 'evangelist', 'other'] as const
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number]
export const CONSENT_BASES = ['consent', 'legitimate_interest', 'contract'] as const
export const COMPANY_SIZES = ['1-9', '10-49', '50-249', '250+'] as const
export const SAVED_VIEW_OBJECTS = ['contacts', 'companies', 'deals'] as const
export type SavedViewObject = (typeof SAVED_VIEW_OBJECTS)[number]
// Built-in lead sources (see DEFAULT_PICKLISTS); workspaces can edit the list in settings.
export const LEAD_SOURCES = ['website', 'referral', 'event', 'cold_outreach', 'social', 'partner', 'other'] as const

export const TRASH_RETENTION_DAYS = 30
export const PAGE_SIZES = [25, 50, 100] as const

// Webmail domains never identify a company, so they never suggest one.
export const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.se', 'outlook.com', 'outlook.se', 'live.com', 'live.se',
  'msn.com', 'icloud.com', 'me.com', 'mac.com', 'yahoo.com', 'yahoo.se', 'proton.me', 'protonmail.com',
  'telia.com', 'spray.se', 'bredband.net', 'comhem.se', 'tele2.se', 'gmx.com', 'aol.com',
])

// ---- validation helpers ----------------------------------------------------

/** "" and null both mean "no value". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()

export const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => (v === '' ? null : v))
  .pipe(z.email('invalid_email').nullable())
  .nullable()
  .optional()

export function normalizeDomain(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]!
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null
}

export const emailDomain = (email: string) => email.split('@')[1]?.toLowerCase() ?? null

// EU VAT number. Swedish ones are SE + org number (10 digits, Luhn) + 01.
export function normalizeVatNumber(input: string): string | null {
  const v = input.replace(/[\s.-]/g, '').toUpperCase()
  if (!/^[A-Z]{2}[0-9A-Z]{2,13}$/.test(v)) return null
  if (v.startsWith('SE')) {
    const m = /^SE(\d{10})01$/.exec(v)
    return m && normalizeOrgNumber(m[1]!) ? v : null
  }
  return v
}

const normalized = (fn: (v: string) => string | null, message: string) =>
  z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return undefined
      if (v === null || v === '') return null
      const out = fn(v)
      if (!out) ctx.addIssue({ code: 'custom', message })
      return out
    })

const addressFields = {
  street: optionalText(200),
  postalCode: optionalText(20),
  city: optionalText(100),
  country: z.string().trim().toUpperCase().length(2).optional(),
}

const tagsField = z.array(z.string().trim().min(1).max(40)).max(20)

// ---- contacts ----------------------------------------------------------------

const contactFields = {
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100),
  email: optionalEmailSchema,
  phone: optionalText(40),
  mobilePhone: optionalText(40),
  title: optionalText(100),
  companyId: z.uuid().nullable().optional(),
  ownerUserId: z.uuid().nullable().optional(),
  lifecycleStage: z.enum(LIFECYCLE_STAGES),
  leadSource: optionalText(60),
  marketingConsent: z.boolean(),
  consentBasis: z.enum(CONSENT_BASES).nullable().optional(),
  ...addressFields,
  tags: tagsField,
}

export const createContactSchema = z.object({
  ...contactFields,
  lastName: contactFields.lastName.default(''),
  lifecycleStage: contactFields.lifecycleStage.default('lead'),
  marketingConsent: contactFields.marketingConsent.default(false),
  tags: tagsField.default([]),
})
export type CreateContactInput = z.input<typeof createContactSchema>

export const updateContactSchema = z.object(contactFields).partial()
export type UpdateContactInput = z.input<typeof updateContactSchema>

const ref = z.object({ id: z.uuid(), name: z.string() })

export const contactSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  mobilePhone: z.string().nullable(),
  title: z.string().nullable(),
  company: ref.nullable(),
  owner: ref.nullable(),
  lifecycleStage: z.enum(LIFECYCLE_STAGES),
  leadSource: z.string().nullable(),
  marketingConsent: z.boolean(),
  consentBasis: z.enum(CONSENT_BASES).nullable(),
  consentUpdatedAt: z.string().nullable(),
  street: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Contact = z.infer<typeof contactSchema>

// ---- companies ---------------------------------------------------------------

const companyFields = {
  name: z.string().trim().min(1).max(200),
  orgNumber: normalized(normalizeOrgNumber, 'invalid_org_number'),
  vatNumber: normalized(normalizeVatNumber, 'invalid_vat_number'),
  domain: normalized(normalizeDomain, 'invalid_domain'),
  industry: optionalText(100),
  size: z.enum(COMPANY_SIZES).nullable().optional(),
  phone: optionalText(40),
  ownerUserId: z.uuid().nullable().optional(),
  ...addressFields,
  tags: tagsField,
}

export const createCompanySchema = z.object({ ...companyFields, tags: tagsField.default([]) })
export type CreateCompanyInput = z.input<typeof createCompanySchema>
export const updateCompanySchema = z.object(companyFields).partial()
export type UpdateCompanyInput = z.input<typeof updateCompanySchema>

export const companySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  orgNumber: z.string().nullable(),
  vatNumber: z.string().nullable(),
  domain: z.string().nullable(),
  industry: z.string().nullable(),
  size: z.enum(COMPANY_SIZES).nullable(),
  phone: z.string().nullable(),
  street: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string(),
  owner: ref.nullable(),
  tags: z.array(z.string()),
  contactCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Company = z.infer<typeof companySchema>

// ---- list queries ------------------------------------------------------------

// Query strings send one value as a string and several as an array.
const many = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined || v === '' ? [] : Array.isArray(v) ? v : [v]), z.array(item))

const listBase = {
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => (PAGE_SIZES as readonly number[]).includes(n))
    .default(25),
  dir: z.enum(['asc', 'desc']).default('asc'),
  owner: many(z.union([z.uuid(), z.literal('me'), z.literal('none')])),
  tag: many(z.string().min(1).max(40)),
  createdFrom: z.iso.date().optional(),
  createdTo: z.iso.date().optional(),
}

export const CONTACT_SORTS = ['name', 'email', 'company', 'lifecycleStage', 'createdAt', 'updatedAt'] as const
export const contactListQuerySchema = z.object({
  ...listBase,
  sort: z.enum(CONTACT_SORTS).default('name'),
  stage: many(z.enum(LIFECYCLE_STAGES)),
  source: many(z.string().min(1).max(60)),
  companyId: z.uuid().optional(),
})
export type ContactListQuery = z.input<typeof contactListQuerySchema>

export const COMPANY_SORTS = ['name', 'city', 'contactCount', 'createdAt', 'updatedAt'] as const
export const companyListQuerySchema = z.object({
  ...listBase,
  sort: z.enum(COMPANY_SORTS).default('name'),
  size: many(z.enum(COMPANY_SIZES)),
})
export type CompanyListQuery = z.input<typeof companyListQuerySchema>

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() })

// ---- saved views, tags, trash ------------------------------------------------

export const savedViewConfigSchema = z.object({
  query: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  columns: z.array(z.string()).max(30),
})
export type SavedViewConfig = z.infer<typeof savedViewConfigSchema>

export const createSavedViewSchema = z.object({
  object: z.enum(SAVED_VIEW_OBJECTS),
  name: z.string().trim().min(1).max(60),
  shared: z.boolean().default(false),
  config: savedViewConfigSchema,
})
export const updateSavedViewSchema = createSavedViewSchema.omit({ object: true }).partial()

export const savedViewSchema = z.object({
  id: z.uuid(),
  object: z.enum(SAVED_VIEW_OBJECTS),
  name: z.string(),
  shared: z.boolean(),
  mine: z.boolean(),
  ownerName: z.string(),
  config: savedViewConfigSchema,
})
export type SavedView = z.infer<typeof savedViewSchema>

export const tagSchema = z.object({ id: z.uuid(), name: z.string(), usage: z.number().int() })

export const TRASH_TYPES = ['contact', 'company', 'deal'] as const
export const trashItemSchema = z.object({
  type: z.enum(TRASH_TYPES),
  id: z.uuid(),
  name: z.string(),
  deletedAt: z.string(),
  deletedBy: z.string().nullable(),
  purgeAt: z.string(),
})
export type TrashItem = z.infer<typeof trashItemSchema>

export const companySuggestionSchema = z.object({ company: ref.nullable() })
