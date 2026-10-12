import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
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
}

export function DataTable<T>({ rows, columns, rowHref, rowKey, sort, dir, onSort, mobile, dimmed }: Props<T>) {
  return (
    <div className={cn('transition-opacity', dimmed && 'opacity-60')}>
      <ul className="divide-y rounded-md border md:hidden">
        {rows.map((row) => {
          const card = mobile(row)
          return (
            <li key={rowKey(row)}>
              <Link to={rowHref(row)} className="hover:bg-muted/50 block px-3 py-2.5">
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
              <TableRow key={rowKey(row)} className="relative">
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
