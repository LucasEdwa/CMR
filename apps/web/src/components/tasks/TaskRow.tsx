import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, Building2, Handshake, Pencil, Trash2, User } from 'lucide-react'
import type { Task } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/records/ConfirmDialog'
import { activityApi, recordPath, useActivityMutation } from '@/lib/activities'
import { errorMessage } from '@/lib/errors'
import { formatDueDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { TaskDialog } from './TaskDialog'

const RECORD_ICONS = { contact: User, company: Building2, deal: Handshake }

type Props = { task: Task; canWrite: boolean; showRecord?: boolean; showAssignee?: boolean }

export function TaskRow({ task, canWrite, showRecord = true, showAssignee = false }: Props) {
  const { t, i18n } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const act = useActivityMutation((fn: () => Promise<unknown>) => fn())
  const done = !!task.completedAt
  const RecordIcon = task.record ? RECORD_ICONS[task.record.type] : null

  const toggle = (completed: boolean) =>
    act.mutate(() => activityApi.updateTask(task.id, { completed }), {
      onSuccess: () => toast.success(completed ? t('tasks.completed') : t('tasks.reopened')),
      onError: (err) => toast.error(errorMessage(t, err)),
    })

  return (
    <li className="flex items-start gap-3 py-2.5" data-testid="task-row">
      <Checkbox
        className="mt-0.5"
        checked={done}
        disabled={!canWrite || act.isPending}
        onCheckedChange={(v) => toggle(v === true)}
        aria-label={done ? t('tasks.markOpen', { title: task.title }) : t('tasks.markDone', { title: task.title })}
      />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className={cn('text-sm font-medium break-words', done && 'text-muted-foreground line-through')}>
          {task.priority === 'high' && !done && <span className="text-destructive mr-1" title={t('tasks.priorities.high')}>!</span>}
          {task.title}
        </span>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
          <span className={cn('inline-flex items-center gap-1', task.overdue && 'text-destructive font-medium')}>
            {task.overdue && <AlertTriangle className="size-3" aria-hidden />}
            {task.overdue && <span className="sr-only">{t('tasks.overdue')}:</span>}
            {done
              ? t('tasks.doneOn', { date: formatDueDate(task.completedAt!.slice(0, 10), null, i18n.language) })
              : formatDueDate(task.dueDate, task.dueTime, i18n.language)}
          </span>
          {showRecord && task.record && RecordIcon && (
            <Link to={recordPath(task.record)} className="inline-flex min-w-0 items-center gap-1 hover:underline">
              <RecordIcon className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{task.record.name}</span>
            </Link>
          )}
          {showAssignee && task.assignee && <span>{task.assignee.name}</span>}
        </div>
        {task.notes && !done && <p className="text-muted-foreground text-xs break-words whitespace-pre-wrap">{task.notes}</p>}
      </div>
      {canWrite && (
        <div className="flex shrink-0">
          <Button variant="ghost" size="icon" className="size-8" aria-label={t('tasks.editNamed', { title: task.title })} onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" aria-label={t('tasks.deleteNamed', { title: task.title })} onClick={() => setDeleting(true)}>
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        </div>
      )}
      <TaskDialog open={editing} onOpenChange={setEditing} task={task} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('common.delete')}
        description={t('tasks.confirmDelete', { title: task.title })}
        confirmLabel={t('common.delete')}
        pending={act.isPending}
        onConfirm={() =>
          act.mutate(() => activityApi.removeTask(task.id), {
            onSuccess: () => {
              setDeleting(false)
              toast.success(t('tasks.deleted'))
            },
            onError: (err) => toast.error(errorMessage(t, err)),
          })
        }
      />
    </li>
  )
}
