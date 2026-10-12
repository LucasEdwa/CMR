import { z } from 'zod'
import { CURRENCIES } from './auth.js'
import { PAGE_SIZES } from './crm.js'

export const DEAL_STATUSES = ['open', 'won', 'lost'] as const
export type DealStatus = (typeof DEAL_STATUSES)[number]

export const PICKLIST_KINDS = ['lead_source', 'lost_reason', 'industry'] as const
export type PicklistKind = (typeof PICKLIST_KINDS)[number]

// Built-in picklist values. Their labels come from translations until a workspace renames them.
export const DEFAULT_PICKLISTS: Record<PicklistKind, readonly string[]> = {
  lead_source: ['website', 'referral', 'event', 'cold_outreach', 'social', 'partner', 'other'],
  lost_reason: ['price', 'competitor', 'timing', 'no_budget', 'no_response', 'other'],
  industry: ['it', 'construction', 'retail', 'manufacturing', 'consulting', 'real_estate', 'transport', 'healthcare', 'education', 'other'],
}

export const DEFAULT_STAGES = {
  sv: [['Ny lead', 10], ['Kvalificerad', 25], ['Möte bokat', 40], ['Offert skickad', 60], ['Förhandling', 80]],
  en: [['New lead', 10], ['Qualified', 25], ['Meeting booked', 40], ['Proposal sent', 60], ['Negotiation', 80]],
} as const satisfies Record<string, ReadonlyArray<readonly [string, number]>>

export const DEFAULT_STALE_DAYS = 14

// ---- pipelines -----------------------------------------------------------------

export const stageSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  position: z.number().int(),
  probability: z.number().int(),
})
export type Stage = z.infer<typeof stageSchema>

export const pipelineSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  position: z.number().int(),
  stages: z.array(stageSchema),
  openDeals: z.number().int(),
})
export type Pipeline = z.infer<typeof pipelineSchema>

export const pipelinesResponseSchema = z.object({ pipelines: z.array(pipelineSchema), staleDays: z.number().int() })

export const createPipelineSchema = z.object({ name: z.string().trim().min(1).max(60) })
export const updatePipelineSchema = z.object({ name: z.string().trim().min(1).max(60) })

// Full list of stages in order. Stages without id are new; stages left out are removed.
export const saveStagesSchema = z.object({
  stages: z
    .array(
      z.object({
        id: z.uuid().optional(),
        name: z.string().trim().min(1).max(60),
        probability: z.number().int().min(0).max(100),
      }),
    )
    .min(1)
    .max(20),
})
export type SaveStagesInput = z.infer<typeof saveStagesSchema>

export const pipelineSettingsSchema = z.object({ staleDays: z.number().int().min(1).max(365) })

// ---- deals -----------------------------------------------------------------------

const optionalDate = z
  .union([z.iso.date(), z.literal('')])
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()

const dealFields = {
  name: z.string().trim().min(1).max(200),
  // Integer minor units (öre). Never a float.
  value: z.number().int().min(0).max(1_000_000_000_000),
  currency: z.enum(CURRENCIES),
  pipelineId: z.uuid(),
  stageId: z.uuid(),
  expectedCloseDate: optionalDate,
  ownerUserId: z.uuid().nullable().optional(),
  companyId: z.uuid().nullable().optional(),
  contactIds: z.array(z.uuid()).max(50),
}

export const createDealSchema = z.object({
  ...dealFields,
  value: dealFields.value.default(0),
  currency: dealFields.currency.optional(),
  // Missing pipeline/stage means the default pipeline's first stage.
  pipelineId: dealFields.pipelineId.optional(),
  stageId: dealFields.stageId.optional(),
  contactIds: dealFields.contactIds.default([]),
})
export type CreateDealInput = z.input<typeof createDealSchema>

export const updateDealSchema = z.object(dealFields).omit({ pipelineId: true, stageId: true }).partial()
export type UpdateDealInput = z.input<typeof updateDealSchema>

// Move to a stage (any pipeline) at an index among that stage's open deals.
export const moveDealSchema = z.object({ stageId: z.uuid(), index: z.number().int().min(0).optional() })
export const loseDealSchema = z.object({ reason: z.string().trim().min(1).max(60), note: z.string().trim().max(500).optional() })

const ref = z.object({ id: z.uuid(), name: z.string() })

export const dealSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  value: z.number().int(),
  currency: z.enum(CURRENCIES),
  status: z.enum(DEAL_STATUSES),
  pipeline: ref,
  stage: ref.extend({ probability: z.number().int() }),
  lostReason: z.string().nullable(),
  lostNote: z.string().nullable(),
  closedAt: z.string().nullable(),
  expectedCloseDate: z.string().nullable(),
  owner: ref.nullable(),
  company: ref.nullable(),
  contacts: z.array(ref),
  stale: z.boolean(),
  // Earliest open task on the deal (shown on the board card).
  nextTask: z.object({ dueDate: z.string(), dueTime: z.string().nullable(), overdue: z.boolean() }).nullable(),
  lastActivityAt: z.string(),
  stageEnteredAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Deal = z.infer<typeof dealSchema>

export const stageHistorySchema = z.object({
  stage: z.string(),
  pipeline: z.string(),
  enteredAt: z.string(),
  leftAt: z.string().nullable(),
  // Milliseconds; for the current stage, up to now.
  duration: z.number().int(),
  by: z.string().nullable(),
})
export const dealDetailSchema = dealSchema.extend({ history: z.array(stageHistorySchema) })
export type DealDetail = z.infer<typeof dealDetailSchema>

export const moneyTotalSchema = z.object({ currency: z.enum(CURRENCIES), sum: z.number().int() })

export const boardSchema = z.object({
  pipelineId: z.uuid(),
  columns: z.array(
    z.object({
      stage: stageSchema,
      count: z.number().int(),
      totals: z.array(moneyTotalSchema),
      deals: z.array(dealSchema),
    }),
  ),
})
export type Board = z.infer<typeof boardSchema>

const many = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined || v === '' ? [] : Array.isArray(v) ? v : [v]), z.array(item))

export const DEAL_SORTS = ['name', 'value', 'expectedCloseDate', 'stage', 'createdAt', 'updatedAt'] as const
export const dealListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  pipelineId: z.uuid().optional(),
  status: many(z.enum(DEAL_STATUSES)),
  owner: many(z.union([z.uuid(), z.literal('me'), z.literal('none')])),
  stage: many(z.uuid()),
  companyId: z.uuid().optional(),
  contactId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => (PAGE_SIZES as readonly number[]).includes(n))
    .default(25),
  sort: z.enum(DEAL_SORTS).default('updatedAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
})

// ---- picklists ---------------------------------------------------------------------

export const picklistItemSchema = z.object({ key: z.string(), label: z.string().nullable() })
export type PicklistItem = z.infer<typeof picklistItemSchema>
export const picklistsSchema = z.record(z.enum(PICKLIST_KINDS), z.array(picklistItemSchema))
export type Picklists = z.infer<typeof picklistsSchema>

// Full ordered list. Items with a key keep it (built-ins stay translatable); new items get one.
export const savePicklistSchema = z.object({
  items: z
    .array(z.object({ key: z.string().trim().max(60).optional(), label: z.string().trim().max(60).nullable().optional() }))
    .max(50)
    .refine((items) => items.every((i) => i.key || i.label), 'label_required'),
})
