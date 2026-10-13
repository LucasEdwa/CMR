import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, Building2, Check, Hourglass, Pencil, RotateCcw, Trash2, User, X } from 'lucide-react'
import { formatMoney } from '@crm/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { HistoryLink } from '@/components/records/HistoryLink'
import { ConfirmDialog } from '@/components/records/ConfirmDialog'
import { DetailList, RecordNotFound } from '@/components/records/DetailParts'
import { useActiveWorkspace } from '@/hooks/useMe'
import { ApiRequestError } from '@/lib/api'
import { daysSince, dealApi, picklistLabel, statusVariant, useDeal, useDealMutation, usePicklists, usePipelines } from '@/lib/deals'
import { formatDuration } from '@/lib/duration'
import { dataApi } from '@/lib/data'
import { errorMessage } from '@/lib/errors'
import { formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Timeline } from '@/components/activities/Timeline'
import { RecordTasks } from '@/components/tasks/RecordTasks'
import { DealForm } from './DealForm'
import { LostDialog } from './LostDialog'

export function DealDetail() {
  const { t, i18n } = useTranslation()
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { role } = useActiveWorkspace()
  const canWrite = role !== 'viewer'
  const deal = useDeal(id)
  const pipelines = usePipelines()
  const picklists = usePicklists()
  const [editing, setEditing] = useState(false)
  const [losing, setLosing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const act = useDealMutation((fn: () => Promise<unknown>) => fn())
  const run = (fn: () => Promise<unknown>, message: string, after?: () => void) =>
    act.mutate(fn, {
      onSuccess: () => {
        toast.success(message)
        after?.()
      },
      onError: (err) => toast.error(errorMessage(t, err)),
    })

  // For "recently viewed" in the search palette.
  const loaded = deal.isSuccess
  useEffect(() => {
    if (loaded) void dataApi.viewed({ type: 'deal', id })
  }, [loaded, id])

  if (deal.isPending) return <Skeleton className="mx-auto h-96 max-w-4xl" />
  if (deal.error instanceof ApiRequestError && deal.error.status === 404) return <RecordNotFound backTo="/deals" />
  if (deal.isError) return <p className="text-destructive">{errorMessage(t, deal.error)}</p>

  const d = deal.data
  const stages = pipelines.data?.pipelines.find((p) => p.id === d.pipeline.id)?.stages ?? []
  const currentIndex = stages.findIndex((s) => s.id === d.stage.id)
  const open = d.status === 'open'

  return (
    <div className="mx-auto grid grid-cols-1 max-w-4xl gap-6">
      <Link to={`/deals?pipeline=${d.pipeline.id}`} className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline">
        <ArrowLeft className="size-4" aria-hidden />
        {d.pipeline.name}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{d.name}</h1>
          <p className="mt-1 text-xl font-medium tabular-nums">{formatMoney(d.value, d.currency)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant={statusVariant(d.status)}>{t(`deals.statuses.${d.status}`)}</Badge>
            {d.status === 'lost' && d.lostReason && (
              <span className="text-muted-foreground text-sm">{t('deals.lostAs', { reason: picklistLabel(t, picklists.data, 'lost_reason', d.lostReason) })}</span>
            )}
            {d.stale && (
              <Badge variant="outline" className="gap-1 border-amber-400/70 text-amber-700 dark:text-amber-400">
                <Hourglass className="size-3" aria-hidden />
                {t('deals.staleFor', { days: daysSince(d.lastActivityAt) })}
              </Badge>
            )}
          </div>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <HistoryLink record={{ type: 'deal', id: d.id }} />
            {open ? (
              <>
                <Button onClick={() => run(() => dealApi.won(d.id), t('deals.wonToast'))} disabled={act.isPending}>
                  <Check className="size-4" aria-hidden />
                  {t('deals.markWon')}
                </Button>
                <Button variant="outline" onClick={() => setLosing(true)}>
                  <X className="size-4" aria-hidden />
                  {t('deals.markLost')}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => run(() => dealApi.reopen(d.id), t('deals.reopenedToast'))} disabled={act.isPending}>
                <RotateCcw className="size-4" aria-hidden />
                {t('deals.reopen')}
              </Button>
            )}
            <Button variant="outline" size="icon" aria-label={t('common.edit')} onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden />
            </Button>
            <Button variant="outline" size="icon" aria-label={t('common.delete')} onClick={() => setDeleting(true)}>
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        )}
      </header>

      {/* Stage bar: click a stage to move the deal there. */}
      {/* min-w-0: the bar scrolls inside itself instead of widening the page on phones. */}
      <nav aria-label={t('deals.moveTo')} className="min-w-0">
        <ol className="flex overflow-x-auto rounded-md border">
          {stages.map((s, i) => (
            <li key={s.id} className="min-w-28 flex-1">
              <button
                type="button"
                disabled={!canWrite || !open || s.id === d.stage.id || act.isPending}
                aria-current={s.id === d.stage.id ? 'step' : undefined}
                onClick={() => run(() => dealApi.move(d.id, s.id), t('deals.movedTo', { stage: s.name }))}
                className={cn(
                  'w-full truncate px-3 py-2 text-left text-sm',
                  i <= currentIndex ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                  i > 0 && 'border-l',
                  !open && 'opacity-70',
                )}
              >
                {s.name}
                <span className="block text-xs opacity-70">{s.probability} %</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_18rem]">
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{t('deals.details')}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  [t('deals.stage'), `${d.stage.name} (${d.stage.probability} %)`],
                  [t('deals.expectedClose'), d.expectedCloseDate && formatDate(d.expectedCloseDate, i18n.language)],
                  [t('list.owner'), d.owner?.name],
                  [t('deals.status'), d.closedAt ? t('deals.closed', { date: formatDate(d.closedAt, i18n.language) }) : null],
                  [t('deals.lostNote'), d.lostNote],
                  [t('contacts.created'), formatDate(d.createdAt, i18n.language)],
                ]}
              />
            </CardContent>
          </Card>
          <Timeline record={{ type: 'deal', id: d.id }} />
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{t('deals.history')}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-3">
                {[...d.history].reverse().map((h, i) => (
                  <li key={`${h.enteredAt}-${i}`} className="grid gap-0.5">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{h.stage}</span>
                      <span className="text-muted-foreground text-sm tabular-nums">
                        {t('deals.inStage', { duration: formatDuration(h.duration) })}
                      </span>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {formatDateTime(h.enteredAt, i18n.language)}
                      {h.by && ` · ${h.by}`}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
        <div className="grid min-w-0 content-start gap-6">
        <RecordTasks record={{ type: 'deal', id: d.id, name: d.name }} />
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('deals.related')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1">
            {d.company && (
              <Link to={`/companies/${d.company.id}`} className="hover:bg-muted -mx-2 flex items-center gap-2 rounded-md px-2 py-1.5">
                <Building2 className="text-muted-foreground size-4" aria-hidden />
                <span className="truncate">{d.company.name}</span>
              </Link>
            )}
            {d.contacts.map((c) => (
              <Link key={c.id} to={`/contacts/${c.id}`} className="hover:bg-muted -mx-2 flex items-center gap-2 rounded-md px-2 py-1.5">
                <User className="text-muted-foreground size-4" aria-hidden />
                <span className="truncate">{c.name}</span>
              </Link>
            ))}
            {!d.company && d.contacts.length === 0 && <p className="text-muted-foreground text-sm">{t('deals.noContacts')}</p>}
          </CardContent>
        </Card>
        </div>
      </div>

      <DealForm open={editing} onOpenChange={setEditing} deal={d} />
      <LostDialog
        open={losing}
        onOpenChange={setLosing}
        pending={act.isPending}
        onConfirm={(reason, note) => run(() => dealApi.lost(d.id, reason, note || undefined), t('deals.lostToast'), () => setLosing(false))}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('common.delete')}
        description={t('deals.confirmDelete', { name: d.name })}
        confirmLabel={t('common.delete')}
        pending={act.isPending}
        onConfirm={() => run(() => dealApi.remove(d.id), t('deals.deleted'), () => navigate(`/deals?pipeline=${d.pipeline.id}`))}
      />
    </div>
  )
}
