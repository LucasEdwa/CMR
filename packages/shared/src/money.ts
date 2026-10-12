// Money is always an integer number of minor units (öre for SEK). Never use floats for amounts.

export type Currency = 'SEK' | 'EUR' | 'USD' | 'NOK' | 'DKK'

export function formatMoney(minorUnits: number, currency: Currency = 'SEK', locale = 'sv-SE'): string {
  if (!Number.isInteger(minorUnits)) throw new Error('formatMoney expects integer minor units')
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: minorUnits % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minorUnits / 100)
}

// Parses user input such as "1 999,50", "1999.50" or "1 999,50 kr" into öre.
// Returns null for anything that is not a valid amount with at most two decimals.
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/\s/g, '').replace(/(kr|sek|€|\$)$/i, '')
  const match = /^(-)?(\d+)(?:[.,](\d{1,2}))?$/.exec(cleaned)
  if (!match) return null
  const [, sign, whole, fraction = ''] = match
  const ore = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(ore)) return null
  return sign ? -ore : ore
}
