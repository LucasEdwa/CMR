import { NavLink, Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

const TABS = [
  { to: '/settings', key: 'settings.workspace', end: true },
  { to: '/settings/members', key: 'settings.members', end: false },
  { to: '/settings/profile', key: 'settings.profile', end: false },
] as const

export function SettingsLayout() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('settings.title')}</h1>
      <nav className="flex gap-1 overflow-x-auto border-b" aria-label={t('settings.title')}>
        {TABS.map(({ to, key, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap',
                isActive ? 'border-foreground' : 'text-muted-foreground border-transparent',
              )
            }
          >
            {t(key)}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
