import { describe, expect, it } from 'vitest'
import { formatMoney, parseMoney } from './money.js'

// Intl uses non-breaking spaces; normalise them so the assertions stay readable.
const plain = (s: string) => s.replace(/\s/g, ' ')

describe('formatMoney', () => {
  it('formats öre as Swedish kronor', () => {
    expect(plain(formatMoney(199950))).toBe('1 999,50 kr')
    expect(plain(formatMoney(100000))).toBe('1 000 kr')
    expect(plain(formatMoney(5))).toBe('0,05 kr')
  })

  it('rejects non-integer input', () => {
    expect(() => formatMoney(10.5)).toThrow()
  })
})

describe('parseMoney', () => {
  it.each([
    ['1 999,50', 199950],
    ['1999.50', 199950],
    ['1 999,50 kr', 199950],
    ['1\u00a0999,5', 199950],
    ['0,07', 7],
    ['42', 4200],
    ['-10,25', -1025],
  ])('parses %j as %i öre', (input, expected) => {
    expect(parseMoney(input)).toBe(expected)
  })

  it.each(['', 'abc', '1,999', '12,345', '1.2.3'])('rejects %j', (input) => {
    expect(parseMoney(input)).toBeNull()
  })

  it('round-trips without rounding errors', () => {
    for (const ore of [1, 99, 199950, 123456789]) {
      expect(parseMoney(formatMoney(ore))).toBe(ore)
    }
  })
})
