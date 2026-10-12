import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ME_KEY, useMe } from '@/hooks/useMe'
import { ApiRequestError } from '@/lib/api'
import { FullPageSpinner } from './FullPageSpinner'

// Logged-out users go to /login and come back to the page they asked for.
// Logged-in users without a workspace go to /onboarding.
export function RequireAuth({ needsWorkspace = true }: { needsWorkspace?: boolean }) {
  const location = useLocation()
  const queryClient = useQueryClient()
  const me = useMe()

  // Re-check membership in the background on every navigation, so losing access
  // (removed from the workspace, logged out elsewhere) takes effect on the next click.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ME_KEY })
  }, [location.pathname, queryClient])

  if (me.isPending) return <FullPageSpinner />
  if (me.error instanceof ApiRequestError && me.error.status === 401) {
    const next = location.pathname + location.search
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  if (me.isError) throw me.error
  // The workspace requires two-factor login: nothing else opens until it is set up.
  if (me.data.twoFactorSetupRequired && location.pathname !== '/setup-2fa') return <Navigate to="/setup-2fa" replace />
  if (needsWorkspace && !me.data.activeWorkspaceId) return <Navigate to="/onboarding" replace />
  return <Outlet />
}
