import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export type Column<T> = {
  id: string
  header: string
  sortKey?: string
  cell: (row: T) => ReactNode
  className?: string
}

type Props<T> = {
  rows: T[]
  columns: Column<T>[]
  rowHref: (row: T) => string
  rowKey: (row: T) => string
  sort: string
  dir: 'asc' | 'desc'
  onSort: (sortKey: string) => void
  // Phone layout: a compact card per row instead of a wide table.
  mobile: (row: T) => { title: ReactNode; lines: ReactNode[] }
  dimmed?: boolean
  // Row selection for bulk actions; leave out to hide the checkboxes.
  selection?: { selected: Set<string>; onChange: (ids: string[], selected: boolean) => void; label: (row: T) => string }
}

export function DataTable<T>({ rows, columns, rowHref, rowKey, sort, dir, onSort, mobile, dimmed, selection }: Props<T>) {
  const { t } = useTranslation()
  const pageIds = rows.map(rowKey)
  const selectedOnPage = pageIds.filter((id) => selection?.selected.has(id)).length
  const rowCheckbox = (row: T) =>
    selection && (
      <Checkbox
        checked={selection.selected.has(rowKey(row))}
        onCheckedChange={(on) => selection.onChange([rowKey(row)], on === true)}
        aria-label={t('list.selectRow', { name: selection.label(row) })}
        // Above the stretched row link.
        className="relative z-10"
      />
    )
  return (
    <div className={cn('transition-opacity', dimmed && 'opacity-60')}>
      <ul className="divide-y rounded-md border md:hidden">
        {rows.map((row) => {
          const card = mobile(row)
          return (
            <li key={rowKey(row)} className="flex items-center gap-3 pl-3">
              {rowCheckbox(row)}
              <Link to={rowHref(row)} className={cn('hover:bg-muted/50 block min-w-0 flex-1 py-2.5 pr-3', !selection && '-ml-3 pl-3')}>
                <div className="truncate font-medium">{card.title}</div>
                {card.lines.filter(Boolean).map((line, i) => (
                  <div key={i} className="text-muted-foreground truncate text-sm">
                    {line}
                  </div>
                ))}
              </Link>
            </li>
          )
        })}
      </ul>

      <div className="hidden rounded-md border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {selection && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={selectedOnPage === 0 ? false : selectedOnPage === pageIds.length ? true : 'indeterminate'}
                    onCheckedChange={() => selection.onChange(pageIds, selectedOnPage < pageIds.length)}
                    aria-label={t('list.selectPage')}
                  />
                </TableHead>
              )}
              {columns.map((col) => (
                <TableHead
                  key={col.id}
                  className={col.className}
                  aria-sort={col.sortKey && sort === col.sortKey ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {col.sortKey ? (
                    <button
                      type="button"
                      className="hover:text-foreground -mx-1 inline-flex items-center gap-1 px-1"
                      onClick={() => onSort(col.sortKey!)}
                    >
                      {col.header}
                      {sort === col.sortKey ? (
                        dir === 'asc' ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />
                      ) : (
                        <ArrowUpDown className="size-3.5 opacity-40" aria-hidden />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={rowKey(row)} className="relative" data-state={selection?.selected.has(rowKey(row)) ? 'selected' : undefined}>
                {selection && <TableCell className="w-10">{rowCheckbox(row)}</TableCell>}
                {columns.map((col, i) => (
                  <TableCell key={col.id} className={cn('max-w-64 truncate', col.className)}>
                    {/* The first cell holds the link; it stretches over the whole row for click and keyboard. */}
                    {i === 0 ? (
                      <Link to={rowHref(row)} className="font-medium after:absolute after:inset-0 focus-visible:outline-none">
                        {col.cell(row)}
                      </Link>
                    ) : (
                      col.cell(row)
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
