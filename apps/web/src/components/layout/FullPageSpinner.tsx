import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

export function FullPageSpinner() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-svh items-center justify-center" role="status">
      <Loader2 className="text-muted-foreground size-6 animate-spin" aria-hidden />
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  )
}
