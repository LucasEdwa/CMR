import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Plus, Users } from 'lucide-react'
import { LIFECYCLE_STAGES, LEAD_SOURCES, type Contact } from '@crm/shared'
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
import { fullName, useContactList } from '@/lib/crm'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { useListState } from '@/lib/listState'
import { ContactForm } from './ContactForm'

const DEFAULT_COLUMNS = ['name', 'email', 'company', 'lifecycleStage', 'owner']

export function ContactsPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { role } = useActiveWorkspace()
  const canWrite = role !== 'viewer'
  const state = useListState(DEFAULT_COLUMNS)
  const { params, apiParams, update, columns } = state
  const list = useContactList(apiParams)
  const [creating, setCreating] = useState(false)

  const all: Column<Contact>[] = [
    { id: 'name', header: t('contacts.name'), sortKey: 'name', cell: (c) => fullName(c) },
    { id: 'email', header: t('contacts.email'), sortKey: 'email', cell: (c) => c.email },
    { id: 'phone', header: t('contacts.phone'), cell: (c) => c.mobilePhone ?? c.phone },
    { id: 'title', header: t('contacts.title_field'), cell: (c) => c.title },
    { id: 'company', header: t('contacts.company'), sortKey: 'company', cell: (c) => c.company?.name },
    { id: 'lifecycleStage', header: t('contacts.lifecycleStage'), sortKey: 'lifecycleStage', cell: (c) => t(`stages.${c.lifecycleStage}`) },
    { id: 'leadSource', header: t('contacts.leadSource'), cell: (c) => c.leadSource && t(`sources.${c.leadSource}`, { defaultValue: c.leadSource }) },
    { id: 'owner', header: t('list.owner'), cell: (c) => c.owner?.name },
    { id: 'tags', header: t('list.tags'), cell: (c) => <span className="flex gap-1">{c.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</span> },
    { id: 'city', header: t('contacts.city'), cell: (c) => c.city },
    { id: 'createdAt', header: t('contacts.created'), sortKey: 'createdAt', cell: (c) => formatDate(c.createdAt, i18n.language) },
    { id: 'updatedAt', header: t('contacts.updated'), sortKey: 'updatedAt', cell: (c) => formatDate(c.updatedAt, i18n.language) },
  ]
  const visible = all.filter((c) => columns.includes(c.id))
  const sort = params.get('sort') ?? 'name'
  const dir = (params.get('dir') ?? 'asc') as 'asc' | 'desc'
  const filtered = [...params.keys()].some((k) => !['page', 'pageSize', 'sort', 'dir', 'cols', 'view'].includes(k))

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('contacts.title')}</h1>
        {canWrite && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {t('contacts.new')}
          </Button>
        )}
      </div>

      <ListToolbar
        object="contacts"
        state={state}
        allColumns={all.map((c) => ({ id: c.id, label: c.header }))}
        defaultColumns={DEFAULT_COLUMNS}
        extraFilterKeys={['stage', 'source']}
        extraFilters={
          <>
            <Field id="filter-stage" label={t('contacts.lifecycleStage')}>
              <NativeSelect id="filter-stage" value={params.get('stage') ?? ''} onChange={(e) => update({ stage: e.target.value || null })}>
                <option value="">{t('common.all')}</option>
                {LIFECYCLE_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {t(`stages.${s}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="filter-source" label={t('contacts.leadSource')}>
              <NativeSelect id="filter-source" value={params.get('source') ?? ''} onChange={(e) => update({ source: e.target.value || null })}>
                <option value="">{t('common.all')}</option>
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sources.${s}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </>
        }
      />

      {list.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : list.isError ? (
        <p className="text-destructive">{errorMessage(t, list.error)}</p>
      ) : list.data.total === 0 ? (
        <EmptyState
          icon={Users}
          title={filtered ? t('list.emptyFiltered') : t('list.emptyTitle')}
          body={filtered ? undefined : t('contacts.emptyBody')}
          action={
            filtered ? (
              <Button variant="outline" onClick={() => state.setParams(new URLSearchParams(), { replace: true })}>
                {t('list.clearFilters')}
              </Button>
            ) : canWrite ? (
              <Button onClick={() => setCreating(true)}>{t('contacts.new')}</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <DataTable
            rows={list.data.items}
            columns={visible}
            rowKey={(c) => c.id}
            rowHref={(c) => `/contacts/${c.id}`}
            sort={sort}
            dir={dir}
            dimmed={list.isPlaceholderData}
            onSort={(key) => update({ sort: key, dir: sort === key && dir === 'asc' ? 'desc' : 'asc' })}
            mobile={(c) => ({ title: fullName(c), lines: [c.email, [c.title, c.company?.name].filter(Boolean).join(' · ')] })}
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

      <ContactForm open={creating} onOpenChange={setCreating} onSaved={(c) => navigate(`/contacts/${c.id}`)} />
    </div>
  )
}
