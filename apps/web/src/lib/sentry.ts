import * as Sentry from '@sentry/react'

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined

export function initSentry() {
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: (import.meta.env.VITE_APP_ENV as string | undefined) ?? import.meta.env.MODE,
    release: import.meta.env.VITE_RELEASE as string | undefined,
    tracesSampleRate: 0.1,
    // CRM screens show personal data: no session replay, no user info.
    dataCollection: { userInfo: false },
  })
}

export const sentryEnabled = Boolean(dsn)
