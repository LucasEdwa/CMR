import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import type { Health } from '@crm/shared'
import { db } from '../db/client.js'
import { env } from '../env.js'

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (): Promise<Health> => {
    let dbStatus: Health['db'] = 'ok'
    try {
      await db.execute(sql`select 1`)
    } catch {
      dbStatus = 'down'
    }
    return { status: 'ok', db: dbStatus, env: env.APP_ENV, version: env.RELEASE }
  })
}
