// Drizzle wraps driver errors; the Postgres error (with code and constraint) is on `cause`.
type PgError = { code?: string; constraint_name?: string; constraint?: string }

function pgError(err: unknown): PgError | null {
  if (!err || typeof err !== 'object') return null
  const cause = (err as { cause?: unknown }).cause
  return ((cause && typeof cause === 'object' ? cause : err) as PgError) ?? null
}

// "new row violates row-level security policy" (or a revoked privilege).
export const isRlsViolation = (err: unknown) => pgError(err)?.code === '42501'

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = pgError(err)
  if (e?.code !== '23505') return false
  return !constraint || e.constraint_name === constraint || e.constraint === constraint
}
