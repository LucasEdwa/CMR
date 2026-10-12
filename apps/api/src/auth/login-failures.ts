import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { loginFailures } from '../db/schema.js'

export const MAX_FAILURES = 10
const WINDOW_MS = 15 * 60 * 1000

const keyOf = (ip: string, email: string) => `${ip}|${email.trim().toLowerCase()}`

export async function isLockedOut(ip: string, email: string): Promise<boolean> {
  const [row] = await db.select().from(loginFailures).where(eq(loginFailures.key, keyOf(ip, email)))
  return !!row && row.count >= MAX_FAILURES && Date.now() - row.windowStart.getTime() < WINDOW_MS
}

export async function recordFailure(ip: string, email: string) {
  const now = new Date()
  // Raw sql fragments need strings: the driver does not serialize Date objects there.
  const nowIso = now.toISOString()
  const windowStartIso = new Date(Date.now() - WINDOW_MS).toISOString()
  await db
    .insert(loginFailures)
    .values({ key: keyOf(ip, email), count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: loginFailures.key,
      // Start a new window when the old one has passed.
      set: {
        count: sql`case when ${loginFailures.windowStart} < ${windowStartIso}::timestamptz then 1 else ${loginFailures.count} + 1 end`,
        windowStart: sql`case when ${loginFailures.windowStart} < ${windowStartIso}::timestamptz then ${nowIso}::timestamptz else ${loginFailures.windowStart} end`,
      },
    })
}

export async function clearFailures(ip: string, email: string) {
  await db.delete(loginFailures).where(eq(loginFailures.key, keyOf(ip, email)))
}
