import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { signupSchema, type Locale } from '@crm/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/Field'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { authApi } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { describedBy, fieldError } from '@/lib/form'

export function Signup() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const form = useForm({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: '', email: '', password: '', locale: i18n.language as Locale },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null)
    try {
      await authApi.signUp({ ...values, locale: i18n.language as Locale })
      navigate(`/check-email?email=${encodeURIComponent(values.email)}`)
    } catch (err) {
      setError(errorMessage(t, err))
    }
  })

  return (
    <AuthLayout
      title={t('auth.signupTitle')}
      subtitle={t('auth.signupSubtitle')}
      footer={
        <>
          {t('auth.haveAccount')}{' '}
          <Link className="text-foreground underline" to="/login">
            {t('auth.loginButton')}
          </Link>
        </>
      }
    >
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Field id="name" label={t('common.name')} error={fieldError(t, errors.name)}>
          <Input id="name" autoComplete="name" autoFocus aria-invalid={!!errors.name} {...describedBy('name', !!errors.name)} {...form.register('name')} />
        </Field>
        <Field id="email" label={t('common.email')} error={fieldError(t, errors.email, 'email')}>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...describedBy('email', !!errors.email)} {...form.register('email')} />
        </Field>
        <Field id="password" label={t('common.password')} error={fieldError(t, errors.password, 'password')} hint={t('auth.passwordHint')}>
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...describedBy('password', true)} {...form.register('password')} />
        </Field>
        <Button type="submit" disabled={isSubmitting}>
          {t('auth.signupButton')}
        </Button>
      </form>
    </AuthLayout>
  )
}
