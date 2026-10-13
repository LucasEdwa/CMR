import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Building2, Check, ChevronsUpDown, Handshake, Home, ListTodo, LogOut, Menu, Plus, Settings, Trash2, Users } from 'lucide-react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { workspaceSchema } from '@crm/shared'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useActiveWorkspace, useMe, useResetSession, useWorkspaceCacheGuard } from '@/hooks/useMe'
import { api, send } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { authApi } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { NotificationBell } from './NotificationBell'
import { SearchPalette } from './SearchPalette'

const NAV = [
  { to: '/', key: 'nav.home', icon: Home, end: true, writersOnly: false },
  { to: '/tasks', key: 'nav.tasks', icon: ListTodo, end: false, writersOnly: false },
  { to: '/contacts', key: 'nav.contacts', icon: Users, end: false, writersOnly: false },
  { to: '/companies', key: 'nav.companies', icon: Building2, end: false, writersOnly: false },
  { to: '/deals', key: 'nav.deals', icon: Handshake, end: false, writersOnly: false },
  { to: '/trash', key: 'nav.trash', icon: Trash2, end: false, writersOnly: true },
  { to: '/settings', key: 'nav.settings', icon: Settings, end: false, writersOnly: false },
] as const

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation()
  const { role } = useActiveWorkspace()
  return (
    <nav className="grid gap-0.5" aria-label={t('nav.menu')}>
      {NAV.filter((item) => !item.writersOnly || role !== 'viewer').map(({ to, key, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex h-7 items-center gap-2.5 rounded-md px-2 text-[13px] pointer-coarse:h-9',
              isActive ? 'bg-foreground/8 text-foreground font-medium' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
            )
          }
        >
          <Icon className="size-4" aria-hidden />
          {t(key)}
        </NavLink>
      ))}
    </nav>
  )
}

function WorkspaceSwitcher() {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const { workspace } = useActiveWorkspace()
  const navigate = useNavigate()
  const reset = useResetSession()
  const switchTo = useMutation({
    mutationFn: (workspaceId: string) => send('POST', '/workspaces/switch', { workspaceId }),
    onSuccess: async () => {
      await reset()
      navigate('/')
    },
    onError: (err) => toast.error(errorMessage(t, err)),
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Shrinks (and truncates the name) so the top bar fits a 360 px phone. */}
        <Button variant="ghost" className="hover:bg-foreground/5 max-w-56 min-w-0 shrink justify-between gap-2 px-2 has-[>svg]:px-2" aria-label={t('nav.switchWorkspace')}>
          <span className="bg-primary text-primary-foreground grid size-5 shrink-0 place-items-center rounded text-[11px] font-semibold" aria-hidden>
            {workspace?.name?.[0]?.toUpperCase()}
          </span>
          <span className="truncate font-semibold">{workspace?.name}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t('nav.workspaces')}</DropdownMenuLabel>
        {me?.workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => w.id !== workspace?.id && switchTo.mutate(w.id)}>
            <span className="flex-1 truncate">{w.name}</span>
            <span className="text-muted-foreground text-xs">{t(`roles.${w.role}`)}</span>
            {w.id === workspace?.id && <Check className="size-4" aria-hidden />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/onboarding?new=1')}>
          <Plus className="size-4" aria-hidden />
          {t('nav.newWorkspace')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu() {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const navigate = useNavigate()
  const reset = useResetSession()
  const initials = (me?.user.name ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const logout = async () => {
    await authApi.signOut().catch(() => undefined)
    await reset()
    navigate('/login')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={me?.user.name}>
          <Avatar className="size-7">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="grid">
          <span className="truncate">{me?.user.name}</span>
          <span className="text-muted-foreground truncate text-xs font-normal">{me?.user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/settings/profile')}>
          <Settings className="size-4" aria-hidden />
          {t('settings.profile')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={logout}>
          <LogOut className="size-4" aria-hidden />
          {t('auth.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Shown to everyone while an owner's request to delete the workspace waits out its grace period.
function DeletionBanner() {
  const { t, i18n } = useTranslation()
  const { role } = useActiveWorkspace()
  const workspace = useQuery({ queryKey: ['workspace'], queryFn: () => api('/workspace', workspaceSchema), staleTime: 60_000 })
  const when = workspace.data?.deletionScheduledFor
  if (!when) return null
  return (
    <div role="alert" className="bg-destructive/10 text-destructive border-destructive/30 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm">
      <span>{t('settings.deletionBanner', { name: workspace.data!.name, date: formatDateTime(when, i18n.language) })}</span>
      {role === 'owner' && (
        <NavLink to="/settings" className="font-medium underline">
          {t('settings.cancelDeletion')}
        </NavLink>
      )}
    </div>
  )
}

export function AppShell() {
  const { t } = useTranslation()
  useWorkspaceCacheGuard()
  const [menuOpen, setMenuOpen] = useState(false)

  // Laid out like a desktop app window: fixed chrome, and only the content pane scrolls.
  return (
    <div className="bg-chrome flex h-svh overflow-hidden">
      <aside className="hidden w-56 shrink-0 flex-col gap-3 p-2 md:flex">
        <WorkspaceSwitcher />
        <NavItems />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col md:py-2 md:pr-2">
        <div className="bg-background flex min-h-0 flex-1 flex-col overflow-hidden md:rounded-lg md:border md:shadow-xs">
          <header className="flex h-11 shrink-0 items-center gap-1 border-b px-2">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('nav.menu')}>
                  <Menu className="size-5" aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="bg-chrome w-64 gap-3 p-2">
                <SheetHeader className="px-2">
                  <SheetTitle>{t('app.name')}</SheetTitle>
                </SheetHeader>
                <NavItems onNavigate={() => setMenuOpen(false)} />
              </SheetContent>
            </Sheet>
            {/* The sidebar holds the switcher on wide screens; phones keep it in the toolbar. */}
            <div className="flex min-w-0 md:hidden">
              <WorkspaceSwitcher />
            </div>
            <div className="ml-auto flex items-center gap-1">
              <SearchPalette />
              <NotificationBell />
              <UserMenu />
            </div>
          </header>
          <DeletionBanner />
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
