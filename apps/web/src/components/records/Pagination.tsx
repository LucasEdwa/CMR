import { useTranslation } from 'react-i18next'
import { PAGE_SIZES } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/NativeSelect'

type Props = { page: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize: (size: number) => void }

export function Pagination({ page, pageSize, total, onPage, onPageSize }: Props) {
  const { t } = useTranslation()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 text-sm" aria-label={t('list.page', { page, pages })}>
      <span className="text-muted-foreground">{t('list.resultCount', { count: total })}</span>
      <div className="flex items-center gap-2">
        <label className="text-muted-foreground hidden items-center gap-2 sm:flex">
          {t('list.perPage')}
          <NativeSelect className="w-20" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </NativeSelect>
        </label>
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t('list.previous')}
        </Button>
        <span className="tabular-nums">{t('list.page', { page, pages })}</span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t('list.next')}
        </Button>
      </div>
    </nav>
  )
}
