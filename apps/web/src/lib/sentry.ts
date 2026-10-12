import * as Sentry from '@sentry/react'
import { redactUrl } from '@crm/shared'

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
    // URLs carry search terms and filters (names, emails), reset tokens and invitation secrets:
    // keep only the path, with link secrets replaced.
    beforeBreadcrumb(crumb) {
      if (crumb.data) {
        for (const key of ['url', 'from', 'to']) if (typeof crumb.data[key] === 'string') crumb.data[key] = redactUrl(crumb.data[key])
      }
      return crumb
    },
    beforeSend: scrubRequest,
    beforeSendTransaction(event) {
      if (event.transaction) event.transaction = redactUrl(event.transaction)
      return scrubRequest(event)
    },
  })
}

function scrubRequest<E extends { request?: { url?: string; query_string?: unknown } }>(event: E): E {
  if (event.request?.url) event.request.url = redactUrl(event.request.url)
  if (event.request) delete event.request.query_string
  return event
}

export const sentryEnabled = Boolean(dsn)
