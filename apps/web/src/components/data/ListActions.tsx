import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download, MoreHorizontal, Upload } from 'lucide-react'
import type { ImportObject } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useActiveWorkspace } from '@/hooks/useMe'
import { downloadCsv, fetchExport, today } from '@/lib/data'
import { errorMessage } from '@/lib/errors'

export type ExportColumn<T> = { header: string; value: (row: T) => unknown }

type Props<T> = {
  object: ImportObject
  // The list's current API parameters: the export uses the same filters and sort.
  params: URLSearchParams
  columns: ExportColumn<T>[]
  extra?: ReactNode
}

// "More" menu on list pages: import, export with the current filters, and object-specific items.
export function ListActions<T>({ object, params, columns, extra }: Props<T>) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { role } = useActiveWorkspace()
  const [exporting, setExporting] = useState(false)

  const exportCsv = async () => {
    setExporting(true)
    try {
      const { items, total, truncated } = await fetchExport(object, params)
      downloadCsv(
        `${t(`import.objects.${object}`).toLowerCase()}-${today()}.csv`,
        columns.map((c) => c.header),
        (items as T[]).map((row) => columns.map((c) => c.value(row))),
      )
      toast.success(truncated ? t('export.truncated', { count: items.length, total }) : t('export.done', { count: items.length }))
    } catch (err) {
      toast.error(errorMessage(t, err))
    } finally {
      setExporting(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label={t('list.moreActions')} disabled={exporting}>
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={exportCsv}>
          <Download className="size-4" aria-hidden />
          {t('export.button')}
        </DropdownMenuItem>
        {role !== 'viewer' && (
          <DropdownMenuItem onSelect={() => navigate(`/import?object=${object}`)}>
            <Upload className="size-4" aria-hidden />
            {t('import.button')}
          </DropdownMenuItem>
        )}
        {extra}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
