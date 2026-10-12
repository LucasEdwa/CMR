import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env.js'
import * as schema from './schema.js'

export function createDb(url: string, options: postgres.Options<Record<string, never>> = {}) {
  const client = postgres(url, { max: 10, onnotice: () => {}, ...options })
  return { client, db: drizzle(client, { schema }) }
}

export type Db = ReturnType<typeof createDb>['db']
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

// The app always connects as app_user, which is subject to RLS. No query may run longer than
// 15 s and no transaction may sit idle: one workspace's heavy query cannot hold up the others.
export const APP_CONNECTION = { statement_timeout: 15_000, idle_in_transaction_session_timeout: 60_000 }
export const { client: appClient, db } = createDb(env.DATABASE_URL, { connection: APP_CONNECTION })
