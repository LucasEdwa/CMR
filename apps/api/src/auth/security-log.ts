import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import type { SecurityEventType } from '@crm/shared'
import { db } from '../db/client.js'
import { securityEvents, sessions, users, verifications } from '../db/schema.js'

// Writes to the per-user security log. Never throws: a logging hiccup must not break a login.
export async function recordSecurityEvent(request: FastifyRequest, userId: string, type: SecurityEventType) {
  try {
    await db.insert(securityEvents).values({
      userId,
      type,
      ipAddress: request.ip,
      userAgent: String(request.headers['user-agent'] ?? '').slice(0, 300) || null,
    })
  } catch (err) {
    request.log.error({ err: { message: (err as Error).message } }, 'security event not recorded')
  }
}

export async function userIdByEmail(email: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
  return u?.id ?? null
}

// Better Auth's hashed identifier (storeIdentifier: 'hashed' in auth.ts).
const hashedIdentifier = (identifier: string) => createHash('sha256').update(identifier).digest('base64url')

// The user a password-reset token belongs to (read before Better Auth consumes it).
export async function userIdByResetToken(token: string) {
  const [v] = await db
    .select({ value: verifications.value })
    .from(verifications)
    .where(eq(verifications.identifier, hashedIdentifier(`reset-password:${token}`)))
  return v?.value ?? null
}

// The user a pending 2FA login belongs to, from the two-factor cookie set after the password step.
// Only used to count wrong codes: Better Auth itself checks the cookie's signature.
export async function userIdOfPendingTwoFactor(cookieHeader: string | undefined) {
  const match = /(?:^|;\s*)(?:__Secure-)?crm\.two_factor=([^;]+)/.exec(cookieHeader ?? '')
  const identifier = match?.[1] ? decodeURIComponent(match[1]).split('.')[0] : ''
  if (!identifier) return null
  const [v] = await db.select({ value: verifications.value }).from(verifications).where(eq(verifications.identifier, hashedIdentifier(identifier)))
  return v?.value ?? null
}

// A response that sets a session cookie started a new session: whose is it?
export async function userIdOfNewSession(setCookies: string[]) {
  for (const cookie of setCookies) {
    const match = /(?:^|__Secure-)crm\.session_token=([^;]+)/.exec(cookie)
    const value = match?.[1] ? decodeURIComponent(match[1]) : ''
    const token = value.split('.')[0]
    if (!token) continue
    const [s] = await db.select({ userId: sessions.userId }).from(sessions).where(and(eq(sessions.token, token)))
    if (s) return s.userId
  }
  return null
}

export async function twoFactorEnabled(userId: string) {
  const [u] = await db.select({ on: users.twoFactorEnabled }).from(users).where(eq(users.id, userId))
  return !!u?.on
}
