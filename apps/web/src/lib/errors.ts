import type { TFunction } from 'i18next'
import { ApiRequestError } from './api'

// Turns any thrown error into a translated, user-facing sentence.
export function errorMessage(t: TFunction, err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.code === 'validation_error' && Array.isArray(err.details)) {
      const msg = (err.details[0] as { message?: string } | undefined)?.message
      if (msg && t(`errors.${msg}`, { defaultValue: '' })) return t(`errors.${msg}`)
    }
    // Details such as { stage, count } fill the placeholders in the message.
    const vars = err.details && typeof err.details === 'object' && !Array.isArray(err.details) ? (err.details as Record<string, unknown>) : {}
    const known = t(`errors.${err.code}`, { defaultValue: '', ...vars })
    if (known) return known
  }
  return t('errors.generic')
}

export const isApiError = (err: unknown, code: string) => err instanceof ApiRequestError && err.code === code
