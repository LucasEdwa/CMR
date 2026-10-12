import type { Locale } from '@crm/shared'
import { send } from './api'

// Thin wrappers over Better Auth's endpoints (mounted at /api/auth).
export const authApi = {
  signUp: (input: { name: string; email: string; password: string; locale: Locale }) =>
    send('POST', '/auth/sign-up/email', input),
  // Resolves to { twoFactorRedirect: true } when the account uses two-factor login.
  signIn: (input: { email: string; password: string }) =>
    send('POST', '/auth/sign-in/email', input) as Promise<{ twoFactorRedirect?: boolean }>,
  verifyTotp: (code: string, trustDevice = false) => send('POST', '/auth/two-factor/verify-totp', { code, trustDevice }),
  verifyBackupCode: (code: string) => send('POST', '/auth/two-factor/verify-backup-code', { code }),
  enableTwoFactor: (password: string) =>
    send('POST', '/auth/two-factor/enable', { password }) as Promise<{ totpURI: string; backupCodes: string[] }>,
  disableTwoFactor: (password: string) => send('POST', '/auth/two-factor/disable', { password }),
  changePassword: (currentPassword: string, newPassword: string) =>
    send('POST', '/auth/change-password', { currentPassword, newPassword, revokeOtherSessions: true }),
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
