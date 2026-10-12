import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/Field'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { useResetSession } from '@/hooks/useMe'
import { authApi } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { safeNext } from '@/lib/form'

// Second step of logging in for accounts with two-factor login.
export function TwoFactorChallenge() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const reset = useResetSession()
  const [backup, setBackup] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (backup) await authApi.verifyBackupCode(code.trim())
      else await authApi.verifyTotp(code.replace(/\s/g, ''))
      await reset()
      navigate(safeNext(params.get('next')), { replace: true })
    } catch (err) {
      setError(errorMessage(t, err))
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title={t('security.challengeTitle')}
      subtitle={backup ? t('security.challengeBackup') : t('security.challengeApp')}
      footer={
        <Link className="text-foreground underline" to="/login">
          {t('common.backToLogin')}
        </Link>
      }
    >
      <form className="grid gap-4" onSubmit={submit} noValidate>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Field id="two-factor-code" label={backup ? t('security.backupLabel') : t('security.codeLabel')}>
          <Input
            id="two-factor-code"
            autoFocus
            inputMode={backup ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={busy || !code.trim()}>
          {t('security.verify')}
        </Button>
        <Button
          type="button"
          variant="link"
          onClick={() => {
            setBackup((b) => !b)
            setCode('')
            setError(null)
          }}
        >
          {backup ? t('security.useApp') : t('security.useBackup')}
        </Button>
      </form>
    </AuthLayout>
  )
}
