import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { loginSchema } from '@crm/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/Field'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { useResetSession } from '@/hooks/useMe'
import { authApi } from '@/lib/auth'
import { errorMessage, isApiError } from '@/lib/errors'
import { describedBy, fieldError, safeNext } from '@/lib/form'

export function Login() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const reset = useResetSession()
  const [error, setError] = useState<{ message: string; unverified: boolean } | null>(null)
  const form = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null)
    try {
      await authApi.signIn(values)
      await reset()
      navigate(safeNext(params.get('next')), { replace: true })
    } catch (err) {
      const unverified = isApiError(err, 'EMAIL_NOT_VERIFIED')
      if (unverified) await authApi.resendVerification(values.email).catch(() => undefined)
      setError({ message: unverified ? t('auth.notVerified') : errorMessage(t, err), unverified })
    }
  })

  return (
    <AuthLayout
      title={t('auth.loginTitle')}
      subtitle={t('auth.loginSubtitle')}
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link className="text-foreground underline" to="/signup">
            {t('auth.createAccount')}
          </Link>
        </>
      }
    >
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error.message}
              {error.unverified && <> {t('auth.resent')}.</>}
            </AlertDescription>
          </Alert>
        )}
        <Field id="email" label={t('common.email')} error={fieldError(t, errors.email, 'email')}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            aria-invalid={!!errors.email}
            {...describedBy('email', !!errors.email)}
            {...form.register('email')}
          />
        </Field>
        <Field id="password" label={t('common.password')} error={fieldError(t, errors.password)}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            {...describedBy('password', !!errors.password)}
            {...form.register('password')}
          />
        </Field>
        <Button type="submit" disabled={isSubmitting}>
          {t('auth.loginButton')}
        </Button>
        <Link className="text-muted-foreground text-center text-sm underline" to="/forgot-password">
          {t('auth.forgotPassword')}
        </Link>
      </form>
    </AuthLayout>
  )
}
