import { useState } from 'react'
import { Link } from 'react-router'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { COMPANY_SIZES, createCompanySchema, type Company } from '@crm/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Field } from '@/components/Field'
import { NativeSelect } from '@/components/NativeSelect'
import { OwnerSelect } from '@/components/records/OwnerSelect'
import { TagInput } from '@/components/records/TagInput'
import { useMe } from '@/hooks/useMe'
import { ApiRequestError } from '@/lib/api'
import { recordApi, useRecordMutation } from '@/lib/crm'
import { errorMessage } from '@/lib/errors'
import { describedBy, fieldError } from '@/lib/form'

const formSchema = createCompanySchema.extend({
  ownerUserId: z.union([z.literal(''), z.uuid()]).nullable().optional(),
  size: z.union([z.literal(''), z.enum(COMPANY_SIZES)]).nullable().optional(),
})
type FormValues = z.input<typeof formSchema>

type Props = { open: boolean; onOpenChange: (open: boolean) => void; company?: Company; onSaved?: (c: Company) => void }

export function CompanyForm({ open, onOpenChange, company, onSaved }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {open && (
          <CompanyFormBody
            company={company}
            onCancel={() => onOpenChange(false)}
            onDone={(c) => {
              onOpenChange(false)
              onSaved?.(c)
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function CompanyFormBody({ company, onDone, onCancel }: { company?: Company; onDone: (c: Company) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const [duplicate, setDuplicate] = useState<{ companyId: string; name: string } | null>(null)
  const form = useForm<FormValues, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: company?.name ?? '',
      orgNumber: company?.orgNumber ?? '',
      vatNumber: company?.vatNumber ?? '',
      domain: company?.domain ?? '',
      industry: company?.industry ?? '',
      size: company?.size ?? '',
      phone: company?.phone ?? '',
      ownerUserId: company ? (company.owner?.id ?? '') : (me?.user.id ?? ''),
      street: company?.street ?? '',
      postalCode: company?.postalCode ?? '',
      city: company?.city ?? '',
      tags: company?.tags ?? [],
    },
  })
  const { errors, isSubmitting } = form.formState
  const save = useRecordMutation((body: object) => (company ? recordApi.updateCompany(company.id, body) : recordApi.createCompany(body)))

  const onSubmit = form.handleSubmit(async (values) => {
    setDuplicate(null)
    try {
      const saved = (await save.mutateAsync({ ...values, ownerUserId: values.ownerUserId || null, size: values.size || null })) as Company
      toast.success(t(company ? 'companies.saved' : 'companies.created_toast'))
      onDone(saved)
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'duplicate_org_number') setDuplicate(err.details as { companyId: string; name: string })
      else toast.error(errorMessage(t, err))
    }
  })

  const text = (name: 'name' | 'orgNumber' | 'vatNumber' | 'domain' | 'industry' | 'phone' | 'street' | 'postalCode' | 'city', label: string, extra: { inputMode?: 'numeric' | 'tel' | 'url'; placeholder?: string } = {}) => (
    <Field id={name} label={label} error={fieldError(t, errors[name])}>
      <Input id={name} autoComplete="off" aria-invalid={!!errors[name]} {...describedBy(name, !!errors[name])} {...extra} {...form.register(name)} />
    </Field>
  )

  return (
    <form className="grid gap-4 px-4 pb-4" onSubmit={onSubmit} noValidate>
      <SheetHeader className="px-0">
        <SheetTitle>{company ? t('companies.edit') : t('companies.new')}</SheetTitle>
      </SheetHeader>
      {duplicate && (
        <Alert variant="destructive">
          <AlertDescription>
            {t('companies.duplicate', { name: duplicate.name })}{' '}
            <Link className="underline" to={`/companies/${duplicate.companyId}`} onClick={onCancel}>
              {t('contacts.openExisting')}
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {text('name', t('companies.name'))}
      <div className="grid gap-4 sm:grid-cols-2">
        {text('orgNumber', t('companies.orgNumber'), { inputMode: 'numeric', placeholder: '556677-8899' })}
        {text('vatNumber', t('companies.vatNumber'), { placeholder: 'SE556677889901' })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {text('domain', t('companies.domain'), { inputMode: 'url', placeholder: 'acme.se' })}
        {text('phone', t('companies.phone'), { inputMode: 'tel' })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {text('industry', t('companies.industry'))}
        <Field id="size" label={t('companies.size')}>
          <NativeSelect id="size" {...form.register('size')}>
            <option value="">{t('common.none')}</option>
            {COMPANY_SIZES.map((s) => (
              <option key={s} value={s}>
                {t(`sizes.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field id="ownerUserId" label={t('list.owner')}>
        <OwnerSelect id="ownerUserId" {...form.register('ownerUserId')} />
      </Field>
      <Field id="tags" label={t('list.tags')}>
        <Controller control={form.control} name="tags" render={({ field }) => <TagInput id="tags" value={field.value ?? []} onChange={field.onChange} />} />
      </Field>
      <fieldset className="grid gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t('contacts.address')}</legend>
        {text('street', t('contacts.street'))}
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          {text('postalCode', t('contacts.postalCode'))}
          {text('city', t('contacts.city'))}
        </div>
      </fieldset>
      <SheetFooter className="flex-row justify-end gap-2 px-0">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {company ? t('common.save') : t('common.create')}
        </Button>
      </SheetFooter>
    </form>
  )
}
