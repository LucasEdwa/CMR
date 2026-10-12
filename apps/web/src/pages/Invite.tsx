import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { invitationPreviewSchema, passwordSchema, type Locale } from '@crm/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/Field'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { FullPageSpinner } from '@/components/layout/FullPageSpinner'
import { useMe, useResetSession } from '@/hooks/useMe'
import { api, ApiRequestError, send } from '@/lib/api'
import { authApi } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { describedBy, fieldError } from '@/lib/form'

const newAccountSchema = z.object({ name: z.string().trim().min(1).max(100), password: passwordSchema })

export function Invite() {
  const { t, i18n } = useTranslation()
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const reset = useResetSession()
  const me = useMe()
  const [error, setError] = useState<string | null>(null)
  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api(`/invitations/${encodeURIComponent(token)}`, invitationPreviewSchema),
    retry: false,
  })
  const form = useForm({ resolver: zodResolver(newAccountSchema), defaultValues: { name: '', password: '' } })
  const { errors, isSubmitting } = form.formState

  if (preview.isPending || me.isPending) return <FullPageSpinner />

  if (preview.isError) {
    const code = preview.error instanceof ApiRequestError ? preview.error.code : 'invitation_invalid'
    return (
      <AuthLayout title={t('invite.invalidTitle')}>
        <div className="grid gap-4">
          <p>{t(`invite.${code}`, { defaultValue: t('invite.invitation_invalid') })}</p>
          <Link className="underline" to="/login">
            {t('common.backToLogin')}
          </Link>
        </div>
      </AuthLayout>
    )
  }

  const inv = preview.data
  const user = me.data?.user
  const role = t(`roles.${inv.role}`).toLowerCase()
  const accept = async (body: object = {}) => {
    setError(null)
    try {
      await send('POST', `/invitations/${encodeURIComponent(token)}/accept`, body)
      await reset()
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorMessage(t, err))
    }
  }
  const onCreate = form.handleSubmit((values) => accept({ ...values, locale: i18n.language as Locale }))
  const logout = async () => {
    await authApi.signOut()
    await reset()
  }

  return (
    <AuthLayout title={t('invite.title', { workspace: inv.workspaceName })}>
      <div className="grid gap-4">
        <p>
          {inv.invitedBy
            ? t('invite.body', { inviter: inv.invitedBy, email: inv.email, role })
            : t('invite.bodyNoInviter', { email: inv.email, role })}
        </p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {user && user.email.toLowerCase() === inv.email.toLowerCase() ? (
          <Button onClick={() => accept()}>{t('invite.join')}</Button>
        ) : user ? (
          <>
            <p className="text-muted-foreground text-sm">{t('invite.wrongAccount', { current: user.email, email: inv.email })}</p>
            <Button variant="outline" onClick={logout}>
              {t('invite.logoutAndSwitch')}
            </Button>
          </>
        ) : inv.accountExists ? (
          <>
            <p className="text-muted-foreground text-sm">{t('invite.loginToJoin', { email: inv.email })}</p>
            <Button asChild>
              <Link to={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>{t('auth.loginButton')}</Link>
            </Button>
          </>
        ) : (
          <form className="grid gap-4" onSubmit={onCreate} noValidate>
            <Field id="invite-email" label={t('common.email')}>
              <Input id="invite-email" value={inv.email} readOnly disabled />
            </Field>
            <Field id="name" label={t('common.name')} error={fieldError(t, errors.name)}>
              <Input id="name" autoComplete="name" autoFocus aria-invalid={!!errors.name} {...describedBy('name', !!errors.name)} {...form.register('name')} />
            </Field>
            <Field id="password" label={t('common.password')} error={fieldError(t, errors.password, 'password')} hint={t('auth.passwordHint')}>
              <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...describedBy('password', true)} {...form.register('password')} />
            </Field>
            <Button type="submit" disabled={isSubmitting}>
              {t('invite.createAndJoin')}
            </Button>
          </form>
        )}
      </div>
    </AuthLayout>
  )
}
