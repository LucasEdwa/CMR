import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { FullPageSpinner } from '@/components/layout/FullPageSpinner'
import { useResetSession } from '@/hooks/useMe'
import { authApi } from '@/lib/auth'

export function VerifyEmail() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const reset = useResetSession()
  const token = params.get('token')
  const [failed, setFailed] = useState(!token)
  const started = useRef(false)

  useEffect(() => {
    // StrictMode runs effects twice in dev; the token must only be spent once.
    if (started.current || !token) return
    started.current = true
    authApi
      .verifyEmail(token)
      .then(async () => {
        await reset()
        navigate('/', { replace: true })
      })
      .catch(() => setFailed(true))
  }, [token, navigate, reset])

  if (!failed) return <FullPageSpinner />
  return (
    <AuthLayout title={t('auth.verifyFailedTitle')}>
      <div className="grid gap-4">
        <p>{t('auth.verifyFailedBody')}</p>
        <Link className="underline" to="/login">
          {t('auth.loginButton')}
        </Link>
      </div>
    </AuthLayout>
  )
}
