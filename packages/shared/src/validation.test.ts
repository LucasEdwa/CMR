import { describe, expect, it } from 'vitest'
import { normalizeOrgNumber, slugify, SLUG_PATTERN } from './validation.js'

describe('normalizeOrgNumber', () => {
  it.each([
    ['556036-0793', '556036-0793'],
    ['5560360793', '556036-0793'],
    ['16556036-0793', '556036-0793'],
    [' 556036 0793 ', '556036-0793'],
  ])('accepts %j', (input, expected) => {
    expect(normalizeOrgNumber(input)).toBe(expected)
  })

  it.each(['556036-0794', '12345', 'abcdefghij', ''])('rejects %j', (input) => {
    expect(normalizeOrgNumber(input)).toBeNull()
  })
})

describe('slugify', () => {
  it('turns Swedish company names into valid slugs', () => {
    expect(slugify('Åkesson & Söner AB')).toBe('akesson-soner-ab')
    expect(SLUG_PATTERN.test(slugify('Åkesson & Söner AB'))).toBe(true)
  })
})

describe('orgNumberSchema', () => {
  it('treats empty and null as no org number', async () => {
    const { orgNumberSchema } = await import('./auth.js')
    expect(orgNumberSchema.parse('')).toBeNull()
    expect(orgNumberSchema.parse(null)).toBeNull()
    expect(orgNumberSchema.parse('5560360793')).toBe('556036-0793')
    expect(orgNumberSchema.safeParse('123').success).toBe(false)
  })
})
