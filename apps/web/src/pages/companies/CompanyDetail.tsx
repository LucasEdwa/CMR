import { type ReactNode, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { HistoryLink } from '@/components/records/HistoryLink'
import { ConfirmDialog } from '@/components/records/ConfirmDialog'
import { DetailList, RecordNotFound } from '@/components/records/DetailParts'
import { useActiveWorkspace } from '@/hooks/useMe'
import { ApiRequestError } from '@/lib/api'
import { fullName, recordApi, useCompany, useContactList, useRecordMutation } from '@/lib/crm'
import { dataApi } from '@/lib/data'
import { errorMessage } from '@/lib/errors'
import { formatAmount, formatDate } from '@/lib/format'
import { ContactForm } from '../contacts/ContactForm'
import { CompanyForm } from './CompanyForm'
import { Timeline } from '@/components/activities/Timeline'
import { RecordTasks } from '@/components/tasks/RecordTasks'
import { RelatedDeals } from '../deals/RelatedDeals'
import { picklistLabel, usePicklists } from '@/lib/deals'

export function CompanyDetail() {
  const { t, i18n } = useTranslation()
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { role } = useActiveWorkspace()
  const canWrite = role !== 'viewer'
  const company = useCompany(id)
  const picklists = usePicklists()
  const contacts = useContactList(new URLSearchParams({ companyId: id, pageSize: '100' }))
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [addingContact, setAddingContact] = useState(false)
  const remove = useRecordMutation(() => recordApi.deleteCompany(id))

  // For "recently viewed" in the search palette.
  const loaded = company.isSuccess
  useEffect(() => {
    if (loaded) void dataApi.viewed({ type: 'company', id })
  }, [loaded, id])

  if (company.isPending) return <Skeleton className="mx-auto h-96 max-w-4xl" />
  if (company.error instanceof ApiRequestError && company.error.status === 404) return <RecordNotFound backTo="/companies" />
  if (company.isError) return <p className="text-destructive">{errorMessage(t, company.error)}</p>

  const c = company.data
  const joinAddress = (street: string | null, postalCode: string | null, city: string | null) =>
    [street, [postalCode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const address = joinAddress(c.street, c.postalCode, c.city)
  const invoiceAddress = joinAddress(c.invoiceStreet, c.invoicePostalCode, c.invoiceCity)
  const deliveryAddress = joinAddress(c.deliveryStreet, c.deliveryPostalCode, c.deliveryCity)
  // A discount of 0 is the same as none; showing it on every customer is noise.
  const percent = (n: number | null) => (n ? `${n.toLocaleString(i18n.language)} %` : null)
  const mail = (email: string | null) => email && <a className="underline" href={`mailto:${email}`}>{email}</a>
  const billing: Array<[string, ReactNode]> = [
    [t('companies.invoiceAddress'), invoiceAddress],
    [t('companies.invoiceEmail'), mail(c.invoiceEmail)],
    [t('companies.deliveryAddress'), deliveryAddress],
    [t('companies.fortnoxCustomerNumber'), c.fortnoxCustomerNumber],
    [t('companies.paymentTermDays'), c.paymentTermDays !== null && t('companies.paymentTerm', { count: c.paymentTermDays })],
    [t('companies.creditApproved'), t(c.creditApproved ? 'common.yes' : 'common.no')],
    [t('companies.creditLimit'), c.creditLimit !== null && formatAmount(c.creditLimit)],
    [t('companies.discount'), percent(c.discount)],
    [t('companies.discountSale'), percent(c.discountSale)],
    [t('companies.discountRental'), percent(c.discountRental)],
  ]

  return (
    <div className="mx-auto grid grid-cols-1 max-w-4xl gap-6">
      <Link to="/companies" className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline">
        <ArrowLeft className="size-4" aria-hidden />
        {t('companies.title')}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <span className="truncate">{c.name}</span>
            {c.customerType === 'private' && <Badge variant="outline">{t('companies.customerTypes.private')}</Badge>}
          </h1>
          <p className="text-muted-foreground">{[c.tradeName, c.orgNumber, c.city].filter(Boolean).join(' · ')}</p>
          {c.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <HistoryLink record={{ type: 'company', id: c.id }} />
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden />
              {t('common.edit')}
            </Button>
            <Button variant="outline" onClick={() => setDeleting(true)}>
              <Trash2 className="size-4" aria-hidden />
              {t('common.delete')}
            </Button>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_20rem]">
        <div className="grid min-w-0 content-start gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('contacts.details')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                [t('companies.customerType'), t(`companies.customerTypes.${c.customerType}`)],
                [t('companies.tradeName'), c.tradeName],
                [t('companies.orgNumber'), c.orgNumber],
                [t('companies.vatNumber'), c.vatNumber],
                [t('companies.email'), mail(c.email)],
                [t('companies.domain'), c.domain && <a className="underline" href={`https://${c.domain}`} target="_blank" rel="noreferrer">{c.domain}</a>],
                [t('companies.phone'), c.phone && <a className="underline" href={`tel:${c.phone}`}>{c.phone}</a>],
                [t('companies.industry'), picklistLabel(t, picklists.data, 'industry', c.industry)],
                [t('companies.size'), c.size && t(`sizes.${c.size}`)],
                [t('list.owner'), c.owner?.name],
                [t('contacts.address'), address],
                [t('contacts.created'), formatDate(c.createdAt, i18n.language)],
                [t('companies.notes'), c.notes && <span className="whitespace-pre-line">{c.notes}</span>],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('companies.billing')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList items={billing} />
          </CardContent>
        </Card>
        <Timeline record={{ type: 'company', id: c.id }} />
        </div>

        <div className="grid min-w-0 content-start gap-6">
        <RecordTasks record={{ type: 'company', id: c.id, name: c.name }} />
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>
              <h2>
                {t('companies.contacts')} ({c.contactCount})
              </h2>
            </CardTitle>
            {canWrite && (
              <Button size="sm" variant="ghost" onClick={() => setAddingContact(true)} aria-label={t('companies.addContact')}>
                <Plus className="size-4" aria-hidden />
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {contacts.data?.items.length ? (
              <ul className="-mx-2 grid">
                {contacts.data.items.map((p) => (
                  <li key={p.id}>
                    <Link to={`/contacts/${p.id}`} className="hover:bg-muted block rounded-md px-2 py-1.5">
                      <div className="truncate">{fullName(p)}</div>
                      {p.title && <div className="text-muted-foreground truncate text-sm">{p.title}</div>}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">{t('companies.noContacts')}</p>
            )}
          </CardContent>
        </Card>
        <RelatedDeals filter={{ companyId: c.id }} company={{ id: c.id, name: c.name }} />
        </div>
      </div>

      <CompanyForm open={editing} onOpenChange={setEditing} company={c} />
      <ContactForm open={addingContact} onOpenChange={setAddingContact} defaultCompany={{ id: c.id, name: c.name }} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('common.delete')}
        description={t('companies.confirmDelete', { name: c.name })}
        confirmLabel={t('common.delete')}
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => navigate('/companies'),
            onError: (err) => toast.error(errorMessage(t, err)),
          })
        }
      />
    </div>
  )
}
