import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { TwoFactorSetup } from '@/components/security/TwoFactorSetup'
import { useResetSession } from '@/hooks/useMe'
import { authApi } from '@/lib/auth'

// Shown when the active workspace requires two-factor login and the user has not set it up.
export function SetupTwoFactor() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const reset = useResetSession()
  return (
    <AuthLayout
      title={t('security.requiredTitle')}
      subtitle={t('security.requiredBody')}
      footer={
        <button
          type="button"
          className="text-foreground underline"
          onClick={async () => {
            await authApi.signOut().catch(() => undefined)
            await reset()
            navigate('/login')
          }}
        >
          {t('auth.logout')}
        </button>
      }
    >
      <TwoFactorSetup
        onDone={async () => {
          await reset()
          navigate('/', { replace: true })
        }}
      />
    </AuthLayout>
  )
}
