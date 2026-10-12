import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import { initSentry } from '@/lib/sentry'
import { ApiRequestError } from '@/lib/api'
import { ME_KEY } from '@/hooks/useMe'
import '@/lib/i18n'
import './index.css'
import App from './App.tsx'
import { Toaster } from '@/components/ui/sonner'

initSentry()

// Access can change server-side at any time (logged out elsewhere, removed from a workspace).
// When the API says so, refresh "me" so the route guards redirect on this very click.
// The "me" query itself is skipped: its own 401 is how the guards learn the user is logged out.
const onAccessLost = (err: unknown, queryKey?: readonly unknown[]) => {
  if (queryKey?.[0] === ME_KEY[0]) return
  if (err instanceof ApiRequestError && (err.status === 401 || err.code === 'no_workspace' || err.code === 'two_factor_required')) {
    void queryClient.invalidateQueries({ queryKey: ME_KEY })
  }
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (err, query) => onAccessLost(err, query.queryKey) }),
  mutationCache: new MutationCache({ onError: (err) => onAccessLost(err) }),
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster richColors position="top-center" />
    </QueryClientProvider>
  </StrictMode>,
)
