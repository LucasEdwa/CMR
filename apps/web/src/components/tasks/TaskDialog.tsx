import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { TASK_PRIORITIES, type RecordRef, type Task } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/Field'
import { NativeSelect } from '@/components/NativeSelect'
import { useMe, useTimezone } from '@/hooks/useMe'
import { activityApi, localDate, useActivityMutation } from '@/lib/activities'
import { useMembers } from '@/lib/crm'
import { errorMessage } from '@/lib/errors'
import { describedBy, fieldError } from '@/lib/form'

const schema = z.object({
  title: z.string().trim().min(1).max(200),
  dueDate: z.iso.date(),
  dueTime: z.string(),
  priority: z.enum(TASK_PRIORITIES),
  assigneeUserId: z.uuid(),
  notes: z.string().trim().max(2000),
})
type Values = z.infer<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  // New task about this record, or an existing task to edit.
  record?: (RecordRef & { name: string }) | null
  task?: Task
}

export function TaskDialog({ open, onOpenChange, record, task }: Props) {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const tz = useTimezone()
  const members = useMembers()
  const form = useForm<Values>({ resolver: zodResolver(schema) })
  const { errors } = form.formState
  const save = useActivityMutation((values: Values) => {
    const body = { ...values, notes: values.notes || null }
    return task ? activityApi.updateTask(task.id, body) : activityApi.createTask({ ...body, record: record ? { type: record.type, id: record.id } : null })
  })

  useEffect(() => {
    if (!open) return
    form.reset({
      title: task?.title ?? '',
      dueDate: task?.dueDate ?? localDate(tz),
      dueTime: task?.dueTime ?? '',
      priority: task?.priority ?? 'normal',
      assigneeUserId: task?.assignee?.id ?? me?.user.id ?? '',
      notes: task?.notes ?? '',
    })
  }, [open, task, me, tz, form])

  const about = task?.record ?? record
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? t('tasks.edit') : t('tasks.new')}</DialogTitle>
          {about && <p className="text-muted-foreground text-sm">{t('tasks.about', { name: about.name })}</p>}
        </DialogHeader>
        <form
          id="task-form"
          className="grid gap-4"
          noValidate
          onSubmit={form.handleSubmit((values) =>
            save.mutate(values, {
              onSuccess: () => {
                toast.success(task ? t('common.saved') : t('tasks.created'))
                onOpenChange(false)
              },
              onError: (err) => toast.error(errorMessage(t, err)),
            }),
          )}
        >
          <Field id="task-title" label={t('tasks.titleLabel')} error={fieldError(t, errors.title)}>
            <Input id="task-title" autoFocus aria-invalid={!!errors.title} {...describedBy('task-title', !!errors.title)} {...form.register('title')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="task-date" label={t('tasks.dueDate')} error={fieldError(t, errors.dueDate)}>
              <Input id="task-date" type="date" aria-invalid={!!errors.dueDate} {...form.register('dueDate')} />
            </Field>
            <Field id="task-time" label={t('tasks.dueTime')} hint={t('tasks.timeHint')}>
              <Input id="task-time" type="time" {...describedBy('task-time', true)} {...form.register('dueTime')} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="task-assignee" label={t('tasks.assignee')}>
              <NativeSelect id="task-assignee" {...form.register('assigneeUserId')}>
                {members.data?.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.userId === me?.user.id ? t('tasks.meName', { name: m.name }) : m.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="task-priority" label={t('tasks.priority')}>
              <NativeSelect id="task-priority" {...form.register('priority')}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`tasks.priorities.${p}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field id="task-notes" label={t('tasks.notes')}>
            <textarea
              id="task-notes"
              rows={3}
              maxLength={2000}
              className="border-input focus-visible:ring-ring/50 rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
              {...form.register('notes')}
            />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="task-form" disabled={save.isPending}>
            {task ? t('common.save') : t('common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
