// Local only: creates the owner and app roles plus the dev and test databases.
// On Neon/staging, run the equivalent once by hand (see README "Staging database").
import postgres from 'postgres'

const superuserUrl = process.env.DATABASE_SUPERUSER_URL ?? 'postgres://localhost:5432/postgres'
const databases = ['crm', 'crm_test']

const sql = postgres(superuserUrl, { max: 1, onnotice: () => {} })

async function ensureRole(name: string, password: string, extra: string) {
  const [existing] = await sql`select 1 from pg_roles where rolname = ${name}`
  const verb = existing ? 'alter' : 'create'
  await sql.unsafe(`${verb} role ${name} with login password '${password}' ${extra}`)
  console.log(`${verb}d role ${name}`)
}

try {
  await ensureRole('crm_owner', 'crm_owner', 'nosuperuser nobypassrls')
  await ensureRole('app_user', 'app_user', 'nosuperuser nobypassrls nocreatedb nocreaterole')

  for (const name of databases) {
    const [existing] = await sql`select 1 from pg_database where datname = ${name}`
    if (!existing) {
      await sql.unsafe(`create database ${name} owner crm_owner`)
      console.log(`created database ${name}`)
    }
    await sql.unsafe(`grant connect on database ${name} to app_user`)
  }
  console.log('Done. Next: pnpm db:migrate')
} finally {
  await sql.end()
}
