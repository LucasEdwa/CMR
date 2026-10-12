import { z } from 'zod'
import { PAGE_SIZES } from './crm.js'

// Record types that have their own page, so the audit log can link to them.
export const AUDIT_ENTITY_TYPES = ['contact', 'company', 'deal', 'activity', 'task', 'membership', 'invitation', 'workspace', 'pipeline', 'picklist', 'contacts', 'companies', 'deals'] as const

export const auditQuerySchema = z.object({
  actor: z.uuid().optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => (PAGE_SIZES as readonly number[]).includes(n))
    .default(50),
})

export const auditEntrySchema = z.object({
  id: z.uuid(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.uuid().nullable(),
  // Current name of the record, when it still exists.
  entityName: z.string().nullable(),
  actor: z.string().nullable(),
  createdAt: z.string(),
  changes: z.array(z.object({ field: z.string(), before: z.unknown(), after: z.unknown() })),
})
export type AuditEntry = z.infer<typeof auditEntrySchema>

export const auditPageSchema = z.object({
  items: z.array(auditEntrySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
})
