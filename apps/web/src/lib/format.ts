import { formatMoney, type Currency } from '@crm/shared'

// Dates are stored in UTC and shown in the workspace timezone (Europe/Stockholm until Sprint 1 settings).
export const DEFAULT_TIMEZONE = 'Europe/Stockholm'

const localeFor = (lang: string) => (lang === 'en' ? 'en-GB' : 'sv-SE')

export function formatDate(date: Date | string, lang: string, timeZone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat(localeFor(lang), { dateStyle: 'medium', timeZone }).format(new Date(date))
}

export function formatDateTime(date: Date | string, lang: string, timeZone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat(localeFor(lang), { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
    new Date(date),
  )
}

// Amounts always render in Swedish format for SEK, regardless of UI language, as Swedish users expect.
export function formatAmount(minorUnits: number, currency: Currency = 'SEK') {
  return formatMoney(minorUnits, currency, 'sv-SE')
}
