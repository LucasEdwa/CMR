import { useState } from 'react'
import { Link } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { emailSchema } from '@crm/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/Field'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { authApi } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { describedBy, fieldError } from '@/lib/form'

const schema = z.object({ email: emailSchema })

export function ForgotPassword() {
  const { t } = useTranslation()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { email: '' } })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null)
    try {
      await authApi.requestPasswordReset(email)
      setSentTo(email)
    } catch (err) {
      setError(errorMessage(t, err))
    }
  })

  return (
    <AuthLayout title={t('auth.forgotTitle')} subtitle={sentTo ? undefined : t('auth.forgotSubtitle')}>
      {sentTo ? (
        <div className="grid gap-4">
          <p role="status">{t('auth.forgotSent', { email: sentTo })}</p>
          <Link className="underline" to="/login">
            {t('common.backToLogin')}
          </Link>
        </div>
      ) : (
        <form className="grid gap-4" onSubmit={onSubmit} noValidate>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field id="email" label={t('common.email')} error={fieldError(t, errors.email, 'email')}>
            <Input id="email" type="email" autoComplete="email" autoFocus aria-invalid={!!errors.email} {...describedBy('email', !!errors.email)} {...form.register('email')} />
          </Field>
          <Button type="submit" disabled={isSubmitting}>
            {t('auth.forgotButton')}
          </Button>
          <Link className="text-muted-foreground text-center text-sm underline" to="/login">
            {t('common.backToLogin')}
          </Link>
        </form>
      )}
    </AuthLayout>
  )
}
