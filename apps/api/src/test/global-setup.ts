import postgres from 'postgres'
import { runMigrations } from '../db/migrate.js'

export default async function setup() {
  const ownerUrl =
    process.env.TEST_DATABASE_OWNER_URL ?? 'postgres://crm_owner:crm_owner@localhost:5432/crm_test'
  await runMigrations(ownerUrl, { quiet: true })
  // Rate-limit counters live in Postgres; start every run from zero.
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} })
  await sql`truncate rate_limits, login_failures`
  await sql.end()
}
