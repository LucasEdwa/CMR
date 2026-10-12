import { test as base, expect, type Page } from '@playwright/test'
import { randomInt, randomUUID } from 'node:crypto'

export const SEED_PASSWORD = 'Password123!'
export const BASE_ORIGIN = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5173').origin

export const users = {
  anna: { email: 'anna@acme.test', name: 'Anna Åberg', workspace: 'Acme AB', role: 'owner' },
  adam: { email: 'adam@acme.test', name: 'Adam Öhman', workspace: 'Acme AB', role: 'admin' },
  erik: { email: 'erik@acme.test', name: 'Erik Ängström', workspace: 'Acme AB', role: 'member' },
  vera: { email: 'vera@acme.test', name: 'Vera Lindqvist', workspace: 'Acme AB', role: 'viewer' },
  sara: { email: 'sara@beta.test', name: 'Sara Björk', workspace: 'Beta AB', role: 'owner' },
} as const

export const uniqueEmail = (prefix = 'e2e') => `${prefix}-${randomUUID().slice(0, 8)}@e2e.test`

const randomIp = () => `10.${randomInt(1, 250)}.${randomInt(1, 250)}.${randomInt(1, 250)}`

// Every browser context gets its own client IP so rate limits never leak between tests.
export const test = base.extend({
  context: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext({
      baseURL,
      locale: 'sv-SE',
      timezoneId: 'Europe/Stockholm',
      extraHTTPHeaders: { 'x-forwarded-for': randomIp() },
    })
    await use(context)
    await context.close()
  },
})

export { expect }

// Logs in through the API (fast); the browser context then has the session cookie.
export async function loginAs(page: Page, email: string, password = SEED_PASSWORD) {
  const res = await page.request.post('/api/auth/sign-in/email', {
    data: { email, password },
    headers: { origin: BASE_ORIGIN },
  })
  expect(res.status(), await res.text()).toBe(200)
}

export async function loginThroughForm(page: Page, email: string, password = SEED_PASSWORD) {
  await page.getByLabel('E-post').fill(email)
  await page.getByLabel('Lösenord').fill(password)
  await page.getByRole('button', { name: 'Logga in' }).click()
}
