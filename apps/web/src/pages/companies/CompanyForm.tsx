import { useState } from 'react'
import { Link } from 'react-router'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { COMPANY_SIZES, CUSTOMER_TYPES, createCompanySchema, parseDecimal, parseMoney, type Company } from '@crm/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { picklistLabel, usePicklists } from '@/lib/deals'

// Numbers are typed as text ("1 500,50", "12,5") and converted on save.
const numberText = (parse: (v: string) => number | null) =>
  z.string().refine((v) => v.trim() === '' || parse(v) !== null, 'invalid_number')
const days = (v: string) => (/^\d+$/.test(v.trim()) && Number(v) <= 365 ? Number(v) : null)
const percent = (v: string) => {
  const n = parseDecimal(v)
  return n !== null && n >= 0 && n <= 100 ? n : null
}
const kronor = (v: string) => {
  const n = parseMoney(v)
  return n !== null && n >= 0 ? n : null
}
const toNumber = (v: string, parse: (v: string) => number | null) => (v.trim() === '' ? null : parse(v))

const formSchema = createCompanySchema.extend({
  ownerUserId: z.union([z.literal(''), z.uuid()]).nullable().optional(),
  size: z.union([z.literal(''), z.enum(COMPANY_SIZES)]).nullable().optional(),
  paymentTermDays: numberText(days),
  creditLimit: numberText(kronor),
  discount: numberText(percent),
  discountSale: numberText(percent),
  discountRental: numberText(percent),
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
  const picklists = usePicklists()
  const industryKeys = [...new Set([...(picklists.data?.industry.map((s) => s.key) ?? []), ...(company?.industry ? [company.industry] : [])])]
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
      customerType: company?.customerType ?? 'company',
      tradeName: company?.tradeName ?? '',
      email: company?.email ?? '',
      notes: company?.notes ?? '',
      invoiceStreet: company?.invoiceStreet ?? '',
      invoicePostalCode: company?.invoicePostalCode ?? '',
      invoiceCity: company?.invoiceCity ?? '',
      invoiceEmail: company?.invoiceEmail ?? '',
      deliveryStreet: company?.deliveryStreet ?? '',
      deliveryPostalCode: company?.deliveryPostalCode ?? '',
      deliveryCity: company?.deliveryCity ?? '',
      fortnoxCustomerNumber: company?.fortnoxCustomerNumber ?? '',
      paymentTermDays: company?.paymentTermDays?.toString() ?? '',
      creditApproved: company?.creditApproved ?? false,
      creditLimit: company?.creditLimit != null ? String(company.creditLimit / 100).replace('.', ',') : '',
      discount: company?.discount?.toString().replace('.', ',') ?? '',
      discountSale: company?.discountSale?.toString().replace('.', ',') ?? '',
      discountRental: company?.discountRental?.toString().replace('.', ',') ?? '',
      tags: company?.tags ?? [],
    },
  })
  const { errors, isSubmitting } = form.formState
  const save = useRecordMutation((body: object) => (company ? recordApi.updateCompany(company.id, body) : recordApi.createCompany(body)))

  const onSubmit = form.handleSubmit(async (values) => {
    setDuplicate(null)
    try {
      const saved = (await save.mutateAsync({
        ...values,
        ownerUserId: values.ownerUserId || null,
        size: values.size || null,
        paymentTermDays: toNumber(values.paymentTermDays, days),
        creditLimit: toNumber(values.creditLimit, kronor),
        discount: toNumber(values.discount, percent),
        discountSale: toNumber(values.discountSale, percent),
        discountRental: toNumber(values.discountRental, percent),
      })) as Company
      toast.success(t(company ? 'companies.saved' : 'companies.created_toast'))
      onDone(saved)
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'duplicate_org_number') setDuplicate(err.details as { companyId: string; name: string })
      else toast.error(errorMessage(t, err))
    }
  })

  type TextField =
    | 'name' | 'orgNumber' | 'vatNumber' | 'domain' | 'phone' | 'street' | 'postalCode' | 'city' | 'tradeName' | 'email'
    | 'invoiceStreet' | 'invoicePostalCode' | 'invoiceCity' | 'invoiceEmail' | 'deliveryStreet' | 'deliveryPostalCode' | 'deliveryCity'
    | 'fortnoxCustomerNumber' | 'paymentTermDays' | 'creditLimit' | 'discount' | 'discountSale' | 'discountRental'
  const text = (name: TextField, label: string, extra: { inputMode?: 'numeric' | 'decimal' | 'tel' | 'url' | 'email'; placeholder?: string } = {}) => (
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
        <Field id="customerType" label={t('companies.customerType')}>
          <NativeSelect id="customerType" {...form.register('customerType')}>
            {CUSTOMER_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`companies.customerTypes.${type}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {text('tradeName', t('companies.tradeName'))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {text('orgNumber', t('companies.orgNumber'), { inputMode: 'numeric', placeholder: '556677-8899' })}
        {text('vatNumber', t('companies.vatNumber'), { placeholder: 'SE556677889901' })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {text('domain', t('companies.domain'), { inputMode: 'url', placeholder: 'acme.se' })}
        {text('phone', t('companies.phone'), { inputMode: 'tel' })}
      </div>
      {text('email', t('companies.email'), { inputMode: 'email' })}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="industry" label={t('companies.industry')}>
          <NativeSelect id="industry" {...form.register('industry')}>
            <option value="">{t('common.none')}</option>
            {industryKeys.map((key) => (
              <option key={key} value={key}>
                {picklistLabel(t, picklists.data, 'industry', key)}
              </option>
            ))}
          </NativeSelect>
        </Field>
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
      <fieldset className="grid gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t('companies.billing')}</legend>
        {text('invoiceStreet', t('companies.invoiceAddress'))}
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          {text('invoicePostalCode', t('contacts.postalCode'))}
          {text('invoiceCity', t('contacts.city'))}
        </div>
        {text('invoiceEmail', t('companies.invoiceEmail'), { inputMode: 'email' })}
        {text('deliveryStreet', t('companies.deliveryAddress'))}
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          {text('deliveryPostalCode', t('contacts.postalCode'))}
          {text('deliveryCity', t('contacts.city'))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {text('fortnoxCustomerNumber', t('companies.fortnoxCustomerNumber'), { inputMode: 'numeric' })}
          {text('paymentTermDays', t('companies.paymentTermDays'), { inputMode: 'numeric', placeholder: '30' })}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {text('creditLimit', t('companies.creditLimit'), { inputMode: 'decimal' })}
          <Controller
            control={form.control}
            name="creditApproved"
            render={({ field }) => (
              <div className="flex items-center gap-2 sm:pt-6">
                <Checkbox id="creditApproved" checked={!!field.value} onCheckedChange={(v) => field.onChange(v === true)} />
                <Label htmlFor="creditApproved">{t('companies.creditApproved')}</Label>
              </div>
            )}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {text('discount', t('companies.discount'), { inputMode: 'decimal' })}
          {text('discountSale', t('companies.discountSale'), { inputMode: 'decimal' })}
          {text('discountRental', t('companies.discountRental'), { inputMode: 'decimal' })}
        </div>
      </fieldset>
      <Field id="notes" label={t('companies.notes')} error={fieldError(t, errors.notes)}>
        <textarea
          id="notes"
          rows={3}
          maxLength={5000}
          className="border-input focus-visible:ring-ring/50 rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
          {...form.register('notes')}
        />
      </Field>
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
