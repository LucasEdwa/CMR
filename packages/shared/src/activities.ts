import { z } from 'zod'

export const RECORD_TYPES = ['contact', 'company', 'deal'] as const
export type RecordType = (typeof RECORD_TYPES)[number]
export const recordRefSchema = z.object({ type: z.enum(RECORD_TYPES), id: z.uuid() })
export type RecordRef = z.infer<typeof recordRefSchema>

export const ACTIVITY_TYPES = ['note', 'call', 'meeting', 'email'] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]
export const CALL_OUTCOMES = ['connected', 'no_answer', 'voicemail', 'busy', 'wrong_number'] as const
export const EMAIL_DIRECTIONS = ['outbound', 'inbound'] as const

export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const NOTIFICATION_TYPES = ['task_assigned', 'task_reminder', 'mention'] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

// Hour of the due date (assignee's own timezone) when the reminder email goes out.
export const REMINDER_HOUR = 8

// ---- rich text -------------------------------------------------------------------
// Notes are stored as editor JSON (ProseMirror/Tiptap), never as HTML. Only the node and mark
// types below are accepted; unknown attributes are stripped. The web app renders this JSON
// with React elements, so stored notes can never inject markup.

export type RichMark = { type: 'bold' | 'italic' | 'strike' }
export type RichNode =
  | { type: 'text'; text: string; marks?: RichMark[] }
  | { type: 'mention'; attrs: { id: string; label: string } }
  | { type: 'hardBreak' }
  | { type: 'paragraph' | 'bulletList' | 'orderedList' | 'listItem'; content?: RichNode[] }
export type RichDoc = { type: 'doc'; content: RichNode[] }

const markSchema = z.object({ type: z.enum(['bold', 'italic', 'strike']) })

export const richNodeSchema: z.ZodType<RichNode> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal('text'), text: z.string().min(1).max(20_000), marks: z.array(markSchema).max(3).optional() }),
    z.object({ type: z.literal('mention'), attrs: z.object({ id: z.uuid(), label: z.string().max(100) }) }),
    z.object({ type: z.literal('hardBreak') }),
    z.object({
      type: z.enum(['paragraph', 'bulletList', 'orderedList', 'listItem']),
      content: z.array(richNodeSchema).max(500).optional(),
    }),
  ]),
)

export const MAX_RICH_TEXT_CHARS = 20_000
// Real notes nest a few levels (a list in a list). The limit keeps validation cheap.
export const MAX_RICH_TEXT_DEPTH = 12

function depthOf(value: unknown, depth = 0): number {
  if (depth > MAX_RICH_TEXT_DEPTH) return depth
  const content = (value as { content?: unknown })?.content
  return Array.isArray(content) ? Math.max(depth, ...content.map((c) => depthOf(c, depth + 1))) : depth
}

export const richDocSchema = z
  // Checked before the recursive schema runs, so a deeply nested document is rejected cheaply.
  .custom<unknown>((v) => depthOf(v) <= MAX_RICH_TEXT_DEPTH, 'too_deep')
  .pipe(z.object({ type: z.literal('doc'), content: z.array(richNodeSchema).max(500) }))
  .refine((doc) => richTextToPlain(doc).length <= MAX_RICH_TEXT_CHARS, 'too_long')

function walk(nodes: RichNode[] | undefined, visit: (node: RichNode) => void) {
  for (const node of nodes ?? []) {
    visit(node)
    if ('content' in node) walk(node.content, visit)
  }
}

// Plain text for previews, search and emails. Mentions become "@Name".
export function richTextToPlain(doc: RichDoc | null | undefined): string {
  if (!doc) return ''
  const blocks: string[] = []
  const inline = (nodes: RichNode[] | undefined): string =>
    (nodes ?? [])
      .map((n) => (n.type === 'text' ? n.text : n.type === 'mention' ? `@${n.attrs.label}` : n.type === 'hardBreak' ? '\n' : ''))
      .join('')
  const block = (nodes: RichNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === 'paragraph') blocks.push(inline(n.content))
      else if ('content' in n) block(n.content)
    }
  }
  block(doc.content)
  return blocks.join('\n').trim()
}

export function mentionedUserIds(doc: RichDoc | null | undefined): string[] {
  const ids = new Set<string>()
  walk(doc?.content, (n) => {
    if (n.type === 'mention') ids.add(n.attrs.id)
  })
  return [...ids]
}

export const plainToRichDoc = (text: string): RichDoc => ({
  type: 'doc',
  content: text
    .split('\n')
    .map((line) => ({ type: 'paragraph' as const, ...(line ? { content: [{ type: 'text' as const, text: line }] } : {}) })),
})

// ---- activities --------------------------------------------------------------------

const ref = z.object({ id: z.uuid(), name: z.string() })
const subject = z.string().trim().max(200)
const optionalNullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional()

const activityFields = {
  subject: optionalNullable(subject),
  body: optionalNullable(richDocSchema),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  durationMinutes: optionalNullable(z.number().int().min(0).max(24 * 60)),
  outcome: optionalNullable(z.enum(CALL_OUTCOMES)),
  direction: optionalNullable(z.enum(EMAIL_DIRECTIONS)),
}

// A note needs text; a call, meeting or email needs a subject or text.
const hasContent = (a: { type: ActivityType; subject?: string | null; body?: RichDoc | null }) =>
  !!richTextToPlain(a.body) || (a.type !== 'note' && !!a.subject)

// Logged against one record; the API links it to related records too (a deal's contacts and company,
// a contact's company) so it shows on all of their timelines.
export const createActivitySchema = z
  .object({ type: z.enum(ACTIVITY_TYPES), record: recordRefSchema, ...activityFields })
  .refine(hasContent, { message: 'content_required', path: ['body'] })
export type CreateActivityInput = z.input<typeof createActivitySchema>

export const updateActivitySchema = z.object({ ...activityFields, pinned: z.boolean().optional() })
export type UpdateActivityInput = z.input<typeof updateActivitySchema>

export const activitySchema = z.object({
  id: z.uuid(),
  type: z.enum(ACTIVITY_TYPES),
  subject: z.string().nullable(),
  body: richDocSchema.nullable(),
  occurredAt: z.string(),
  durationMinutes: z.number().int().nullable(),
  outcome: z.enum(CALL_OUTCOMES).nullable(),
  direction: z.enum(EMAIL_DIRECTIONS).nullable(),
  pinned: z.boolean(),
  author: ref.nullable(),
  links: z.object({ contacts: z.array(ref), companies: z.array(ref), deals: z.array(ref) }),
  // Author or an owner/admin.
  canEdit: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Activity = z.infer<typeof activitySchema>

const many = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined || v === '' ? [] : Array.isArray(v) ? v : [String(v)].flatMap((s) => s.split(','))), z.array(item))

export const timelineQuerySchema = z.object({
  type: z.enum(RECORD_TYPES),
  id: z.uuid(),
  types: many(z.enum(ACTIVITY_TYPES)),
  // Opaque cursor from the previous page.
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})

export const timelineSchema = z.object({
  // Pinned notes, only on the first page.
  pinned: z.array(activitySchema),
  items: z.array(activitySchema),
  nextCursor: z.string().nullable(),
})
export type Timeline = z.infer<typeof timelineSchema>

// ---- tasks ---------------------------------------------------------------------------

const dueTime = z
  .union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal('')])
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()

const taskFields = {
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).nullable().optional(),
  dueDate: z.iso.date(),
  // Wall-clock time in the assignee's timezone; empty means "any time that day".
  dueTime,
  priority: z.enum(TASK_PRIORITIES),
  assigneeUserId: z.uuid(),
  record: recordRefSchema.nullable().optional(),
}

export const createTaskSchema = z.object({
  ...taskFields,
  priority: taskFields.priority.default('normal'),
  // Missing assignee means the creator.
  assigneeUserId: taskFields.assigneeUserId.optional(),
})
export type CreateTaskInput = z.input<typeof createTaskSchema>

export const updateTaskSchema = z.object({ ...taskFields, completed: z.boolean() }).partial()
export type UpdateTaskInput = z.input<typeof updateTaskSchema>

export const taskRecordSchema = z.object({ type: z.enum(RECORD_TYPES), id: z.uuid(), name: z.string() })

export const taskSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  notes: z.string().nullable(),
  dueDate: z.string(),
  dueTime: z.string().nullable(),
  // The moment the task becomes overdue (end of the day for tasks without a time).
  dueAt: z.string(),
  overdue: z.boolean(),
  priority: z.enum(TASK_PRIORITIES),
  assignee: ref.nullable(),
  record: taskRecordSchema.nullable(),
  completedAt: z.string().nullable(),
  completedBy: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
})
export type Task = z.infer<typeof taskSchema>

// "Today" and "overdue" follow the assignee's timezone.
export const myTasksSchema = z.object({
  overdue: z.array(taskSchema),
  today: z.array(taskSchema),
  upcoming: z.array(taskSchema),
  // Most recently completed first.
  done: z.array(taskSchema),
})
export type MyTasks = z.infer<typeof myTasksSchema>

export const myTasksQuerySchema = z.object({
  assignee: z.union([z.uuid(), z.literal('me')]).default('me'),
})

export const recordTasksQuerySchema = z.object({ type: z.enum(RECORD_TYPES), id: z.uuid() })

// ---- notifications --------------------------------------------------------------------

export const notificationSchema = z.object({
  id: z.uuid(),
  type: z.enum(NOTIFICATION_TYPES),
  actor: z.string().nullable(),
  // Task title or a short excerpt of the note.
  title: z.string(),
  record: taskRecordSchema.nullable(),
  taskId: z.uuid().nullable(),
  activityId: z.uuid().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
})
export type Notification = z.infer<typeof notificationSchema>

export const notificationsSchema = z.object({ items: z.array(notificationSchema), unread: z.number().int() })
export type Notifications = z.infer<typeof notificationsSchema>
