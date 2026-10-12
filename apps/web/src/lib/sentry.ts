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
    // URLs carry search terms and filters (names, emails): keep only the path.
    beforeBreadcrumb(crumb) {
      const strip = (url: unknown) => (typeof url === 'string' ? url.split('?')[0] : url)
      if (crumb.data) {
        for (const key of ['url', 'from', 'to']) if (key in crumb.data) crumb.data[key] = strip(crumb.data[key])
      }
      return crumb
    },
  })
}

export const sentryEnabled = Boolean(dsn)
