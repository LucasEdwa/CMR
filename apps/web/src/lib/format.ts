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

const MONTHS_SV = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

// Formats a date with one of the workspace date formats (see DATE_FORMATS in @crm/shared).
export function formatWithPattern(date: Date, pattern: string, timeZone = DEFAULT_TIMEZONE) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  )
  const { year, month, day } = parts as { year: string; month: string; day: string }
  if (pattern === 'dd/MM/yyyy') return `${day}/${month}/${year}`
  if (pattern === 'd MMM yyyy') return `${Number(day)} ${MONTHS_SV[Number(month) - 1]} ${year}`
  return `${year}-${month}-${day}`
}

// A calendar date (yyyy-mm-dd, no timezone) with an optional wall-clock time, e.g. "mån 9 nov 15:30".
export function formatDueDate(date: string, time: string | null, lang: string) {
  const day = new Intl.DateTimeFormat(localeFor(lang), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  )
  return time ? `${day} ${time}` : day
}
