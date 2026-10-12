import { useEffect, useMemo, useState } from 'react'
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, send } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { formatDateTime, formatWithPattern } from '@/lib/format'
import { describedBy, fieldError } from '@/lib/form'

const WORKSPACE_KEY = ['workspace'] as const

export function WorkspaceSettings() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { canManage, role } = useActiveWorkspace()
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
    <div className="grid gap-10">
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
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" {...form.register('ownRecordsOnly')} />
          <span>
            <span className="font-medium">{t('settings.ownRecordsOnly')}</span>
            <span className="text-muted-foreground block">{t('settings.ownRecordsOnlyHint')}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" {...form.register('requireTwoFactor')} />
          <span>
            <span className="font-medium">{t('settings.requireTwoFactor')}</span>
            <span className="text-muted-foreground block">{t('settings.requireTwoFactorHint')}</span>
          </span>
        </label>
        {canManage && (
          <Button type="submit" className="justify-self-start" disabled={isSubmitting || save.isPending || !isDirty}>
            {t('common.save')}
          </Button>
        )}
      </fieldset>
    </form>
    {role === 'owner' && <DeleteWorkspace name={workspace.data.name} scheduledFor={workspace.data.deletionScheduledFor} />}
    </div>
  )
}

// Owners only: asks for the workspace to be erased after a 7-day grace period (name + password),
// and cancels a pending request.
function DeleteWorkspace({ name, scheduledFor }: { name: string; scheduledFor: string | null }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [password, setPassword] = useState('')
  const done = async () => {
    setOpen(false)
    setConfirm('')
    setPassword('')
    await queryClient.invalidateQueries({ queryKey: WORKSPACE_KEY })
  }
  const remove = useMutation({
    mutationFn: () => send('DELETE', '/workspace', { confirm, password }),
    onSuccess: async () => {
      toast.success(t('settings.deletionScheduledToast'))
      await done()
    },
    onError: (err) => toast.error(errorMessage(t, err)),
  })
  const cancel = useMutation({
    mutationFn: () => send('POST', '/workspace/cancel-deletion'),
    onSuccess: async () => {
      toast.success(t('settings.deletionCancelled'))
      await done()
    },
    onError: (err) => toast.error(errorMessage(t, err)),
  })
  return (
    <section className="border-destructive/40 grid max-w-md gap-3 rounded-lg border p-4" aria-labelledby="danger-zone">
      <h2 id="danger-zone" className="text-destructive font-semibold">
        {t('settings.dangerZone')}
      </h2>
      {scheduledFor ? (
        <>
          <p className="text-sm">{t('settings.deletionPending', { date: formatDateTime(scheduledFor, i18n.language) })}</p>
          <Button className="justify-self-start" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            {t('settings.cancelDeletion')}
          </Button>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">{t('settings.deleteWorkspaceBody')}</p>
          <Button variant="destructive" className="justify-self-start" onClick={() => setOpen(true)}>
            {t('settings.deleteWorkspace')}
          </Button>
        </>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.deleteWorkspaceTitle', { name })}</DialogTitle>
            <DialogDescription>{t('settings.deleteWorkspaceConfirm')}</DialogDescription>
          </DialogHeader>
          <Field id="confirm-name" label={t('settings.typeName', { name })}>
            <Input id="confirm-name" value={confirm} autoComplete="off" onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Field id="confirm-password" label={t('security.currentPassword')}>
            <Input id="confirm-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={confirm.trim().toLowerCase() !== name.trim().toLowerCase() || !password || remove.isPending}
              onClick={() => remove.mutate()}
            >
              {t('settings.scheduleDeletion')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
