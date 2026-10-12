// Loaded with --import before anything else so Sentry can instrument Fastify and Postgres.
import * as Sentry from '@sentry/node'

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.APP_ENV ?? 'development',
    release: process.env.RELEASE,
    tracesSampleRate: 0.1,
    // CRM requests carry personal data: never send bodies, cookies or user info to Sentry.
    dataCollection: { userInfo: false, cookies: false, httpBodies: [] },
  })
}
