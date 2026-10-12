import { buildApp } from './app.js'
import { appClient } from './db/client.js'
import { env } from './env.js'
import { startWorker } from './worker.js'

const app = await buildApp()
const boss = env.RUN_WORKER ? await startWorker() : null

const shutdown = async () => {
  await app.close()
  await boss?.stop()
  await appClient.end()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

await app.listen({ port: env.PORT, host: '0.0.0.0' })
