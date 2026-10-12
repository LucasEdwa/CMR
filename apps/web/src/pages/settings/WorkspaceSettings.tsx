import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CURRENCIES, DATE_FORMATS, updateWorkspaceSchema, workspaceSchema, type UpdateWorkspaceInput } from '@crm/shared'
import type { z } from 'zod'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Field } from '@/components/Field'
import { NativeSelect } from '@/components/NativeSelect'
import { ME_KEY, useActiveWorkspace } from '@/hooks/useMe'
import { api, send } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { formatWithPattern } from '@/lib/format'
import { describedBy, fieldError } from '@/lib/form'

const WORKSPACE_KEY = ['workspace'] as const

export function WorkspaceSettings() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { canManage } = useActiveWorkspace()
  const workspace = useQuery({ queryKey: WORKSPACE_KEY, queryFn: () => api('/workspace', workspaceSchema) })
  const timezones = useMemo(() => Intl.supportedValuesOf('timeZone'), [])
  const form = useForm<UpdateWorkspaceInput, unknown, z.output<typeof updateWorkspaceSchema>>({
    resolver: zodResolver(updateWorkspaceSchema),
  })
  const { errors, isSubmitting, isDirty } = form.formState

  useEffect(() => {
    if (workspace.data) form.reset({ ...workspace.data, orgNumber: workspace.data.orgNumber ?? '' })
  }, [workspace.data, form])

  const save = useMutation({
    mutationFn: (values: z.output<typeof updateWorkspaceSchema>) => send('PATCH', '/workspace', values),
    onSuccess: async () => {
      toast.success(t('common.saved'))
      await queryClient.invalidateQueries({ queryKey: WORKSPACE_KEY })
      await queryClient.invalidateQueries({ queryKey: ME_KEY })
    },
  })

  if (workspace.isPending) return <Skeleton className="h-72 w-full" />
  if (workspace.isError) return <p className="text-destructive">{errorMessage(t, workspace.error)}</p>

  const sample = new Date()
  return (
    <form className="grid max-w-md gap-4" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
      {!canManage && (
        <Alert>
          <AlertDescription>{t('settings.readOnly')}</AlertDescription>
        </Alert>
      )}
      {save.isError && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(t, save.error)}</AlertDescription>
        </Alert>
      )}
      <fieldset disabled={!canManage} className="grid gap-4">
        <Field id="name" label={t('settings.workspaceName')} error={fieldError(t, errors.name)}>
          <Input id="name" aria-invalid={!!errors.name} {...describedBy('name', !!errors.name)} {...form.register('name')} />
        </Field>
        <Field id="orgNumber" label={t('onboarding.orgNumber')} error={fieldError(t, errors.orgNumber)}>
          <Input id="orgNumber" inputMode="numeric" aria-invalid={!!errors.orgNumber} {...describedBy('orgNumber', !!errors.orgNumber)} {...form.register('orgNumber')} />
        </Field>
        <Field id="currency" label={t('settings.currency')}>
          <NativeSelect id="currency" {...form.register('currency')}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="timezone" label={t('settings.timezone')}>
          <NativeSelect id="timezone" {...form.register('timezone')}>
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replaceAll('_', ' ')}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="dateFormat" label={t('settings.dateFormat')}>
          <NativeSelect id="dateFormat" {...form.register('dateFormat')}>
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {formatWithPattern(sample, f)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {canManage && (
          <Button type="submit" className="justify-self-start" disabled={isSubmitting || save.isPending || !isDirty}>
            {t('common.save')}
          </Button>
        )}
      </fieldset>
    </form>
  )
}
