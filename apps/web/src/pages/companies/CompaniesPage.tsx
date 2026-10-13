import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Building2, Plus } from 'lucide-react'
import { COMPANY_SIZES, type Company } from '@crm/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { BulkBar } from '@/components/data/BulkBar'
import { ListActions, type ExportColumn } from '@/components/data/ListActions'
import { useSelection } from '@/hooks/useSelection'
import { Field } from '@/components/Field'
import { NativeSelect } from '@/components/NativeSelect'
import { DataTable, type Column } from '@/components/records/DataTable'
import { EmptyState } from '@/components/records/EmptyState'
import { ListToolbar } from '@/components/records/ListToolbar'
import { Pagination } from '@/components/records/Pagination'
import { useActiveWorkspace } from '@/hooks/useMe'
import { useCompanyList } from '@/lib/crm'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { useListState } from '@/lib/listState'
import { CompanyForm } from './CompanyForm'
import { picklistLabel, usePicklists } from '@/lib/deals'

const DEFAULT_COLUMNS = ['name', 'orgNumber', 'city', 'contactCount', 'owner']

export function CompaniesPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { role } = useActiveWorkspace()
  const canWrite = role !== 'viewer'
  const state = useListState(DEFAULT_COLUMNS)
  const { params, apiParams, update, columns } = state
  const list = useCompanyList(apiParams)
  const picklists = usePicklists()
  const [creating, setCreating] = useState(false)
  const selection = useSelection()

  const all: Column<Company>[] = [
    { id: 'name', header: t('companies.name'), sortKey: 'name', cell: (c) => c.name },
    { id: 'orgNumber', header: t('companies.orgNumber'), cell: (c) => c.orgNumber },
    { id: 'domain', header: t('companies.domain'), cell: (c) => c.domain },
    { id: 'industry', header: t('companies.industry'), cell: (c) => picklistLabel(t, picklists.data, 'industry', c.industry) },
    { id: 'size', header: t('companies.size'), cell: (c) => c.size && t(`sizes.${c.size}`) },
    { id: 'city', header: t('companies.city'), sortKey: 'city', cell: (c) => c.city },
    { id: 'contactCount', header: t('companies.contactCount'), sortKey: 'contactCount', cell: (c) => c.contactCount, className: 'text-right tabular-nums' },
    { id: 'owner', header: t('list.owner'), cell: (c) => c.owner?.name },
    { id: 'tags', header: t('list.tags'), cell: (c) => <span className="flex gap-1">{c.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</span> },
    { id: 'createdAt', header: t('contacts.created'), sortKey: 'createdAt', cell: (c) => formatDate(c.createdAt, i18n.language) },
  ]
  const visible = all.filter((c) => columns.includes(c.id))
  const sort = params.get('sort') ?? 'name'
  const dir = (params.get('dir') ?? 'asc') as 'asc' | 'desc'
  const exportColumns: ExportColumn<Company>[] = [
    { header: t('companies.name'), value: (c) => c.name },
    { header: t('companies.orgNumber'), value: (c) => c.orgNumber },
    { header: t('import.fields.vatNumber'), value: (c) => c.vatNumber },
    { header: t('companies.domain'), value: (c) => c.domain },
    { header: t('companies.industry'), value: (c) => picklistLabel(t, picklists.data, 'industry', c.industry) },
    { header: t('companies.size'), value: (c) => c.size },
    { header: t('import.fields.phone'), value: (c) => c.phone },
    { header: t('import.fields.street'), value: (c) => c.street },
    { header: t('import.fields.postalCode'), value: (c) => c.postalCode },
    { header: t('companies.city'), value: (c) => c.city },
    { header: t('import.fields.country'), value: (c) => c.country },
    { header: t('companies.contactCount'), value: (c) => c.contactCount },
    { header: t('list.tags'), value: (c) => c.tags.join(', ') },
    { header: t('list.owner'), value: (c) => c.owner?.name },
    { header: t('contacts.created'), value: (c) => c.createdAt.slice(0, 10) },
  ]
  const filtered = [...params.keys()].some((k) => !['page', 'pageSize', 'sort', 'dir', 'cols', 'view'].includes(k))

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">{t('companies.title')}</h1>
        <div className="flex gap-2">
          <ListActions object="companies" params={apiParams} columns={exportColumns} />
          {canWrite && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              {t('companies.new')}
            </Button>
          )}
        </div>
      </div>

      <ListToolbar
        object="companies"
        state={state}
        allColumns={all.map((c) => ({ id: c.id, label: c.header }))}
        defaultColumns={DEFAULT_COLUMNS}
        extraFilterKeys={['size']}
        extraFilters={
          <Field id="filter-size" label={t('companies.size')}>
            <NativeSelect id="filter-size" value={params.get('size') ?? ''} onChange={(e) => update({ size: e.target.value || null })}>
              <option value="">{t('common.all')}</option>
              {COMPANY_SIZES.map((s) => (
                <option key={s} value={s}>
                  {t(`sizes.${s}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        }
      />

      {list.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : list.isError ? (
        <p className="text-destructive">{errorMessage(t, list.error)}</p>
      ) : list.data.total === 0 ? (
        <EmptyState
          icon={Building2}
          title={filtered ? t('list.emptyFiltered') : t('list.emptyTitle')}
          body={filtered ? undefined : t('companies.emptyBody')}
          action={
            filtered ? (
              <Button variant="outline" onClick={() => state.setParams(new URLSearchParams(), { replace: true })}>
                {t('list.clearFilters')}
              </Button>
            ) : canWrite ? (
              <Button onClick={() => setCreating(true)}>{t('companies.new')}</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {selection.ids.length > 0 && <BulkBar object="companies" ids={selection.ids} onDone={selection.clear} />}
          <DataTable
            rows={list.data.items}
            selection={canWrite ? { ...selection, label: (c) => c.name } : undefined}
            columns={visible}
            rowKey={(c) => c.id}
            rowHref={(c) => `/companies/${c.id}`}
            sort={sort}
            dir={dir}
            dimmed={list.isPlaceholderData}
            onSort={(key) => update({ sort: key, dir: sort === key && dir === 'asc' ? 'desc' : 'asc' })}
            mobile={(c) => ({ title: c.name, lines: [[c.orgNumber, c.city].filter(Boolean).join(' · '), `${t('companies.contactCount')}: ${c.contactCount}`] })}
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

      <CompanyForm open={creating} onOpenChange={setCreating} onSaved={(c) => navigate(`/companies/${c.id}`)} />
    </div>
  )
}
