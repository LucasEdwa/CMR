import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { MIN_PASSWORD_LENGTH, localeSchema } from '@crm/shared'
import { haveIBeenPwned, twoFactor } from 'better-auth/plugins'
import { db } from '../db/client.js'
import { accounts, rateLimits, sessions, twoFactors, users, verifications } from '../db/schema.js'
import { env } from '../env.js'
import { emails } from '../email/templates.js'
import { sendEmail } from '../email/send.js'

const localeOf = (user: object) => localeSchema.catch('sv').parse((user as { locale?: unknown }).locale)

// All browser traffic reaches the API through the web origin (Vite proxy locally, Vercel rewrite
// in staging/production), so links and cookies use WEB_ORIGIN.
export const auth = betterAuth({
  appName: 'CRM',
  baseURL: env.WEB_ORIGIN,
  basePath: '/api/auth',
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN],
  telemetry: { enabled: false },
  // Signup, password reset and password change reject passwords from known breaches.
  plugins: [
    haveIBeenPwned({ enabled: env.PASSWORD_BREACH_CHECK }),
    // Authenticator-app codes (TOTP) with ten single-use backup codes. Enabling needs the password
    // and a first valid code; secrets and backup codes are stored encrypted.
    twoFactor({ issuer: 'CRM', backupCodeOptions: { amount: 10 } }),
  ],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { users, sessions, accounts, verifications, rateLimits, twoFactor: twoFactors },
  }),
  user: {
    modelName: 'users',
    additionalFields: {
      locale: { type: 'string', required: false, defaultValue: 'sv', input: true },
    },
  },
  session: {
    modelName: 'sessions',
    // Sliding: a session not used for 3 days expires. Every session also ends after
    // SESSION_MAX_AGE_DAYS no matter what (checked in auth/context.ts).
    expiresIn: 60 * 60 * 24 * 3,
    updateAge: 60 * 60 * 12,
    additionalFields: {
      activeTenantId: { type: 'string', required: false, input: false },
    },
  },
  account: { modelName: 'accounts' },
  verification: { modelName: 'verifications' },
  rateLimit: {
    enabled: true,
    storage: 'database',
    modelName: 'rateLimits',
    window: 60,
    max: 100,
    customRules: {
      // Backstop per IP. The 10-wrong-passwords rule is enforced in routes/auth.ts (failures only).
      '/sign-in/email': { window: 15 * 60, max: 30 },
      '/sign-up/email': { window: 60 * 60, max: 10 },
      '/request-password-reset': { window: 60 * 60, max: 5 },
      '/send-verification-email': { window: 60 * 60, max: 5 },
      '/reset-password': { window: 60 * 60, max: 10 },
    },
  },
  advanced: {
    cookiePrefix: 'crm',
    useSecureCookies: env.APP_ENV === 'staging' || env.APP_ENV === 'production',
    database: { generateId: 'uuid' },
    ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, token }) => {
      const url = `${env.WEB_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`
      await sendEmail(emails.resetPassword(user.email, localeOf(user), { name: user.name, url }))
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, token }) => {
      const url = `${env.WEB_ORIGIN}/verify-email?token=${encodeURIComponent(token)}`
      await sendEmail(emails.verifyEmail(user.email, localeOf(user), { name: user.name, url }))
    },
  },
})

export type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>
