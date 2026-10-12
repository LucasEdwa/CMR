import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Building2, Check, ChevronsUpDown, Handshake, Home, ListTodo, LogOut, Menu, Plus, Settings, Trash2, Users } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
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
import { useActiveWorkspace, useMe, useResetSession } from '@/hooks/useMe'
import { send } from '@/lib/api'
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
    <nav className="grid gap-1" aria-label={t('nav.menu')}>
      {NAV.filter((item) => !item.writersOnly || role !== 'viewer').map(({ to, key, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
              isActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60',
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
        <Button variant="ghost" className="max-w-56 min-w-0 shrink justify-between gap-2" aria-label={t('nav.switchWorkspace')}>
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
          <Avatar className="size-8">
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

export function AppShell() {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="flex min-h-svh">
      <aside className="bg-muted/30 hidden w-56 shrink-0 border-r p-3 md:block">
        <div className="mb-4 px-3 py-2 font-semibold">{t('app.name')}</div>
        <NavItems />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b px-2 sm:px-4">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('nav.menu')}>
                <Menu className="size-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-3">
              <SheetHeader className="px-3">
                <SheetTitle>{t('app.name')}</SheetTitle>
              </SheetHeader>
              <NavItems onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <WorkspaceSwitcher />
          <div className="ml-auto flex items-center gap-1">
            <SearchPalette />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
