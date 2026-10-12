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

// The app always connects as app_user, which is subject to RLS.
export const { client: appClient, db } = createDb(env.DATABASE_URL)
