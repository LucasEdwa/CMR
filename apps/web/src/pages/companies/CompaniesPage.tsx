import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Building2, Plus } from 'lucide-react'
import { COMPANY_SIZES, type Company } from '@crm/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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

const DEFAULT_COLUMNS = ['name', 'orgNumber', 'city', 'contactCount', 'owner']

export function CompaniesPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { role } = useActiveWorkspace()
  const canWrite = role !== 'viewer'
  const state = useListState(DEFAULT_COLUMNS)
  const { params, apiParams, update, columns } = state
  const list = useCompanyList(apiParams)
  const [creating, setCreating] = useState(false)

  const all: Column<Company>[] = [
    { id: 'name', header: t('companies.name'), sortKey: 'name', cell: (c) => c.name },
    { id: 'orgNumber', header: t('companies.orgNumber'), cell: (c) => c.orgNumber },
    { id: 'domain', header: t('companies.domain'), cell: (c) => c.domain },
    { id: 'industry', header: t('companies.industry'), cell: (c) => c.industry },
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
  const filtered = [...params.keys()].some((k) => !['page', 'pageSize', 'sort', 'dir', 'cols', 'view'].includes(k))

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('companies.title')}</h1>
        {canWrite && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {t('companies.new')}
          </Button>
        )}
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
          <DataTable
            rows={list.data.items}
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
