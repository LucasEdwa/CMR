import { Navigate, NavLink, Outlet, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useActiveWorkspace } from '@/hooks/useMe'
import { cn } from '@/lib/utils'

// Everything except the profile is for owners and admins (the API refuses the rest anyway).
const TABS = [
  { to: '/settings', key: 'settings.workspace', end: true, managers: true },
  { to: '/settings/members', key: 'settings.members', end: false, managers: true },
  { to: '/settings/pipelines', key: 'settings.pipelines', end: false, managers: true },
  { to: '/settings/lists', key: 'settings.picklists', end: false, managers: true },
  { to: '/settings/audit', key: 'settings.audit', end: false, managers: true },
  { to: '/settings/profile', key: 'settings.profile', end: false, managers: false },
] as const

export function SettingsLayout() {
  const { t } = useTranslation()
  const { canManage } = useActiveWorkspace()
  const { pathname } = useLocation()
  const tabs = TABS.filter((tab) => canManage || !tab.managers)
  if (!canManage && pathname !== '/settings/profile') return <Navigate to="/settings/profile" replace />
  return (
    <div className="mx-auto grid grid-cols-1 max-w-3xl gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('settings.title')}</h1>
      <nav className="flex gap-1 overflow-x-auto border-b" aria-label={t('settings.title')}>
        {tabs.map(({ to, key, end }) => (
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
