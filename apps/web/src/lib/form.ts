import type { TFunction } from 'i18next'
import type { FieldError } from 'react-hook-form'

// Maps a zod/react-hook-form field error to a translated message.
export function fieldError(t: TFunction, error: FieldError | undefined, field?: 'password' | 'email'): string | undefined {
  if (!error) return undefined
  const msg = error.message ?? ''
  if (msg && t(`errors.${msg}`, { defaultValue: '' })) return t(`errors.${msg}`)
  if (field === 'password' && error.type === 'too_small') return t('errors.PASSWORD_TOO_SHORT')
  if (field === 'email') return t('errors.invalid_email')
  return t('errors.required')
}

// Links a control to the message rendered by <Field> (error or hint).
export const describedBy = (id: string, hasMessage: boolean) =>
  hasMessage ? { 'aria-describedby': `${id}-message` } : {}

// Only same-site paths are allowed as a return target after login (no open redirect).
export function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}
