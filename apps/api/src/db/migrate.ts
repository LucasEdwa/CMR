// Runs as the owner role: schema migrations, pg-boss schema and queues, then grants for app_user.
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { BOSS_SCHEMA, createBoss } from '../jobs/boss.js'
import { QUEUES } from '../jobs/queues.js'

const here = path.dirname(fileURLToPath(import.meta.url))
// Both src/db (dev) and dist/db (built) sit two levels below apps/api.
const migrationsFolder = process.env.MIGRATIONS_DIR ?? path.resolve(here, '../../drizzle')

export async function runMigrations(ownerUrl: string, { quiet = false } = {}) {
  const log = quiet ? () => {} : console.log
  const client = postgres(ownerUrl, { max: 1, onnotice: () => {} })
  try {
    await migrate(drizzle(client), { migrationsFolder })
    log('schema migrations applied')

    const boss = createBoss(ownerUrl, { migrate: true })
    await boss.start()
    for (const name of Object.values(QUEUES)) {
      if (!(await boss.getQueue(name))) await boss.createQueue(name)
    }
    await boss.stop({ graceful: false })
    log('pg-boss schema and queues ready')

    await client.unsafe(`
      grant usage on schema ${BOSS_SCHEMA} to app_user;
      grant select, insert, update, delete on all tables in schema ${BOSS_SCHEMA} to app_user;
      grant usage, select on all sequences in schema ${BOSS_SCHEMA} to app_user;
      grant execute on all functions in schema ${BOSS_SCHEMA} to app_user;
    `)
    log('grants applied')
  } finally {
    await client.end()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_OWNER_URL ?? 'postgres://crm_owner:crm_owner@localhost:5432/crm'
  runMigrations(url).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
