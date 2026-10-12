// Swedish organisationsnummer: 10 digits (NNNNNN-NNNN), last digit is a Luhn check digit.
export function normalizeOrgNumber(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '')
  const ten = digits.length === 12 && /^(16|18|19|20)/.test(digits) ? digits.slice(2) : digits
  if (!/^\d{10}$/.test(ten)) return null
  return luhnValid(ten) ? `${ten.slice(0, 6)}-${ten.slice(6)}` : null
}

function luhnValid(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/
