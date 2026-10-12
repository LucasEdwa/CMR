import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { RecordRef } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveWorkspace } from '@/hooks/useMe'
import { useRecordTasks } from '@/lib/activities'
import { TaskDialog } from './TaskDialog'
import { TaskRow } from './TaskRow'

// Open tasks on a record, with the latest completed ones folded away.
export function RecordTasks({ record }: { record: RecordRef & { name: string } }) {
  const { t } = useTranslation()
  const { role } = useActiveWorkspace()
  const canWrite = role !== 'viewer'
  const tasks = useRecordTasks(record)
  const [creating, setCreating] = useState(false)
  const [showDone, setShowDone] = useState(false)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>
          <h2>{t('tasks.title')}</h2>
        </CardTitle>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {t('tasks.new')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {tasks.isPending ? (
          <Skeleton className="h-16" />
        ) : (
          <>
            {tasks.data?.open.length ? (
              <ul className="divide-y" aria-label={t('tasks.open')}>
                {tasks.data.open.map((task) => (
                  <TaskRow key={task.id} task={task} canWrite={canWrite} showRecord={false} showAssignee />
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">{t('tasks.noneOpen')}</p>
            )}
            {!!tasks.data?.done.length && (
              <div className="mt-2">
                <Button variant="link" size="sm" className="h-auto px-0" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
                  {showDone ? t('tasks.hideDone') : t('tasks.showDone', { count: tasks.data.done.length })}
                </Button>
                {showDone && (
                  <ul className="divide-y" aria-label={t('tasks.done')}>
                    {tasks.data.done.map((task) => (
                      <TaskRow key={task.id} task={task} canWrite={canWrite} showRecord={false} showAssignee />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
      <TaskDialog open={creating} onOpenChange={setCreating} record={record} />
    </Card>
  )
}
