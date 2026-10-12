import { z } from 'zod'
import { roleSchema } from './roles.js'
import { normalizeOrgNumber, SLUG_PATTERN } from './validation.js'

export const LOCALES = ['sv', 'en'] as const
export const localeSchema = z.enum(LOCALES)
export type Locale = z.infer<typeof localeSchema>

export const isTimezone = (tz: string) => tz === 'UTC' || Intl.supportedValuesOf('timeZone').includes(tz)

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email())
export const passwordSchema = z.string().min(8).max(128)

export const signupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: passwordSchema,
  locale: localeSchema.default('sv'),
})
export type SignupInput = z.infer<typeof signupSchema>

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
})

// Accepts null too: forms submit the already-transformed value.
export const orgNumberSchema = z
  .string()
  .trim()
  .nullable()
  .transform((v, ctx) => {
    if (v === null || v === '') return null
    const normalized = normalizeOrgNumber(v)
    if (!normalized) ctx.addIssue({ code: 'custom', message: 'invalid_org_number' })
    return normalized
  })

export const DATE_FORMATS = ['yyyy-MM-dd', 'dd/MM/yyyy', 'd MMM yyyy'] as const
export const CURRENCIES = ['SEK', 'EUR', 'NOK', 'DKK', 'USD'] as const

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN, 'invalid_slug'),
  orgNumber: orgNumberSchema.optional(),
})
export type CreateWorkspaceInput = z.input<typeof createWorkspaceSchema>

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  orgNumber: orgNumberSchema.optional(),
  currency: z.enum(CURRENCIES).optional(),
  timezone: z.string().refine(isTimezone, 'invalid_timezone').optional(),
  dateFormat: z.enum(DATE_FORMATS).optional(),
})
export type UpdateWorkspaceInput = z.input<typeof updateWorkspaceSchema>

export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  orgNumber: z.string().nullable(),
  currency: z.enum(CURRENCIES),
  timezone: z.string(),
  dateFormat: z.enum(DATE_FORMATS),
})
export type Workspace = z.infer<typeof workspaceSchema>

export const meSchema = z.object({
  user: z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    locale: localeSchema,
    // Null means "use the workspace timezone".
    timezone: z.string().nullable(),
  }),
  workspaces: z.array(z.object({ id: z.uuid(), name: z.string(), slug: z.string(), role: roleSchema })),
  activeWorkspaceId: z.uuid().nullable(),
})
export type Me = z.infer<typeof meSchema>

export const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  locale: localeSchema.optional(),
  timezone: z.string().refine(isTimezone, 'invalid_timezone').nullable().optional(),
})

export const inviteSchema = z.object({
  email: emailSchema,
  role: roleSchema,
})
export type InviteInput = z.infer<typeof inviteSchema>

export const memberSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  joinedAt: z.string(),
})
export type Member = z.infer<typeof memberSchema>

export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: roleSchema,
  expiresAt: z.string(),
  invitedBy: z.string().nullable(),
})
export type Invitation = z.infer<typeof invitationSchema>

// Public view of an invitation link, shown before accepting.
export const invitationPreviewSchema = z.object({
  workspaceName: z.string(),
  email: z.string(),
  role: roleSchema,
  invitedBy: z.string().nullable(),
  accountExists: z.boolean(),
})
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>

export const acceptInvitationSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  password: passwordSchema.optional(),
  locale: localeSchema.optional(),
})

export const updateMemberSchema = z.object({ role: roleSchema })
