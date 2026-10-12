import { forwardRef, type HTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Hourglass } from 'lucide-react'
import { formatMoney, type Deal } from '@crm/shared'
import { Badge } from '@/components/ui/badge'
import { daysSince } from '@/lib/deals'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

type Props = HTMLAttributes<HTMLDivElement> & { deal: Deal; dragging?: boolean }

export const DealCard = forwardRef<HTMLDivElement, Props>(({ deal, dragging, className, ...props }, ref) => {
  const { t, i18n } = useTranslation()
  return (
    <div
      ref={ref}
      className={cn(
        'bg-card grid gap-1.5 rounded-md border p-3 text-sm shadow-xs',
        dragging && 'ring-ring/50 rotate-1 shadow-lg ring-2',
        deal.stale && 'border-amber-400/70',
        className,
      )}
      {...props}
    >
      <div className="font-medium leading-snug">{deal.name}</div>
      {deal.company && <div className="text-muted-foreground truncate">{deal.company.name}</div>}
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium tabular-nums">{formatMoney(deal.value, deal.currency)}</span>
        {deal.owner && (
          <span title={deal.owner.name} className="bg-muted text-muted-foreground grid size-6 place-items-center rounded-full text-[10px] font-medium">
            {initials(deal.owner.name)}
          </span>
        )}
      </div>
      {(deal.expectedCloseDate || deal.stale) && (
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {deal.expectedCloseDate && (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3.5" aria-hidden />
              {formatDate(deal.expectedCloseDate, i18n.language)}
            </span>
          )}
          {deal.stale && (
            <Badge variant="outline" className="gap-1 border-amber-400/70 text-amber-700 dark:text-amber-400" title={t('deals.staleFor', { days: daysSince(deal.lastActivityAt) })}>
              <Hourglass className="size-3" aria-hidden />
              {t('deals.stale')}
            </Badge>
          )}
        </div>
      )}
    </div>
  )
})
DealCard.displayName = 'DealCard'
