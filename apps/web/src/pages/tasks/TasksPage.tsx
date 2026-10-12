import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Plus } from 'lucide-react'
import type { Task } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/NativeSelect'
import { EmptyState } from '@/components/records/EmptyState'
import { TaskDialog } from '@/components/tasks/TaskDialog'
import { TaskRow } from '@/components/tasks/TaskRow'
import { useActiveWorkspace, useMe } from '@/hooks/useMe'
import { useMyTasks } from '@/lib/activities'
import { useMembers } from '@/lib/crm'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

// "My tasks": overdue, today and upcoming in the assignee's timezone, plus recently completed.
// ?assignee=<userId> shows a colleague's list.
export function TasksPage() {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const { role } = useActiveWorkspace()
  const canWrite = role !== 'viewer'
  const members = useMembers()
  const [params, setParams] = useSearchParams()
  const assignee = params.get('assignee') ?? 'me'
  const tasks = useMyTasks(assignee)
  const [creating, setCreating] = useState(false)
  const mine = assignee === 'me' || assignee === me?.user.id

  const sections: Array<{ key: 'overdue' | 'today' | 'upcoming' | 'done'; items: Task[] }> = tasks.data
    ? [
        { key: 'overdue', items: tasks.data.overdue },
        { key: 'today', items: tasks.data.today },
        { key: 'upcoming', items: tasks.data.upcoming },
        { key: 'done', items: tasks.data.done },
      ]
    : []
  const openCount = tasks.data ? tasks.data.overdue.length + tasks.data.today.length + tasks.data.upcoming.length : 0

  return (
    <div className="mx-auto grid max-w-3xl grid-cols-1 gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{mine ? t('tasks.myTasks') : t('tasks.title')}</h1>
          {tasks.data && <p className="text-muted-foreground text-sm">{t('tasks.openCount', { count: openCount })}</p>}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="tasks-assignee" className="text-muted-foreground text-xs">
              {t('tasks.showFor')}
            </Label>
            <NativeSelect
              id="tasks-assignee"
              className="w-48"
              value={mine ? 'me' : assignee}
              onChange={(e) => setParams(e.target.value === 'me' ? {} : { assignee: e.target.value })}
            >
              <option value="me">{t('tasks.me')}</option>
              {members.data
                ?.filter((m) => m.userId !== me?.user.id)
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
            </NativeSelect>
          </div>
          {canWrite && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              {t('tasks.new')}
            </Button>
          )}
        </div>
      </header>

      {tasks.isPending ? (
        <Skeleton className="h-64" />
      ) : tasks.isError ? (
        <p className="text-destructive">{errorMessage(t, tasks.error)}</p>
      ) : openCount === 0 && !tasks.data.done.length ? (
        <EmptyState icon={CheckCircle2} title={t('tasks.emptyTitle')} body={t('tasks.emptyBody')} />
      ) : (
        sections.map(({ key, items }) => (
          <Card key={key} className={cn(key === 'overdue' && items.length > 0 && 'border-destructive/50')}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <h2 className={cn(key === 'overdue' && items.length > 0 && 'text-destructive')}>{t(`tasks.sections.${key}`)}</h2>
                <span className="text-muted-foreground text-sm font-normal">{items.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {items.length ? (
                <ul className="divide-y" aria-label={t(`tasks.sections.${key}`)}>
                  {items.map((task) => (
                    <TaskRow key={task.id} task={task} canWrite={canWrite} />
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">{t(`tasks.sectionEmpty.${key}`)}</p>
              )}
            </CardContent>
          </Card>
        ))
      )}
      <TaskDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}
