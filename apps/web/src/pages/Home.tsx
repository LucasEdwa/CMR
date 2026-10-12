import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Users } from 'lucide-react'
import { DASHBOARD_PERIODS, dashboardSchema, formatMoney, type Dashboard } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { NativeSelect } from '@/components/NativeSelect'
import { useActiveWorkspace, useMe } from '@/hooks/useMe'
import { recordPath } from '@/lib/activities'
import { api } from '@/lib/api'
import { useMembers } from '@/lib/crm'
import { picklistLabel, usePicklists, usePipelines } from '@/lib/deals'
import { errorMessage } from '@/lib/errors'
import { formatDate, formatDueDate } from '@/lib/format'

// The default dashboard. Filters live in the URL so a view can be shared or bookmarked.
export function Home() {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const [params, setParams] = useSearchParams()
  const members = useMembers()
  const pipelines = usePipelines()
  const query = new URLSearchParams()
  for (const key of ['period', 'owner', 'pipelineId']) if (params.get(key)) query.set(key, params.get(key)!)
  const dashboard = useQuery({ queryKey: ['dashboard', query.toString()], queryFn: () => api(`/dashboard?${query}`, dashboardSchema) })
  const set = (key: string, value: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    })
  const firstName = me?.user.name.split(' ')[0] ?? ''

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('home.greeting', { name: firstName })}</h1>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('dashboard.filters')}>
          <NativeSelect aria-label={t('dashboard.period')} className="w-44" value={params.get('period') ?? 'this_month'} onChange={(e) => set('period', e.target.value === 'this_month' ? '' : e.target.value)}>
            {DASHBOARD_PERIODS.map((p) => (
              <option key={p} value={p}>
                {t(`dashboard.periods.${p}`)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label={t('dashboard.user')} className="w-44" value={params.get('owner') ?? ''} onChange={(e) => set('owner', e.target.value)}>
            <option value="">{t('dashboard.everyone')}</option>
            <option value="me">{t('list.me')}</option>
            {members.data
              ?.filter((m) => m.role !== 'viewer' && m.userId !== me?.user.id)
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
          </NativeSelect>
          {(pipelines.data?.pipelines.length ?? 0) > 1 && (
            <NativeSelect aria-label={t('deals.pipeline')} className="w-44" value={params.get('pipelineId') ?? ''} onChange={(e) => set('pipelineId', e.target.value)}>
              {pipelines.data?.pipelines.map((p, i) => (
                <option key={p.id} value={i === 0 ? '' : p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </div>
      </header>

      {dashboard.isPending ? (
        <Skeleton className="h-96" />
      ) : dashboard.isError ? (
        <p className="text-destructive">{errorMessage(t, dashboard.error)}</p>
      ) : (
        <DashboardBody d={dashboard.data} />
      )}
    </div>
  )
}

function DashboardBody({ d }: { d: Dashboard }) {
  const { t, i18n } = useTranslation()
  const picklists = usePicklists()
  const money = (v: number) => formatMoney(v, d.currency)
  const maxStage = Math.max(1, ...d.pipeline.stages.map((s) => s.value))
  const maxActivities = Math.max(1, ...d.activities.map((a) => a.total))
  const periodLabel = t('dashboard.range', {
    from: formatDate(d.period.from, i18n.language),
    to: formatDate(new Date(Date.parse(d.period.to) - 86_400_000).toISOString().slice(0, 10), i18n.language),
  })

  // A brand-new workspace gets a starting point above the (still empty) numbers.
  const empty = d.pipeline.count + d.won.count + d.lost.count + d.newDeals + d.activities.reduce((n, a) => n + a.total, 0) === 0

  return (
    <>
      {empty && <GettingStarted />}
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label={t('dashboard.keyFigures')}>
        <Kpi label={t('dashboard.openPipeline')} value={money(d.pipeline.value)} detail={t('dashboard.deals', { count: d.pipeline.count })} />
        <Kpi label={t('dashboard.weighted')} value={money(d.pipeline.weighted)} detail={t('dashboard.weightedHint')} />
        <Kpi label={t('dashboard.won')} value={money(d.won.value)} detail={`${t('dashboard.deals', { count: d.won.count })} · ${periodLabel}`} />
        <Kpi label={t('dashboard.lost')} value={money(d.lost.value)} detail={`${t('dashboard.deals', { count: d.lost.count })} · ${periodLabel}`} />
        <Kpi
          label={t('dashboard.winRate')}
          value={d.winRate === null ? '–' : `${Math.round(d.winRate * 100)} %`}
          detail={t('dashboard.newDeals', { count: d.newDeals })}
        />
      </dl>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('dashboard.byStage', { pipeline: d.pipeline.name })}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3" aria-label={t('dashboard.byStageLabel')}>
              {d.pipeline.stages.map((s) => (
                <li key={s.id} className="grid gap-1">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {t('dashboard.deals', { count: s.count })} · {money(s.value)}
                    </span>
                  </div>
                  <Bar value={s.value} max={maxStage} />
                </li>
              ))}
            </ul>
            {d.pipeline.otherCurrencyCount > 0 && (
              <p className="text-muted-foreground mt-3 text-xs">{t('dashboard.otherCurrency', { count: d.pipeline.otherCurrencyCount, currency: d.currency })}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('dashboard.activities')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <caption className="sr-only">{t('dashboard.activities')}</caption>
              <thead className="text-muted-foreground text-left text-xs">
                <tr>
                  <th className="pb-2 font-medium">{t('dashboard.user')}</th>
                  {(['call', 'meeting', 'email', 'note'] as const).map((type) => (
                    <th key={type} className="pb-2 text-right font-medium">
                      {t(`activities.plural.${type}`)}
                    </th>
                  ))}
                  <th className="pb-2 text-right font-medium">{t('dashboard.total')}</th>
                </tr>
              </thead>
              <tbody>
                {d.activities.map((a) => (
                  <tr key={a.user.id} className="border-t">
                    <td className="py-2">
                      <span className="block truncate">{a.user.name}</span>
                      <Bar value={a.total} max={maxActivities} />
                    </td>
                    <td className="text-right tabular-nums">{a.call}</td>
                    <td className="text-right tabular-nums">{a.meeting}</td>
                    <td className="text-right tabular-nums">{a.email}</td>
                    <td className="text-right tabular-nums">{a.note}</td>
                    <td className="text-right font-medium tabular-nums">{a.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <h2>{t('dashboard.overdue')}</h2>
              <span className={d.overdueTasks.count ? 'text-destructive' : 'text-muted-foreground'}>{d.overdueTasks.count}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {d.overdueTasks.items.length ? (
              <ul className="divide-y" aria-label={t('dashboard.overdue')}>
                {d.overdueTasks.items.map((task) => (
                  <li key={task.id} className="flex items-start gap-2 py-2 text-sm">
                    <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
                    <span className="grid min-w-0">
                      <span className="truncate font-medium">{task.title}</span>
                      <span className="text-muted-foreground truncate text-xs">
                        {[formatDueDate(task.dueDate, null, i18n.language), task.assignee].filter(Boolean).join(' · ')}
                        {task.record && (
                          <>
                            {' · '}
                            <Link to={recordPath(task.record)} className="hover:underline">
                              {task.record.name}
                            </Link>
                          </>
                        )}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">{t('dashboard.noOverdue')}</p>
            )}
            {d.overdueTasks.count > d.overdueTasks.items.length && (
              <Link to="/tasks" className="mt-2 inline-block text-sm underline">
                {t('dashboard.allTasks')}
              </Link>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('dashboard.lostReasons')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {d.lostReasons.length ? (
              <ul className="grid gap-2 text-sm">
                {d.lostReasons.map((r) => (
                  <li key={r.reason ?? 'none'} className="flex justify-between gap-2">
                    <span>{r.reason ? picklistLabel(t, picklists.data, 'lost_reason', r.reason) : t('dashboard.noReason')}</span>
                    <span className="tabular-nums">{r.count}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">{t('dashboard.noLost')}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function GettingStarted() {
  const { t } = useTranslation()
  const { canManage } = useActiveWorkspace()
  return (
    <section className="grid justify-items-center gap-3 rounded-lg border border-dashed px-6 py-8 text-center" aria-labelledby="getting-started">
      <Users className="text-muted-foreground size-10" aria-hidden />
      <h2 id="getting-started" className="text-lg font-medium">
        {t('home.emptyTitle')}
      </h2>
      <p className="text-muted-foreground max-w-md">{t('home.emptyBody')}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link to="/contacts">{t('nav.contacts')}</Link>
        </Button>
        {canManage && (
          <Button asChild variant="outline">
            <Link to="/import">{t('import.button')}</Link>
          </Button>
        )}
        {canManage && (
          <Button asChild variant="outline">
            <Link to="/settings/members">{t('home.inviteTeam')}</Link>
          </Button>
        )}
      </div>
    </section>
  )
}

function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
      <dd className="text-muted-foreground mt-0.5 truncate text-xs">{detail}</dd>
    </div>
  )
}

// Decorative: the number is always written next to it.
function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full" aria-hidden>
      <div className="bg-primary h-full rounded-full" style={{ width: `${(value / max) * 100}%` }} />
    </div>
  )
}
