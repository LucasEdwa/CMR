// Drizzle wraps driver errors; the Postgres error (with code and constraint) is on `cause`.
type PgError = { code?: string; constraint_name?: string; constraint?: string }

function pgError(err: unknown): PgError | null {
  if (!err || typeof err !== 'object') return null
  const cause = (err as { cause?: unknown }).cause
  return ((cause && typeof cause === 'object' ? cause : err) as PgError) ?? null
}

// Drizzle's "Failed query: <sql>\nparams: <values>" message carries customer data (names, emails).
// Keep the SQL, drop the values, before anything is logged or sent to Sentry.
export const scrubQueryParams = (text: string) => text.replace(/\nparams:[\s\S]*$/, '\nparams: [redacted]')

export function scrubError(err: Error): Record<string, unknown> {
  const cause = (err as { cause?: { message?: string; code?: string } }).cause
  return {
    type: err.name,
    message: scrubQueryParams(err.message),
    ...(cause ? { cause: { code: cause.code, message: cause.message } } : {}),
    // The stack starts with the message: swap in the scrubbed one, keep the frames.
    stack: err.stack?.replace(err.message, scrubQueryParams(err.message)),
  }
}

// "new row violates row-level security policy" (or a revoked privilege).
export const isRlsViolation = (err: unknown) => pgError(err)?.code === '42501'

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = pgError(err)
  if (e?.code !== '23505') return false
  return !constraint || e.constraint_name === constraint || e.constraint === constraint
}
