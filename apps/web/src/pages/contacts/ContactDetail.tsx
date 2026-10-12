import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, Building2, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/records/ConfirmDialog'
import { DetailList, RecordNotFound } from '@/components/records/DetailParts'
import { useActiveWorkspace } from '@/hooks/useMe'
import { ApiRequestError } from '@/lib/api'
import { fullName, recordApi, useContact, useRecordMutation } from '@/lib/crm'
import { errorMessage } from '@/lib/errors'
import { formatDate, formatDateTime } from '@/lib/format'
import { ContactForm } from './ContactForm'
import { RelatedDeals } from '../deals/RelatedDeals'
import { picklistLabel, usePicklists } from '@/lib/deals'

export function ContactDetail() {
  const { t, i18n } = useTranslation()
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { role } = useActiveWorkspace()
  const canWrite = role !== 'viewer'
  const contact = useContact(id)
  const picklists = usePicklists()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const remove = useRecordMutation(() => recordApi.deleteContact(id))

  if (contact.isPending) return <Skeleton className="mx-auto h-96 max-w-4xl" />
  if (contact.error instanceof ApiRequestError && contact.error.status === 404) return <RecordNotFound backTo="/contacts" />
  if (contact.isError) return <p className="text-destructive">{errorMessage(t, contact.error)}</p>

  const c = contact.data
  const name = fullName(c)
  const address = [c.street, [c.postalCode, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')

  return (
    <div className="mx-auto grid grid-cols-1 max-w-4xl gap-6">
      <Link to="/contacts" className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline">
        <ArrowLeft className="size-4" aria-hidden />
        {t('contacts.title')}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{name}</h1>
          <p className="text-muted-foreground">
            {[c.title, c.company?.name].filter(Boolean).join(' · ')}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge>{t(`stages.${c.lifecycleStage}`)}</Badge>
            {c.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
        {canWrite && (
          <div className="flex gap-2">
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

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_18rem]">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('contacts.details')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                [t('contacts.email'), c.email && <a className="underline" href={`mailto:${c.email}`}>{c.email}</a>],
                [t('contacts.phone'), c.phone && <a className="underline" href={`tel:${c.phone}`}>{c.phone}</a>],
                [t('contacts.mobilePhone'), c.mobilePhone && <a className="underline" href={`tel:${c.mobilePhone}`}>{c.mobilePhone}</a>],
                [t('list.owner'), c.owner?.name],
                [t('contacts.leadSource'), picklistLabel(t, picklists.data, 'lead_source', c.leadSource)],
                [t('contacts.address'), address],
                [
                  t('contacts.consent'),
                  <>
                    {c.marketingConsent ? t('contacts.marketingConsent') : t('common.no')}
                    {c.consentBasis && ` · ${t(`consentBases.${c.consentBasis}`)}`}
                    {c.consentUpdatedAt && (
                      <span className="text-muted-foreground block text-sm">
                        {t('contacts.consentUpdated', { date: formatDateTime(c.consentUpdatedAt, i18n.language) })}
                      </span>
                    )}
                  </>,
                ],
                [t('contacts.created'), formatDate(c.createdAt, i18n.language)],
                [t('contacts.updated'), formatDateTime(c.updatedAt, i18n.language)],
              ]}
            />
          </CardContent>
        </Card>

        <div className="grid min-w-0 content-start gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('contacts.related')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {c.company ? (
              <Link to={`/companies/${c.company.id}`} className="hover:bg-muted -mx-2 flex items-center gap-2 rounded-md px-2 py-1.5">
                <Building2 className="text-muted-foreground size-4" aria-hidden />
                <span className="truncate">{c.company.name}</span>
              </Link>
            ) : (
              <p className="text-muted-foreground text-sm">{t('contacts.noCompany')}</p>
            )}
          </CardContent>
        </Card>
        <RelatedDeals filter={{ contactId: c.id }} contact={{ id: c.id, name }} company={c.company} />
        </div>
      </div>

      <ContactForm open={editing} onOpenChange={setEditing} contact={c} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('common.delete')}
        description={t('contacts.confirmDelete', { name })}
        confirmLabel={t('common.delete')}
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              toast.success(t('contacts.deleted'))
              navigate('/contacts')
            },
            onError: (err) => toast.error(errorMessage(t, err)),
          })
        }
      />
    </div>
  )
}
