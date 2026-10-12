import { defineConfig, devices } from '@playwright/test'

const isCI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Many tests start by signing up a fresh company (with a real verification email).
  timeout: 60_000,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    locale: 'sv-SE',
    timezoneId: 'Europe/Stockholm',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  // Against a deployed URL (E2E_BASE_URL) nothing is started locally.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: 'pnpm --filter @crm/api dev',
          url: 'http://localhost:3001/api/health',
          reuseExistingServer: !isCI,
          timeout: 60_000,
        },
        {
          command: 'pnpm dev',
          url: 'http://localhost:5173',
          reuseExistingServer: !isCI,
          timeout: 60_000,
        },
      ],
})
