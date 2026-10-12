import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { CURRENCIES, type Currency, type DealDetail } from '@crm/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Field } from '@/components/Field'
import { MoneyInput } from '@/components/MoneyInput'
import { NativeSelect } from '@/components/NativeSelect'
import { CompanyPicker } from '@/components/records/CompanyPicker'
import { ContactsPicker } from '@/components/records/ContactsPicker'
import { OwnerSelect } from '@/components/records/OwnerSelect'
import { useMe } from '@/hooks/useMe'
import { useQuery } from '@tanstack/react-query'
import { workspaceSchema } from '@crm/shared'
import { api } from '@/lib/api'
import { dealApi, useDealMutation, usePipelines } from '@/lib/deals'
import { errorMessage } from '@/lib/errors'
import { describedBy, fieldError } from '@/lib/form'

type Ref = { id: string; name: string }

const formSchema = z.object({
  name: z.string().trim().min(1).max(200),
  value: z.number().int().min(0),
  currency: z.enum(CURRENCIES),
  pipelineId: z.string(),
  stageId: z.string(),
  expectedCloseDate: z.string(),
  ownerUserId: z.string(),
})
type FormValues = z.infer<typeof formSchema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  deal?: DealDetail
  // Pre-filled when created from a contact, company or board column.
  defaults?: { contacts?: Ref[]; company?: Ref | null; pipelineId?: string; stageId?: string }
  onSaved?: (deal: DealDetail) => void
}

export function DealForm({ open, onOpenChange, deal, defaults, onSaved }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {open && (
          <DealFormBody
            deal={deal}
            defaults={defaults}
            onCancel={() => onOpenChange(false)}
            onDone={(d) => {
              onOpenChange(false)
              onSaved?.(d)
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function DealFormBody({ deal, defaults = {}, onDone, onCancel }: { deal?: DealDetail; defaults?: Props['defaults']; onDone: (d: DealDetail) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const pipelines = usePipelines()
  const settings = useQuery({ queryKey: ['workspace'], queryFn: () => api('/workspace', workspaceSchema), staleTime: 60_000 })
  const firstPipeline = pipelines.data?.pipelines[0]
  const [company, setCompany] = useState<Ref | null>(deal?.company ?? defaults.company ?? null)
  const [contacts, setContacts] = useState<Ref[]>(deal?.contacts ?? defaults.contacts ?? [])
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: deal?.name ?? '',
      value: deal?.value ?? 0,
      currency: (deal?.currency ?? settings.data?.currency ?? 'SEK') as Currency,
      pipelineId: deal?.pipeline.id ?? defaults.pipelineId ?? firstPipeline?.id ?? '',
      stageId: deal?.stage.id ?? defaults.stageId ?? '',
      expectedCloseDate: deal?.expectedCloseDate ?? '',
      ownerUserId: deal ? (deal.owner?.id ?? '') : (me?.user.id ?? ''),
    },
  })
  const { errors, isSubmitting } = form.formState
  const pipelineId = useWatch({ control: form.control, name: 'pipelineId' })
  const currency = useWatch({ control: form.control, name: 'currency' })
  const stages = pipelines.data?.pipelines.find((p) => p.id === pipelineId)?.stages ?? []
  const save = useDealMutation((body: object) => (deal ? dealApi.update(deal.id, body) : dealApi.create(body)))

  const onSubmit = form.handleSubmit(async (values) => {
    const common = {
      name: values.name,
      value: values.value,
      currency: values.currency,
      expectedCloseDate: values.expectedCloseDate || null,
      ownerUserId: values.ownerUserId || null,
      companyId: company?.id ?? null,
      contactIds: contacts.map((c) => c.id),
    }
    // Stage changes of an existing deal go through the board or the stage bar (history is kept).
    const body = deal ? common : { ...common, pipelineId: values.pipelineId || undefined, stageId: values.stageId || undefined }
    try {
      const saved = (await save.mutateAsync(body)) as DealDetail
      toast.success(t(deal ? 'deals.saved' : 'deals.created'))
      onDone(saved)
    } catch (err) {
      toast.error(errorMessage(t, err))
    }
  })

  return (
    <form className="grid gap-4 px-4 pb-4" onSubmit={onSubmit} noValidate>
      <SheetHeader className="px-0">
        <SheetTitle>{deal ? t('deals.edit') : t('deals.new')}</SheetTitle>
      </SheetHeader>
      <Field id="name" label={t('deals.name')} error={fieldError(t, errors.name)}>
        <Input id="name" autoFocus autoComplete="off" aria-invalid={!!errors.name} {...describedBy('name', !!errors.name)} {...form.register('name')} />
      </Field>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <Field id="value" label={t('deals.value')}>
          <MoneyInput id="value" value={form.getValues('value')} currency={currency} onChange={(v) => form.setValue('value', v, { shouldDirty: true })} />
        </Field>
        <Field id="currency" label={t('deals.currency')}>
          <NativeSelect id="currency" {...form.register('currency')}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {!deal && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pipelineId" label={t('deals.pipeline')}>
            <NativeSelect id="pipelineId" {...form.register('pipelineId', { onChange: () => form.setValue('stageId', '') })}>
              {pipelines.data?.pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="stageId" label={t('deals.stage')}>
            <NativeSelect id="stageId" {...form.register('stageId')}>
              {stages.map((s, i) => (
                <option key={s.id} value={i === 0 ? '' : s.id}>
                  {s.name} ({s.probability} %)
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="expectedCloseDate" label={t('deals.expectedClose')}>
          <Input id="expectedCloseDate" type="date" {...form.register('expectedCloseDate')} />
        </Field>
        <Field id="ownerUserId" label={t('list.owner')}>
          <OwnerSelect id="ownerUserId" {...form.register('ownerUserId')} />
        </Field>
      </div>
      <Field id="company" label={t('deals.company')}>
        <CompanyPicker id="company" value={company} onChange={setCompany} />
      </Field>
      <Field id="contacts" label={t('deals.contacts')}>
        <ContactsPicker id="contacts" value={contacts} onChange={setContacts} />
      </Field>
      <SheetFooter className="flex-row justify-end gap-2 px-0">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {deal ? t('common.save') : t('common.create')}
        </Button>
      </SheetFooter>
    </form>
  )
}
