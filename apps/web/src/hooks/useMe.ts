import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { meSchema, workspaceSchema, type Role } from '@crm/shared'
import { api, ApiRequestError } from '@/lib/api'
import i18n, { setLanguage } from '@/lib/i18n'

export const ME_KEY = ['me'] as const

export function useMe() {
  const query = useQuery({
    queryKey: ME_KEY,
    queryFn: () => api('/me', meSchema),
    retry: (count, err) => !(err instanceof ApiRequestError && err.status === 401) && count < 2,
    staleTime: 60_000,
  })

  // The user's saved language wins over the browser default once we know who they are.
  const locale = query.data?.user.locale
  useEffect(() => {
    if (locale && locale !== i18n.language) void setLanguage(locale)
  }, [locale])

  return query
}

export function useActiveWorkspace() {
  const { data } = useMe()
  const workspace = data?.workspaces.find((w) => w.id === data.activeWorkspaceId) ?? null
  const role: Role | null = workspace?.role ?? null
  return { workspace, role, canManage: role === 'owner' || role === 'admin' }
}

// After login, logout or switching workspace every cached query belongs to the old context.
export function useResetSession() {
  const queryClient = useQueryClient()
  return () => queryClient.resetQueries()
}

// The timezone "today" and due times follow: the user's own, else the workspace's.
export function useTimezone() {
  const { data: me } = useMe()
  const workspace = useQuery({ queryKey: ['workspace'], queryFn: () => api('/workspace', workspaceSchema), staleTime: 60_000 })
  return me?.user.timezone ?? workspace.data?.timezone ?? 'Europe/Stockholm'
}

// Cached data belongs to one user in one workspace. If either changes in any way (a switch, a
// removal that moved the session to another workspace, another login), drop everything else
// so nothing from the previous workspace is shown.
export function useWorkspaceCacheGuard() {
  const { data } = useMe()
  const queryClient = useQueryClient()
  const scope = data ? `${data.user.id}:${data.activeWorkspaceId}` : null
  const previous = useRef(scope)
  useEffect(() => {
    if (scope && previous.current && previous.current !== scope) {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] })
    }
    if (scope) previous.current = scope
  }, [scope, queryClient])
}
