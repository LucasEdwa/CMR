import type { Locale } from '@crm/shared'
import { send } from './api'

// Thin wrappers over Better Auth's endpoints (mounted at /api/auth).
export const authApi = {
  signUp: (input: { name: string; email: string; password: string; locale: Locale }) =>
    send('POST', '/auth/sign-up/email', input),
  signIn: (input: { email: string; password: string }) => send('POST', '/auth/sign-in/email', input),
  signOut: () => send('POST', '/auth/sign-out', {}),
  verifyEmail: (token: string) =>
    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, { credentials: 'include' }).then((r) => {
      if (!r.ok) throw new Error('verify_failed')
    }),
  resendVerification: (email: string) => send('POST', '/auth/send-verification-email', { email }),
  requestPasswordReset: (email: string) =>
    send('POST', '/auth/request-password-reset', { email, redirectTo: '/reset-password' }),
  resetPassword: (token: string, newPassword: string) => send('POST', '/auth/reset-password', { token, newPassword }),
}
