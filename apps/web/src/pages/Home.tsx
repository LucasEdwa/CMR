import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { healthSchema } from '@crm/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { formatAmount, formatDateTime } from '@/lib/format'
import { LANGUAGES, setLanguage } from '@/lib/i18n'

const SAMPLE_AMOUNT_ORE = 199950

export function Home() {
  const { t, i18n } = useTranslation()
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api('/health', healthSchema),
    retry: false,
  })

  const statusBadge = (ok: boolean | undefined) =>
    health.isPending ? (
      <Badge variant="secondary">{t('status.checking')}</Badge>
    ) : ok ? (
      <Badge className="bg-success text-white">{t('status.ok')}</Badge>
    ) : (
      <Badge variant="destructive">{t('status.down')}</Badge>
    )

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('app.name')}</h1>
          <p className="text-muted-foreground mt-1">{t('app.tagline')}</p>
        </div>
        <div role="group" aria-label={t('language.label')} className="flex gap-1">
          {LANGUAGES.map((lang) => (
            <Button
              key={lang}
              size="sm"
              variant={i18n.language === lang ? 'default' : 'outline'}
              aria-pressed={i18n.language === lang}
              onClick={() => setLanguage(lang)}
            >
              {t(`language.${lang}`)}
            </Button>
          ))}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('status.title')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {health.isError ? (
            <p className="text-destructive" data-testid="health-error">
              {t('status.unreachable')}
            </p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2">
              <dt>{t('status.api')}</dt>
              <dd data-testid="health-api">{statusBadge(health.data?.status === 'ok')}</dd>
              <dt>{t('status.database')}</dt>
              <dd data-testid="health-db">{statusBadge(health.data?.db === 'ok')}</dd>
              <dt>{t('status.environment')}</dt>
              <dd className="text-muted-foreground">{health.data?.env ?? '…'}</dd>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t('formatting.title')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt>{t('formatting.money')}</dt>
            <dd data-testid="sample-amount">{formatAmount(SAMPLE_AMOUNT_ORE)}</dd>
            <dt>{t('formatting.date')}</dt>
            <dd>{formatDateTime(new Date(), i18n.language)}</dd>
          </dl>
        </CardContent>
      </Card>

      {import.meta.env.VITE_APP_ENV !== 'production' && (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              throw new Error('Test error from the web app')
            }}
          >
            {t('debug.throwError')}
          </Button>
        </div>
      )}
    </main>
  )
}
