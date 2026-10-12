import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LanguageToggle } from '@/components/LanguageToggle'

type Props = { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }

export function AuthLayout({ title, subtitle, children, footer }: Props) {
  const { t } = useTranslation()
  return (
    <div className="bg-muted/40 flex min-h-svh flex-col">
      <header className="flex items-center justify-between px-4 py-3">
        <span className="font-semibold">{t('app.name')}</span>
        <LanguageToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm">
          <Card>
            <CardHeader>
              <CardTitle>
                <h1 className="text-xl">{title}</h1>
              </CardTitle>
              {subtitle && <CardDescription>{subtitle}</CardDescription>}
            </CardHeader>
            <CardContent>{children}</CardContent>
          </Card>
          {footer && <div className="text-muted-foreground mt-4 text-center text-sm">{footer}</div>}
        </div>
      </main>
    </div>
  )
}
