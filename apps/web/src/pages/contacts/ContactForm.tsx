import { useState } from 'react'
import { z } from 'zod'
import { Link } from 'react-router'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CONSENT_BASES, LIFECYCLE_STAGES, createContactSchema, type Contact, type CreateContactInput } from '@crm/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Field } from '@/components/Field'
import { NativeSelect } from '@/components/NativeSelect'
import { CompanyPicker } from '@/components/records/CompanyPicker'
import { OwnerSelect } from '@/components/records/OwnerSelect'
import { TagInput } from '@/components/records/TagInput'
import { useMe } from '@/hooks/useMe'
import { ApiRequestError } from '@/lib/api'
import { recordApi, useRecordMutation } from '@/lib/crm'
import { errorMessage } from '@/lib/errors'
import { describedBy, fieldError } from '@/lib/form'
import { picklistLabel, usePicklists } from '@/lib/deals'

type Ref = { id: string; name: string } | null

// Selects use "" for "none"; the shared schema expects null there, so the form accepts both.
const formSchema = createContactSchema.extend({
  ownerUserId: z.union([z.literal(''), z.uuid()]).nullable().optional(),
  consentBasis: z.union([z.literal(''), z.enum(CONSENT_BASES)]).nullable().optional(),
})
type FormValues = z.input<typeof formSchema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact?: Contact
  defaultCompany?: Ref
  onSaved?: (contact: Contact) => void
}

export function ContactForm({ open, onOpenChange, contact, defaultCompany = null, onSaved }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {open && <ContactFormBody contact={contact} defaultCompany={defaultCompany} onDone={(c) => { onOpenChange(false); onSaved?.(c) }} onCancel={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function ContactFormBody({ contact, defaultCompany, onDone, onCancel }: { contact?: Contact; defaultCompany: Ref; onDone: (c: Contact) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const picklists = usePicklists()
  const sourceKeys = [...new Set([...(picklists.data?.lead_source.map((s) => s.key) ?? []), ...(contact?.leadSource ? [contact.leadSource] : [])])]
  const [company, setCompany] = useState<Ref>(contact?.company ?? defaultCompany)
  const [suggestion, setSuggestion] = useState<Ref>(null)
  const [duplicate, setDuplicate] = useState<{ contactId: string; name: string } | null>(null)
  const form = useForm<FormValues, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: contact?.firstName ?? '',
      lastName: contact?.lastName ?? '',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
      mobilePhone: contact?.mobilePhone ?? '',
      title: contact?.title ?? '',
      ownerUserId: contact ? (contact.owner?.id ?? '') : (me?.user.id ?? ''),
      lifecycleStage: contact?.lifecycleStage ?? 'lead',
      leadSource: contact?.leadSource ?? '',
      marketingConsent: contact?.marketingConsent ?? false,
      consentBasis: contact?.consentBasis ?? null,
      street: contact?.street ?? '',
      postalCode: contact?.postalCode ?? '',
      city: contact?.city ?? '',
      tags: contact?.tags ?? [],
    },
  })
  const { errors, isSubmitting } = form.formState

  const save = useRecordMutation((body: object) =>
    contact ? recordApi.updateContact(contact.id, body) : recordApi.createContact(body),
  )

  const onSubmit = form.handleSubmit(async (values) => {
    setDuplicate(null)
    const body = { ...values, ownerUserId: values.ownerUserId || null, companyId: company?.id ?? null, consentBasis: values.consentBasis || null }
    try {
      const saved = (await save.mutateAsync(body)) as Contact
      toast.success(t(contact ? 'contacts.saved' : 'contacts.created_toast'))
      onDone(saved)
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'duplicate_email') {
        setDuplicate(err.details as { contactId: string; name: string })
      } else {
        toast.error(errorMessage(t, err))
      }
    }
  })

  const suggestCompany = async (email: string) => {
    if (company || !email.includes('@')) return setSuggestion(null)
    const { company: match } = await recordApi.suggestCompany(email).catch(() => ({ company: null }))
    setSuggestion(match)
  }

  const text = (name: keyof FormValues & keyof CreateContactInput, label: string, opts: { type?: string; autoComplete?: string } = {}) => (
    <Field id={name} label={label} error={fieldError(t, errors[name] as never, name === 'email' ? 'email' : undefined)}>
      <Input id={name} type={opts.type} autoComplete={opts.autoComplete ?? 'off'} aria-invalid={!!errors[name]} {...describedBy(name, !!errors[name])} {...form.register(name)} />
    </Field>
  )

  return (
    <form className="grid gap-4 px-4 pb-4" onSubmit={onSubmit} noValidate>
      <SheetHeader className="px-0">
        <SheetTitle>{contact ? t('contacts.edit') : t('contacts.new')}</SheetTitle>
      </SheetHeader>
      {duplicate && (
        <Alert variant="destructive">
          <AlertDescription>
            {t('contacts.duplicate', { name: duplicate.name })}{' '}
            <Link className="underline" to={`/contacts/${duplicate.contactId}`} onClick={onCancel}>
              {t('contacts.openExisting')}
            </Link>
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {text('firstName', t('contacts.firstName'))}
        {text('lastName', t('contacts.lastName'))}
      </div>
      <Field id="email" label={t('contacts.email')} error={fieldError(t, errors.email, 'email')}>
        <Input id="email" type="email" autoComplete="off" aria-invalid={!!errors.email} {...describedBy('email', !!errors.email)} {...form.register('email', { onBlur: (e) => suggestCompany(e.target.value) })} />
      </Field>
      {suggestion && !company && (
        <div className="bg-muted flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm" role="status">
          {t('contacts.suggestCompany', { name: suggestion.name })}
          <Button type="button" size="sm" variant="secondary" onClick={() => { setCompany(suggestion); setSuggestion(null) }}>
            {t('contacts.link')}
          </Button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {text('phone', t('contacts.phone'), { type: 'tel' })}
        {text('mobilePhone', t('contacts.mobilePhone'), { type: 'tel' })}
      </div>
      {text('title', t('contacts.title_field'))}
      <Field id="company" label={t('contacts.company')}>
        <CompanyPicker id="company" value={company} onChange={setCompany} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="ownerUserId" label={t('list.owner')}>
          <OwnerSelect id="ownerUserId" {...form.register('ownerUserId')} />
        </Field>
        <Field id="lifecycleStage" label={t('contacts.lifecycleStage')}>
          <NativeSelect id="lifecycleStage" {...form.register('lifecycleStage')}>
            {LIFECYCLE_STAGES.map((s) => (
              <option key={s} value={s}>
                {t(`stages.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field id="leadSource" label={t('contacts.leadSource')}>
        <NativeSelect id="leadSource" {...form.register('leadSource')}>
          <option value="">{t('common.none')}</option>
          {sourceKeys.map((key) => (
            <option key={key} value={key}>
              {picklistLabel(t, picklists.data, 'lead_source', key)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="tags" label={t('list.tags')}>
        <Controller control={form.control} name="tags" render={({ field }) => <TagInput id="tags" value={field.value ?? []} onChange={field.onChange} />} />
      </Field>

      <fieldset className="grid gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t('contacts.address')}</legend>
        {text('street', t('contacts.street'), { autoComplete: 'off' })}
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          {text('postalCode', t('contacts.postalCode'))}
          {text('city', t('contacts.city'))}
        </div>
      </fieldset>

      <fieldset className="grid gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t('contacts.consent')}</legend>
        <Controller
          control={form.control}
          name="marketingConsent"
          render={({ field }) => (
            <div className="flex items-center gap-2">
              <Checkbox id="marketingConsent" checked={!!field.value} onCheckedChange={(v) => field.onChange(v === true)} />
              <Label htmlFor="marketingConsent">{t('contacts.marketingConsent')}</Label>
            </div>
          )}
        />
        <Field id="consentBasis" label={t('contacts.consentBasis')}>
          <NativeSelect id="consentBasis" {...form.register('consentBasis')}>
            <option value="">{t('common.none')}</option>
            {CONSENT_BASES.map((b) => (
              <option key={b} value={b}>
                {t(`consentBases.${b}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </fieldset>

      <SheetFooter className="flex-row justify-end gap-2 px-0">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {contact ? t('common.save') : t('common.create')}
        </Button>
      </SheetFooter>
    </form>
  )
}
