import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { formatMoney } from '@crm/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useActiveWorkspace } from '@/hooks/useMe'
import { statusVariant, useDealList } from '@/lib/deals'
import { DealForm } from './DealForm'

type Ref = { id: string; name: string }
type Props = { filter: { contactId: string } | { companyId: string }; contact?: Ref; company?: Ref | null }

// Deals card for contact and company pages; "New deal" pre-fills the contact and company.
export function RelatedDeals({ filter, contact, company }: Props) {
  const { t } = useTranslation()
  const { role } = useActiveWorkspace()
  const [creating, setCreating] = useState(false)
  const deals = useDealList(new URLSearchParams({ ...filter, pageSize: '25', sort: 'updatedAt', dir: 'desc' }))
  const items = deals.data?.items ?? []

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>
          <h2>
            {t('deals.title')} ({deals.data?.total ?? 0})
          </h2>
        </CardTitle>
        {role !== 'viewer' && (
          <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {t('deals.new')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {items.length ? (
          <ul className="-mx-2 grid">
            {items.map((d) => (
              <li key={d.id}>
                <Link to={`/deals/${d.id}`} className="hover:bg-muted grid grid-cols-1 gap-0.5 rounded-md px-2 py-1.5">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate">{d.name}</span>
                    <span className="shrink-0 text-sm tabular-nums">{formatMoney(d.value, d.currency)}</span>
                  </span>
                  <span className="text-muted-foreground flex items-center gap-2 text-xs">
                    {d.status === 'open' ? d.stage.name : <Badge variant={statusVariant(d.status)}>{t(`deals.statuses.${d.status}`)}</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t('deals.emptyColumn')}</p>
        )}
      </CardContent>
      <DealForm open={creating} onOpenChange={setCreating} defaults={{ contacts: contact ? [contact] : [], company: company ?? null }} />
    </Card>
  )
}
