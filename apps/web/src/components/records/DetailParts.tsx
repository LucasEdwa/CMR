import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from './EmptyState'

// Label/value rows; empty values are skipped so the page only shows what is known.
export function DetailList({ items }: { items: Array<[string, ReactNode]> }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false)
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground text-sm">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function RecordNotFound({ backTo }: { backTo: string }) {
  const { t } = useTranslation()
  return (
    <div className="mx-auto max-w-3xl">
      <EmptyState
        icon={SearchX}
        title={t('common.notFound')}
        body={t('common.notFoundBody')}
        action={
          <Button asChild variant="outline">
            <Link to={backTo}>{t('common.back')}</Link>
          </Button>
        }
      />
    </div>
  )
}
