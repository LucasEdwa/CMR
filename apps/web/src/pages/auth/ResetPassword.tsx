import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { passwordSchema } from '@crm/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/Field'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { authApi } from '@/lib/auth'
import { errorMessage, isApiError } from '@/lib/errors'
import { describedBy, fieldError } from '@/lib/form'

const schema = z.object({ password: passwordSchema })

export function ResetPassword() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(token ? null : t('auth.resetInvalid'))
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { password: '' } })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null)
    try {
      await authApi.resetPassword(token, password)
      setDone(true)
    } catch (err) {
      setError(isApiError(err, 'INVALID_TOKEN') ? t('auth.resetInvalid') : errorMessage(t, err))
    }
  })

  return (
    <AuthLayout title={t('auth.resetTitle')}>
      {done ? (
        <div className="grid gap-4">
          <p role="status">{t('auth.resetDone')}</p>
          <Button asChild>
            <Link to="/login">{t('auth.loginButton')}</Link>
          </Button>
        </div>
      ) : (
        <form className="grid gap-4" onSubmit={onSubmit} noValidate>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                {error} <Link className="underline" to="/forgot-password">{t('auth.forgotButton')}</Link>
              </AlertDescription>
            </Alert>
          )}
          <Field id="password" label={t('auth.newPassword')} error={fieldError(t, errors.password, 'password')} hint={t('auth.passwordHint')}>
            <Input id="password" type="password" autoComplete="new-password" autoFocus aria-invalid={!!errors.password} {...describedBy('password', true)} {...form.register('password')} />
          </Field>
          <Button type="submit" disabled={isSubmitting || !token}>
            {t('auth.resetButton')}
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
