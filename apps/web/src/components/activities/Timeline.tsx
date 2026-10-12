import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Building2, Handshake, Mail, MoreHorizontal, Phone, Pin, PinOff, StickyNote, Trash2, User, Users, Pencil } from 'lucide-react'
import { ACTIVITY_TYPES, type Activity, type ActivityType, type RecordRef } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/records/ConfirmDialog'
import { useActiveWorkspace } from '@/hooks/useMe'
import { activityApi, useActivityMutation, useTimeline } from '@/lib/activities'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ActivityComposer } from './ActivityComposer'
import { RichText } from './RichText'

const ICONS: Record<ActivityType, typeof StickyNote> = { note: StickyNote, call: Phone, meeting: Users, email: Mail }

// Notes, calls, meetings and emails on a record, newest first, with pinned notes on top.
// Activities logged on related records (a deal's contacts, a contact's company) show here too.
export function Timeline({ record }: { record: RecordRef }) {
  const { t } = useTranslation()
  const { role } = useActiveWorkspace()
  const canWrite = role !== 'viewer'
  const [tab, setTab] = useState<ActivityType>('note')
  const [filter, setFilter] = useState<ActivityType[]>([])
  const timeline = useTimeline(record, filter)
  const pinned = timeline.data?.pages[0]?.pinned ?? []
  const items = timeline.data?.pages.flatMap((p) => p.items) ?? []

  // A link from a notification (#activity-<id>) scrolls to that activity once it has loaded.
  const { hash } = useLocation()
  const loaded = !!timeline.data
  useEffect(() => {
    if (!loaded || !hash.startsWith('#activity-')) return
    const el = document.getElementById(hash.slice(1))
    el?.scrollIntoView({ block: 'center' })
    el?.focus()
  }, [loaded, hash])

  const toggleFilter = (type: ActivityType) =>
    setFilter((current) => (current.includes(type) ? current.filter((x) => x !== type) : [...current, type]))

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('activities.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        {canWrite && (
          <div className="grid gap-3">
            <div role="tablist" aria-label={t('activities.logType')} className="flex flex-wrap gap-1">
              {ACTIVITY_TYPES.map((type) => {
                const Icon = ICONS[type]
                return (
                  <Button
                    key={type}
                    role="tab"
                    type="button"
                    size="sm"
                    variant={tab === type ? 'secondary' : 'ghost'}
                    aria-selected={tab === type}
                    onClick={() => setTab(type)}
                  >
                    <Icon className="size-4" aria-hidden />
                    {t(`activities.types.${type}`)}
                  </Button>
                )
              })}
            </div>
            <div role="tabpanel">
              <ActivityComposer key={tab} mode="create" record={record} type={tab} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('activities.filter')}>
          <span className="text-muted-foreground mr-1 text-sm">{t('activities.show')}</span>
          {ACTIVITY_TYPES.map((type) => (
            <Button
              key={type}
              type="button"
              size="sm"
              variant={filter.includes(type) ? 'default' : 'outline'}
              className="h-7 rounded-full px-3 text-xs"
              aria-pressed={filter.includes(type)}
              onClick={() => toggleFilter(type)}
            >
              {t(`activities.plural.${type}`)}
            </Button>
          ))}
        </div>

        {timeline.isPending ? (
          <Skeleton className="h-32" />
        ) : timeline.isError ? (
          <p className="text-destructive text-sm">{errorMessage(t, timeline.error)}</p>
        ) : pinned.length + items.length === 0 ? (
          <p className="text-muted-foreground text-sm">{filter.length ? t('activities.noneOfType') : t('activities.empty')}</p>
        ) : (
          <ol className="grid gap-3" aria-label={t('activities.title')}>
            {pinned.map((a) => (
              <ActivityItem key={a.id} activity={a} record={record} />
            ))}
            {items.map((a) => (
              <ActivityItem key={a.id} activity={a} record={record} />
            ))}
          </ol>
        )}
        {timeline.hasNextPage && (
          <Button variant="outline" className="justify-self-center" onClick={() => timeline.fetchNextPage()} disabled={timeline.isFetchingNextPage}>
            {t('activities.more')}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function ActivityItem({ activity: a, record }: { activity: Activity; record: RecordRef }) {
  const { t, i18n } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const act = useActivityMutation((fn: () => Promise<unknown>) => fn())
  const Icon = ICONS[a.type]

  // The other records this activity is on ("Also on").
  const others = [
    ...a.links.deals.filter((d) => !(record.type === 'deal' && d.id === record.id)).map((d) => ({ ...d, to: `/deals/${d.id}`, icon: Handshake })),
    ...a.links.contacts.filter((c) => !(record.type === 'contact' && c.id === record.id)).map((c) => ({ ...c, to: `/contacts/${c.id}`, icon: User })),
    ...a.links.companies.filter((c) => !(record.type === 'company' && c.id === record.id)).map((c) => ({ ...c, to: `/companies/${c.id}`, icon: Building2 })),
  ]
  const meta = [
    a.author?.name,
    formatDateTime(a.occurredAt, i18n.language),
    a.durationMinutes ? t('activities.minutes', { count: a.durationMinutes }) : null,
    a.outcome ? t(`activities.outcomes.${a.outcome}`) : null,
    a.direction ? t(`activities.directions.${a.direction}`) : null,
  ].filter(Boolean)

  return (
    <li
      id={`activity-${a.id}`}
      tabIndex={-1}
      className={cn('grid gap-2 rounded-md border p-3 outline-none target:ring-2 focus:ring-2', a.pinned && 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20')}
    >
      <div className="flex items-start gap-3">
        <span className="bg-muted grid size-8 shrink-0 place-items-center rounded-full" aria-hidden>
          <Icon className="size-4" />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <div className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
            <span>{t(`activities.types.${a.type}`)}</span>
            {a.subject && <span className="min-w-0 break-words">· {a.subject}</span>}
            {a.pinned && (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-amber-700 dark:text-amber-400">
                <Pin className="size-3" aria-hidden />
                {t('activities.pinned')}
              </span>
            )}
          </div>
          <div className="text-muted-foreground text-xs">{meta.join(' · ')}</div>
        </div>
        {a.canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label={t('activities.actions')}>
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  act.mutate(() => activityApi.update(a.id, { pinned: !a.pinned }), {
                    onError: (err) => toast.error(errorMessage(t, err)),
                  })
                }
              >
                {a.pinned ? <PinOff className="size-4" aria-hidden /> : <Pin className="size-4" aria-hidden />}
                {a.pinned ? t('activities.unpin') : t('activities.pin')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden />
                {t('common.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDeleting(true)}>
                <Trash2 className="size-4" aria-hidden />
                {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {editing ? (
        <ActivityComposer mode="edit" activity={a} onDone={() => setEditing(false)} />
      ) : (
        a.body && <RichText doc={a.body} />
      )}

      {others.length > 0 && (
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>{t('activities.alsoOn')}</span>
          {others.map(({ id, name, to, icon: LinkIcon }) => (
            <Link key={id} to={to} className="inline-flex min-w-0 items-center gap-1 hover:underline">
              <LinkIcon className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{name}</span>
            </Link>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('common.delete')}
        description={t('activities.confirmDelete')}
        confirmLabel={t('common.delete')}
        pending={act.isPending}
        onConfirm={() =>
          act.mutate(() => activityApi.remove(a.id), {
            onSuccess: () => {
              setDeleting(false)
              toast.success(t('activities.deleted'))
            },
            onError: (err) => toast.error(errorMessage(t, err)),
          })
        }
      />
    </li>
  )
}
