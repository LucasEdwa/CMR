import { describe, expect, it } from 'vitest'
import {
  contactListQuerySchema,
  createCompanySchema,
  createContactSchema,
  normalizeDomain,
  normalizeVatNumber,
  updateContactSchema,
} from './crm.js'

describe('normalizeVatNumber', () => {
  it.each([
    ['SE556036079301', 'SE556036079301'],
    ['se 5560360793 01', 'SE556036079301'],
    ['DE123456789', 'DE123456789'],
  ])('accepts %j', (input, expected) => expect(normalizeVatNumber(input)).toBe(expected))

  it.each(['SE556036079401', 'SE5560360793', '123', 'S'])('rejects %j', (input) => expect(normalizeVatNumber(input)).toBeNull())
})

describe('normalizeDomain', () => {
  it('strips protocol, www and path', () => {
    expect(normalizeDomain('https://www.Acme.se/kontakt')).toBe('acme.se')
    expect(normalizeDomain('not a domain')).toBeNull()
  })
})

describe('contact schemas', () => {
  it('fills defaults and turns empty strings into null', () => {
    const c = createContactSchema.parse({ firstName: ' Anna ', email: ' Anna@Acme.SE ', phone: '' })
    expect(c).toMatchObject({ firstName: 'Anna', lastName: '', email: 'anna@acme.se', phone: null, lifecycleStage: 'lead', tags: [] })
  })

  it('rejects a bad email', () => {
    expect(createContactSchema.safeParse({ firstName: 'A', email: 'nope' }).success).toBe(false)
  })

  it('update only contains the fields that were sent', () => {
    expect(updateContactSchema.parse({ title: 'VD' })).toEqual({ title: 'VD' })
  })
})

describe('company schema', () => {
  it('normalises org number, VAT and domain', () => {
    const c = createCompanySchema.parse({ name: 'Acme', orgNumber: '5560360793', vatNumber: 'se556036079301', domain: 'www.acme.se' })
    expect(c).toMatchObject({ orgNumber: '556036-0793', vatNumber: 'SE556036079301', domain: 'acme.se' })
  })

  it('rejects an org number with a wrong checksum', () => {
    const r = createCompanySchema.safeParse({ name: 'Acme', orgNumber: '556036-0794' })
    expect(r.success).toBe(false)
  })
})

describe('list query', () => {
  it('accepts single values and arrays for multi filters', () => {
    const q = contactListQuerySchema.parse({ owner: 'me', tag: ['vip', 'nordic'], page: '2', pageSize: '50' })
    expect(q).toMatchObject({ owner: ['me'], tag: ['vip', 'nordic'], page: 2, pageSize: 50, sort: 'name', stage: [] })
  })

  it('rejects an unsupported page size', () => {
    expect(contactListQuerySchema.safeParse({ pageSize: '1000' }).success).toBe(false)
  })
})
