import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/Field'
import { LanguageToggle } from '@/components/LanguageToggle'
import { NativeSelect } from '@/components/NativeSelect'
import { ME_KEY, useMe } from '@/hooks/useMe'
import { send } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { describedBy, fieldError } from '@/lib/form'

const schema = z.object({ name: z.string().trim().min(1).max(100) })
const TIMEZONES = Intl.supportedValuesOf('timeZone')

export function Profile() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { name: '' } })
  const { errors, isDirty } = form.formState

  useEffect(() => {
    if (me) form.reset({ name: me.user.name })
  }, [me, form])

  const update = useMutation({
    mutationFn: (body: { name?: string; locale?: string; timezone?: string | null }) => send('PATCH', '/me', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_KEY }),
    onError: (err) => toast.error(errorMessage(t, err)),
  })

  return (
    <div className="grid max-w-md gap-8">
      <form
        className="grid gap-4"
        onSubmit={form.handleSubmit((v) => update.mutate(v, { onSuccess: () => toast.success(t('common.saved')) }))}
        noValidate
      >
        <Field id="name" label={t('common.name')} error={fieldError(t, errors.name)}>
          <Input id="name" autoComplete="name" aria-invalid={!!errors.name} {...describedBy('name', !!errors.name)} {...form.register('name')} />
        </Field>
        <Field id="email" label={t('common.email')}>
          <Input id="email" value={me?.user.email ?? ''} readOnly disabled />
        </Field>
        <Button type="submit" className="justify-self-start" disabled={!isDirty || update.isPending}>
          {t('common.save')}
        </Button>
      </form>
      <section className="grid gap-2">
        <h2 className="text-sm font-medium">{t('language.label')}</h2>
        <LanguageToggle onChange={(locale) => update.mutate({ locale })} />
      </section>
      <section className="grid gap-2">
        <label htmlFor="profile-timezone" className="text-sm font-medium">
          {t('settings.timezone')}
        </label>
        <NativeSelect
          id="profile-timezone"
          aria-describedby="profile-timezone-hint"
          value={me?.user.timezone ?? ''}
          disabled={!me || update.isPending}
          onChange={(e) =>
            update.mutate({ timezone: e.target.value || null }, { onSuccess: () => toast.success(t('common.saved')) })
          }
        >
          <option value="">{t('settings.workspaceTimezone')}</option>
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replaceAll('_', ' ')}
            </option>
          ))}
        </NativeSelect>
        <p id="profile-timezone-hint" className="text-muted-foreground text-sm">
          {t('settings.timezoneHint')}
        </p>
      </section>
    </div>
  )
}
