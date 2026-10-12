import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { loginFailures } from '../db/schema.js'

// Two counters per login attempt: one per IP + email (stops one guesser quickly), and one per
// email from any IP (stops guessing spread over many IPs). Both reset after 15 minutes.
export const MAX_FAILURES = 10
export const MAX_FAILURES_ANY_IP = 30
const WINDOW_MS = 15 * 60 * 1000

const normal = (email: string) => email.trim().toLowerCase()
const keyOf = (ip: string, email: string) => `${ip}|${normal(email)}`
const anyIpKey = (email: string) => `*|${normal(email)}`

async function count(key: string) {
  const [row] = await db.select().from(loginFailures).where(eq(loginFailures.key, key))
  return row && Date.now() - row.windowStart.getTime() < WINDOW_MS ? row.count : 0
}

export async function isLockedOut(ip: string, email: string): Promise<boolean> {
  const [mine, all] = await Promise.all([count(keyOf(ip, email)), count(anyIpKey(email))])
  return mine >= MAX_FAILURES || all >= MAX_FAILURES_ANY_IP
}

// Wrong 2FA codes, counted per account from any IP: Better Auth's own limit is per IP only, and a
// six-digit code must not be guessable by someone who already has the password.
export const MAX_TWO_FACTOR_FAILURES = 10
const twoFactorKey = (userId: string) => `2fa|${userId}`

export const isTwoFactorLockedOut = async (userId: string) => (await count(twoFactorKey(userId))) >= MAX_TWO_FACTOR_FAILURES
export const recordTwoFactorFailure = (userId: string) => bump(twoFactorKey(userId))
export const clearTwoFactorFailures = async (userId: string) => {
  await db.delete(loginFailures).where(eq(loginFailures.key, twoFactorKey(userId)))
}

export async function recordFailure(ip: string, email: string) {
  await bump(keyOf(ip, email))
  await bump(anyIpKey(email))
}

async function bump(key: string) {
  const now = new Date()
  // Raw sql fragments need strings: the driver does not serialize Date objects there.
  const nowIso = now.toISOString()
  const windowStartIso = new Date(Date.now() - WINDOW_MS).toISOString()
  await db
    .insert(loginFailures)
    .values({ key, count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: loginFailures.key,
      // Start a new window when the old one has passed.
      set: {
        count: sql`case when ${loginFailures.windowStart} < ${windowStartIso}::timestamptz then 1 else ${loginFailures.count} + 1 end`,
        windowStart: sql`case when ${loginFailures.windowStart} < ${windowStartIso}::timestamptz then ${nowIso}::timestamptz else ${loginFailures.windowStart} end`,
      },
    })
}

// A successful login clears this IP's counter only: a guesser elsewhere stays counted.
export async function clearFailures(ip: string, email: string) {
  await db.delete(loginFailures).where(eq(loginFailures.key, keyOf(ip, email)))
}
