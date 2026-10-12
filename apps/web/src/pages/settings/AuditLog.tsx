import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { auditPageSchema, type AuditEntry } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Field } from '@/components/Field'
import { NativeSelect } from '@/components/NativeSelect'
import { Pagination } from '@/components/records/Pagination'
import { recordPath } from '@/lib/activities'
import { api } from '@/lib/api'
import { useMembers } from '@/lib/crm'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'

const ENTITY_TYPES = ['contact', 'company', 'deal', 'activity', 'task', 'membership', 'invitation', 'workspace', 'pipeline', 'picklist']
const LINKABLE = new Set(['contact', 'company', 'deal'])

// Who changed what and when, with before and after values. Owners and admins only.
export function AuditLog() {
  const { t, i18n } = useTranslation()
  const [params, setParams] = useSearchParams()
  const members = useMembers()
  const query = new URLSearchParams(params)
  const log = useQuery({
    queryKey: ['audit', query.toString()],
    queryFn: () => api(`/audit?${query}`, auditPageSchema),
    placeholderData: keepPreviousData,
  })
  const set = (changes: Record<string, string | null>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v)
        else next.delete(k)
      }
      if (!('page' in changes)) next.delete('page')
      return next
    })

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field id="audit-actor" label={t('audit.who')}>
          <NativeSelect id="audit-actor" value={params.get('actor') ?? ''} onChange={(e) => set({ actor: e.target.value })}>
            <option value="">{t('common.all')}</option>
            {members.data?.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="audit-type" label={t('audit.what')}>
          <NativeSelect id="audit-type" value={params.get('entityType') ?? ''} onChange={(e) => set({ entityType: e.target.value, entityId: null })}>
            <option value="">{t('common.all')}</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`audit.entities.${type}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="audit-from" label={t('list.createdFrom')}>
          <Input id="audit-from" type="date" value={params.get('from') ?? ''} onChange={(e) => set({ from: e.target.value })} />
        </Field>
        <Field id="audit-to" label={t('list.createdTo')}>
          <Input id="audit-to" type="date" value={params.get('to') ?? ''} onChange={(e) => set({ to: e.target.value })} />
        </Field>
      </div>
      {params.get('entityId') && (
        <div className="bg-muted flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm">
          <span>{t('audit.oneRecord', { name: log.data?.items[0]?.entityName ?? '…' })}</span>
          <Button variant="ghost" size="sm" onClick={() => set({ entityId: null })}>
            <X className="size-4" aria-hidden />
            {t('list.clearFilters')}
          </Button>
        </div>
      )}

      {log.isPending ? (
        <Skeleton className="h-64" />
      ) : log.isError ? (
        <p className="text-destructive">{errorMessage(t, log.error)}</p>
      ) : log.data.items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('audit.empty')}</p>
      ) : (
        <>
          <ol className="divide-y rounded-md border" aria-label={t('settings.audit')}>
            {log.data.items.map((entry) => (
              <Entry key={entry.id} entry={entry} lang={i18n.language} />
            ))}
          </ol>
          <Pagination
            page={log.data.page}
            pageSize={log.data.pageSize}
            total={log.data.total}
            onPage={(page) => set({ page: String(page) })}
            onPageSize={(size) => set({ pageSize: String(size) })}
          />
        </>
      )}
    </div>
  )
}

function show(t: ReturnType<typeof useTranslation>['t'], value: unknown): string {
  if (value === null || value === undefined || value === '') return '–'
  if (typeof value === 'boolean') return value ? t('common.yes') : t('common.no')
  if (Array.isArray(value)) return value.length ? value.map((v) => show(t, v)).join(', ') : '–'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function Entry({ entry: e, lang }: { entry: AuditEntry; lang: string }) {
  const { t } = useTranslation()
  const name = e.entityName ?? (e.entityId ? t(`audit.entities.${e.entityType}`, { defaultValue: e.entityType }) : '')
  return (
    <li className="grid gap-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm">
          <span className="font-medium">{e.actor ?? t('audit.system')}</span>{' '}
          {t(`audit.actions.${e.action}`, { defaultValue: e.action })}{' '}
          <span className="text-muted-foreground">{t(`audit.entities.${e.entityType}`, { defaultValue: e.entityType })}</span>{' '}
          {e.entityId && LINKABLE.has(e.entityType) && e.entityName ? (
            <Link to={recordPath({ type: e.entityType as 'contact', id: e.entityId })} className="font-medium hover:underline">
              {name}
            </Link>
          ) : (
            e.entityName && <span className="font-medium">{name}</span>
          )}
        </p>
        <time className="text-muted-foreground text-xs" dateTime={e.createdAt}>
          {formatDateTime(e.createdAt, lang)}
        </time>
      </div>
      {e.changes.length > 0 && e.action !== 'create' && (
        <table className="w-full text-xs">
          <caption className="sr-only">{t('audit.changes')}</caption>
          <thead className="text-muted-foreground text-left">
            <tr>
              <th className="w-1/4 font-medium">{t('audit.field')}</th>
              <th className="font-medium">{t('audit.before')}</th>
              <th className="font-medium">{t('audit.after')}</th>
            </tr>
          </thead>
          <tbody>
            {e.changes.map((c) => (
              <tr key={c.field} className="align-top">
                <td className="text-muted-foreground py-0.5 pr-2">{t(`audit.fields.${c.field}`, { defaultValue: c.field })}</td>
                <td className="py-0.5 pr-2 break-all line-through decoration-red-400/60">{show(t, c.before)}</td>
                <td className="py-0.5 break-all">{show(t, c.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  )
}
