import { describe, expect, it } from 'vitest'
import { createDealSchema, dealListQuerySchema, savePicklistSchema, saveStagesSchema } from './deals.js'
import { parseMoney } from './money.js'

describe('deal schemas', () => {
  it('stores money as integer öre', () => {
    const value = parseMoney('1 999,50')!
    expect(createDealSchema.parse({ name: 'Avtal', value })).toMatchObject({ value: 199950, contactIds: [] })
    expect(createDealSchema.safeParse({ name: 'Avtal', value: 1999.5 }).success).toBe(false)
  })

  it('treats an empty close date as none', () => {
    expect(createDealSchema.parse({ name: 'X', expectedCloseDate: '' }).expectedCloseDate).toBeNull()
  })

  it('needs at least one stage with a valid probability', () => {
    expect(saveStagesSchema.safeParse({ stages: [] }).success).toBe(false)
    expect(saveStagesSchema.safeParse({ stages: [{ name: 'A', probability: 120 }] }).success).toBe(false)
  })

  it('a new picklist item needs a label', () => {
    expect(savePicklistSchema.safeParse({ items: [{ label: '' }] }).success).toBe(false)
    expect(savePicklistSchema.safeParse({ items: [{ key: 'price' }, { label: 'För dyrt' }] }).success).toBe(true)
  })

  it('list query defaults to newest changes first', () => {
    expect(dealListQuerySchema.parse({ status: 'open' })).toMatchObject({ status: ['open'], sort: 'updatedAt', dir: 'desc' })
  })
})
