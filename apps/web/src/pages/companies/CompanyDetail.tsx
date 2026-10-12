import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/records/ConfirmDialog'
import { DetailList, RecordNotFound } from '@/components/records/DetailParts'
import { useActiveWorkspace } from '@/hooks/useMe'
import { ApiRequestError } from '@/lib/api'
import { fullName, recordApi, useCompany, useContactList, useRecordMutation } from '@/lib/crm'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { ContactForm } from '../contacts/ContactForm'
import { CompanyForm } from './CompanyForm'

export function CompanyDetail() {
  const { t, i18n } = useTranslation()
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { role } = useActiveWorkspace()
  const canWrite = role !== 'viewer'
  const company = useCompany(id)
  const contacts = useContactList(new URLSearchParams({ companyId: id, pageSize: '100' }))
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [addingContact, setAddingContact] = useState(false)
  const remove = useRecordMutation(() => recordApi.deleteCompany(id))

  if (company.isPending) return <Skeleton className="mx-auto h-96 max-w-4xl" />
  if (company.error instanceof ApiRequestError && company.error.status === 404) return <RecordNotFound backTo="/companies" />
  if (company.isError) return <p className="text-destructive">{errorMessage(t, company.error)}</p>

  const c = company.data
  const address = [c.street, [c.postalCode, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <Link to="/companies" className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline">
        <ArrowLeft className="size-4" aria-hidden />
        {t('companies.title')}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{c.name}</h1>
          <p className="text-muted-foreground">{[c.orgNumber, c.city].filter(Boolean).join(' · ')}</p>
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

      <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('contacts.details')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                [t('companies.orgNumber'), c.orgNumber],
                [t('companies.vatNumber'), c.vatNumber],
                [t('companies.domain'), c.domain && <a className="underline" href={`https://${c.domain}`} target="_blank" rel="noreferrer">{c.domain}</a>],
                [t('companies.phone'), c.phone && <a className="underline" href={`tel:${c.phone}`}>{c.phone}</a>],
                [t('companies.industry'), c.industry],
                [t('companies.size'), c.size && t(`sizes.${c.size}`)],
                [t('list.owner'), c.owner?.name],
                [t('contacts.address'), address],
                [t('contacts.created'), formatDate(c.createdAt, i18n.language)],
              ]}
            />
          </CardContent>
        </Card>

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
