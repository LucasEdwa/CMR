import { describe, expect, it } from 'vitest'
import { formatAmount, formatDate, formatWithPattern } from './format'

const plain = (s: string) => s.replace(/\s/g, ' ')

describe('format', () => {
  it('formats amounts the Swedish way', () => {
    expect(plain(formatAmount(199950))).toBe('1 999,50 kr')
  })

  it('shows dates in Stockholm time, not UTC', () => {
    // 23:30 UTC on Dec 31 is already Jan 1 in Stockholm.
    expect(formatDate('2026-12-31T23:30:00Z', 'sv')).toBe('1 jan. 2027')
  })
})

describe('formatWithPattern', () => {
  const d = new Date('2026-03-05T23:30:00Z') // already March 6 in Stockholm
  it.each([
    ['yyyy-MM-dd', '2026-03-06'],
    ['dd/MM/yyyy', '06/03/2026'],
    ['d MMM yyyy', '6 mar 2026'],
  ])('%s', (pattern, expected) => {
    expect(formatWithPattern(d, pattern)).toBe(expected)
  })
})
