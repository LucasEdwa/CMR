import { defineConfig } from 'vitest/config'

const testDb = (role: string) => `postgres://${role}:${role}@localhost:5432/crm_test`

export default defineConfig({
  test: {
    globalSetup: ['./src/test/global-setup.ts'],
    // Integration tests share one real Postgres database; run files one at a time.
    fileParallelism: false,
    testTimeout: 15_000,
    env: {
      APP_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? testDb('app_user'),
      DATABASE_OWNER_URL: process.env.TEST_DATABASE_OWNER_URL ?? testDb('crm_owner'),
      RUN_WORKER: 'false',
    },
  },
})
