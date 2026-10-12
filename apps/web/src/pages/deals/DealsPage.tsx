import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Columns3, Handshake, List, Plus, Search } from 'lucide-react'
import { DEAL_STATUSES, formatMoney, type Deal } from '@crm/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { NativeSelect } from '@/components/NativeSelect'
import { DataTable, type Column } from '@/components/records/DataTable'
import { EmptyState } from '@/components/records/EmptyState'
import { Pagination } from '@/components/records/Pagination'
import { useActiveWorkspace } from '@/hooks/useMe'
import { useDebounced } from '@/hooks/useDebounced'
import { useMembers } from '@/lib/crm'
import { statusVariant, useBoard, useDealList, usePipelines } from '@/lib/deals'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { useListState } from '@/lib/listState'
import { Board } from './Board'
import { DealForm } from './DealForm'

export function DealsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { role } = useActiveWorkspace()
  const canWrite = role !== 'viewer'
  const state = useListState([])
  const { params, update } = state
  const pipelines = usePipelines()
  const pipelineId = params.get('pipeline') ?? pipelines.data?.pipelines[0]?.id
  const view = params.get('view') === 'list' ? 'list' : 'board'
  const board = useBoard(view === 'board' ? pipelineId : undefined)
  const [creating, setCreating] = useState<{ stageId?: string } | null>(null)

  return (
    <div className="mx-auto grid grid-cols-1 max-w-[100rem] gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('deals.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label={t('deals.pipeline')}
            className="w-48"
            value={pipelineId ?? ''}
            onChange={(e) => update({ pipeline: e.target.value }, { keepPage: false })}
          >
            {pipelines.data?.pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
          <div role="group" aria-label={t('deals.title')} className="flex rounded-md border p-0.5">
            <Button size="sm" variant={view === 'board' ? 'secondary' : 'ghost'} aria-pressed={view === 'board'} onClick={() => update({ view: null })}>
              <Columns3 className="size-4" aria-hidden />
              {t('deals.board')}
            </Button>
            <Button size="sm" variant={view === 'list' ? 'secondary' : 'ghost'} aria-pressed={view === 'list'} onClick={() => update({ view: 'list' })}>
              <List className="size-4" aria-hidden />
              {t('deals.list')}
            </Button>
          </div>
          {canWrite && (
            <Button onClick={() => setCreating({})}>
              <Plus className="size-4" aria-hidden />
              {t('deals.new')}
            </Button>
          )}
        </div>
      </div>

      {view === 'board' ? (
        board.isPending || pipelines.isPending ? (
          <Skeleton className="h-96 w-full" />
        ) : board.isError ? (
          <p className="text-destructive">{errorMessage(t, board.error)}</p>
        ) : (
          <Board board={board.data} canWrite={canWrite} onAdd={(stageId) => setCreating({ stageId })} />
        )
      ) : (
        <DealList pipelineId={pipelineId} state={state} onCreate={() => setCreating({})} canWrite={canWrite} />
      )}

      <DealForm
        open={!!creating}
        onOpenChange={(open) => !open && setCreating(null)}
        defaults={{ pipelineId, stageId: creating?.stageId }}
        onSaved={(deal) => view === 'list' && navigate(`/deals/${deal.id}`)}
      />
    </div>
  )
}

function DealList({
  pipelineId,
  state,
  onCreate,
  canWrite,
}: {
  pipelineId?: string
  state: ReturnType<typeof useListState>
  onCreate: () => void
  canWrite: boolean
}) {
  const { t, i18n } = useTranslation()
  const { params, update } = state
  const members = useMembers()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const q = useDebounced(search, 300)
  const apiParams = new URLSearchParams(params)
  for (const key of ['view', 'pipeline', 'cols', 'q']) apiParams.delete(key)
  if (pipelineId) apiParams.set('pipelineId', pipelineId)
  if (q) apiParams.set('q', q)
  const list = useDealList(apiParams, !!pipelineId)
  const sort = params.get('sort') ?? 'updatedAt'
  const dir = (params.get('dir') ?? 'desc') as 'asc' | 'desc'

  const columns: Column<Deal>[] = [
    { id: 'name', header: t('deals.name'), sortKey: 'name', cell: (d) => d.name },
    { id: 'company', header: t('deals.company'), cell: (d) => d.company?.name },
    { id: 'value', header: t('deals.value'), sortKey: 'value', cell: (d) => formatMoney(d.value, d.currency), className: 'text-right tabular-nums' },
    { id: 'stage', header: t('deals.stage'), sortKey: 'stage', cell: (d) => d.stage.name },
    { id: 'status', header: t('deals.status'), cell: (d) => <Badge variant={statusVariant(d.status)}>{t(`deals.statuses.${d.status}`)}</Badge> },
    { id: 'expectedCloseDate', header: t('deals.expectedClose'), sortKey: 'expectedCloseDate', cell: (d) => d.expectedCloseDate && formatDate(d.expectedCloseDate, i18n.language) },
    { id: 'owner', header: t('list.owner'), cell: (d) => d.owner?.name },
  ]

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" aria-hidden />
          <Input type="search" aria-label={t('common.search')} placeholder={t('common.search')} className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <NativeSelect aria-label={t('deals.status')} className="w-36" value={params.get('status') ?? ''} onChange={(e) => update({ status: e.target.value || null })}>
          <option value="">{t('common.all')}</option>
          {DEAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`deals.statuses.${s}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={t('list.owner')} className="w-44" value={params.get('owner') ?? ''} onChange={(e) => update({ owner: e.target.value || null })}>
          <option value="">{t('list.owner')}: {t('common.all')}</option>
          <option value="me">{t('list.me')}</option>
          {members.data?.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {list.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : list.isError ? (
        <p className="text-destructive">{errorMessage(t, list.error)}</p>
      ) : list.data.total === 0 ? (
        <EmptyState icon={Handshake} title={t('list.emptyTitle')} body={t('deals.emptyBody')} action={canWrite ? <Button onClick={onCreate}>{t('deals.new')}</Button> : undefined} />
      ) : (
        <>
          <DataTable
            rows={list.data.items}
            columns={columns}
            rowKey={(d) => d.id}
            rowHref={(d) => `/deals/${d.id}`}
            sort={sort}
            dir={dir}
            dimmed={list.isPlaceholderData}
            onSort={(key) => update({ sort: key, dir: sort === key && dir === 'desc' ? 'asc' : 'desc' })}
            mobile={(d) => ({ title: d.name, lines: [`${formatMoney(d.value, d.currency)} · ${d.stage.name}`, d.company?.name] })}
          />
          <Pagination
            page={list.data.page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            onPage={(page) => update({ page: String(page) }, { keepPage: true })}
            onPageSize={(size) => update({ pageSize: String(size) })}
          />
        </>
      )}
    </div>
  )
}
