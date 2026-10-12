import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import type { Health } from '@crm/shared'
import { db } from '../db/client.js'

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (): Promise<Health> => {
    let dbStatus: Health['db'] = 'ok'
    try {
      await db.execute(sql`select 1`)
    } catch {
      dbStatus = 'down'
    }
    // Public: no environment or version, which would help an attacker pick known bugs.
    // The release is in Sentry and the deploy logs.
    return { status: 'ok', db: dbStatus }
  })
}
