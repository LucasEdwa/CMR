import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { isBreached } from './breached.js'

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex').toUpperCase()

// A stand-in for the Have I Been Pwned range API.
function fakeRange(breached: string[]) {
  const asked: string[] = []
  const fetcher = (async (url: string | URL) => {
    const prefix = String(url).split('/').pop()!
    asked.push(prefix)
    const lines = breached.map(sha1).filter((h) => h.startsWith(prefix)).map((h) => `${h.slice(5)}:42`)
    // Padding entries have a count of 0 and never count as a match.
    lines.push(`${'0'.repeat(35)}:0`)
    return new Response(lines.join('\r\n'))
  }) as typeof fetch
  return { fetcher, asked }
}

describe('breached password check', () => {
  it('finds a breached password and sends only a 5-character hash prefix', async () => {
    const { fetcher, asked } = fakeRange(['Password123!'])
    expect(await isBreached('Password123!', fetcher)).toBe(true)
    expect(asked).toEqual([sha1('Password123!').slice(0, 5)])
    expect(await isBreached('en-helt-egen-lösenfras-2026', fetcher)).toBe(false)
  })

  it('fails loudly when the service answers with an error', async () => {
    const fetcher = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch
    await expect(isBreached('whatever-password', fetcher)).rejects.toThrow()
  })
})
