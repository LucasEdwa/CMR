import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { authApi } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'

export function CheckEmail() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const email = params.get('email') ?? ''
  const [status, setStatus] = useState<string | null>(null)

  const resend = async () => {
    try {
      await authApi.resendVerification(email)
      setStatus(t('auth.resent'))
    } catch (err) {
      setStatus(errorMessage(t, err))
    }
  }

  return (
    <AuthLayout title={t('auth.checkEmailTitle')}>
      <div className="grid gap-4">
        <MailCheck className="text-muted-foreground size-10" aria-hidden />
        <p>{t('auth.checkEmailBody', { email })}</p>
        {email && (
          <Button variant="outline" onClick={resend}>
            {t('auth.resend')}
          </Button>
        )}
        {status && (
          <p role="status" className="text-muted-foreground text-sm">
            {status}
          </p>
        )}
        <Link className="text-muted-foreground text-center text-sm underline" to="/login">
          {t('common.backToLogin')}
        </Link>
      </div>
    </AuthLayout>
  )
}
