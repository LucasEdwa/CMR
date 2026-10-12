import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useActiveWorkspace, useMe } from '@/hooks/useMe'

export function Home() {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const { canManage } = useActiveWorkspace()
  const firstName = me?.user.name.split(' ')[0] ?? ''

  return (
    <div className="mx-auto grid grid-cols-1 max-w-3xl gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('home.greeting', { name: firstName })}</h1>
      <section className="grid justify-items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
        <Users className="text-muted-foreground size-10" aria-hidden />
        <h2 className="text-lg font-medium">{t('home.emptyTitle')}</h2>
        <p className="text-muted-foreground max-w-md">{t('home.emptyBody')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/contacts">{t('nav.contacts')}</Link>
          </Button>
          {canManage && (
            <Button asChild variant="outline">
              <Link to="/settings/members">{t('home.inviteTeam')}</Link>
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}
