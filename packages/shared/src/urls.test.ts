import { describe, expect, it } from 'vitest'
import { redactUrl } from './urls.js'

describe('redactUrl', () => {
  it('drops query strings and fragments', () => {
    expect(redactUrl('/reset-password?token=abc')).toBe('/reset-password')
    expect(redactUrl('https://crm.example/contacts?q=anna#x')).toBe('https://crm.example/contacts')
  })

  it('replaces invitation secrets in the path', () => {
    expect(redactUrl('/invite/0b6c.secret')).toBe('/invite/[token]')
    expect(redactUrl('/api/invitations/0b6c.secret/accept')).toBe('/api/invitations/[token]/accept')
  })

  it('keeps the workspace invitation routes readable', () => {
    expect(redactUrl('/api/workspace/invitations')).toBe('/api/workspace/invitations')
  })
})
