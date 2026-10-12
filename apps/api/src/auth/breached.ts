import { createHash } from 'node:crypto'
import { env } from '../env.js'
import { HttpError } from '../errors.js'

// Have I Been Pwned "range" check: only the first 5 characters of the password's SHA-1 leave
// the server (k-anonymity), and padding hides how many matches came back. Used where Better
// Auth's own check does not run (accounts created by accepting an invitation).
export async function isBreached(password: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const hash = createHash('sha1').update(password).digest('hex').toUpperCase()
  const res = await fetcher(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
    headers: { 'Add-Padding': 'true', 'User-Agent': 'CRM password check' },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`password check failed: ${res.status}`)
  const suffix = hash.slice(5)
  return (await res.text()).split(/\r?\n/).some((line) => {
    const [candidate, count] = line.split(':')
    return candidate === suffix && Number(count) > 0
  })
}

export async function assertPasswordNotBreached(password: string) {
  if (!env.PASSWORD_BREACH_CHECK) return
  let breached: boolean
  try {
    breached = await isBreached(password)
  } catch {
    // Same as Better Auth's check: when the service cannot be reached, ask the user to retry.
    throw new HttpError(503, 'password_check_unavailable', 'The password could not be checked. Try again in a moment.')
  }
  if (breached) throw new HttpError(400, 'PASSWORD_COMPROMISED', 'This password has appeared in a data breach. Choose another one.')
}
