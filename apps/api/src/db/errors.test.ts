import { describe, expect, it } from 'vitest'
import { scrubError, scrubQueryParams } from './errors.js'

describe('scrubbing query errors', () => {
  it('keeps the SQL and drops the values', () => {
    const message = 'Failed query: insert into "contacts" ("first_name", "email") values ($1, $2)\nparams: Åsa,asa@kund.se'
    expect(scrubQueryParams(message)).toBe('Failed query: insert into "contacts" ("first_name", "email") values ($1, $2)\nparams: [redacted]')
    const err = Object.assign(new Error(message), { cause: { code: '23505', message: 'duplicate key value' } })
    expect(JSON.stringify(scrubError(err))).not.toMatch(/asa@kund\.se|Åsa/)
    expect(scrubError(err)).toMatchObject({ cause: { code: '23505' } })
  })
})
