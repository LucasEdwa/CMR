import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { createWorkspaceSchema, slugify } from '@crm/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/Field'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { useMe, useResetSession } from '@/hooks/useMe'
import { send } from '@/lib/api'
import { authApi } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { describedBy, fieldError } from '@/lib/form'

export function Onboarding() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const reset = useResetSession()
  const { data: me } = useMe()
  const [error, setError] = useState<string | null>(null)
  const [slugEdited, setSlugEdited] = useState(false)
  const form = useForm({
    resolver: zodResolver(createWorkspaceSchema),
    defaultValues: { name: '', slug: '', orgNumber: '' },
  })
  const { errors, isSubmitting } = form.formState

  // Users who already have a workspace only get here on purpose ("New company").
  if (me?.activeWorkspaceId && params.get('new') !== '1') return <Navigate to="/" replace />

  const nameField = form.register('name')
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null)
    try {
      await send('POST', '/workspaces', values)
      await reset()
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorMessage(t, err))
    }
  })

  return (
    <AuthLayout
      title={t('onboarding.title')}
      subtitle={me?.workspaces.length === 0 ? t('onboarding.noWorkspaceBody') : t('onboarding.subtitle')}
      footer={
        me?.activeWorkspaceId ? (
          <Link className="underline" to="/">
            {t('common.cancel')}
          </Link>
        ) : (
          <button
            className="underline"
            onClick={async () => {
              await authApi.signOut()
              await reset()
              navigate('/login')
            }}
          >
            {t('auth.logout')}
          </button>
        )
      }
    >
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Field id="name" label={t('onboarding.companyName')} error={fieldError(t, errors.name)}>
          <Input
            id="name"
            autoFocus
            autoComplete="organization"
            aria-invalid={!!errors.name}
            {...describedBy('name', !!errors.name)}
            {...nameField}
            onChange={(e) => {
              void nameField.onChange(e)
              if (!slugEdited) form.setValue('slug', slugify(e.target.value))
            }}
          />
        </Field>
        <Field id="slug" label={t('onboarding.slug')} error={fieldError(t, errors.slug)} hint={t('onboarding.slugHint')}>
          <Input
            id="slug"
            aria-invalid={!!errors.slug}
            {...describedBy('slug', true)}
            {...form.register('slug', { onChange: () => setSlugEdited(true) })}
          />
        </Field>
        <Field
          id="orgNumber"
          label={`${t('onboarding.orgNumber')} (${t('onboarding.optional')})`}
          error={fieldError(t, errors.orgNumber)}
        >
          <Input
            id="orgNumber"
            inputMode="numeric"
            placeholder="556677-8899"
            aria-invalid={!!errors.orgNumber}
            {...describedBy('orgNumber', !!errors.orgNumber)}
            {...form.register('orgNumber')}
          />
        </Field>
        <Button type="submit" disabled={isSubmitting}>
          {t('onboarding.create')}
        </Button>
      </form>
    </AuthLayout>
  )
}
