import { test as base, expect, type Browser, type Page } from '@playwright/test'
import { randomInt, randomUUID } from 'node:crypto'

export const SEED_PASSWORD = 'Password123!'
// New accounts need passwords that are not in any breach list (the API checks Have I Been Pwned).
export const NEW_PASSWORD = 'Kvarnen-Sjövik-Hägg-2026'
export const OTHER_PASSWORD = 'Älvdal-Granskog-Bro-2027'
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

// A brand-new owner with their own company, so tests can change data freely.
export async function freshCompany(page: Page, name: string) {
  const email = uniqueEmail('owner')
  await page.request.post('/api/auth/sign-up/email', {
    data: { name: 'Olle Owner', email, password: NEW_PASSWORD },
    headers: { origin: BASE_ORIGIN },
  })
  const { linkFromEmail } = await import('./mailpit.ts')
  await page.goto(await linkFromEmail(email, '/verify-email'))
  await page.getByLabel('Företagsnamn').fill(name)
  await page.getByLabel('Adress').fill(`co-${Date.now()}-${randomInt(1000)}`)
  await page.getByRole('button', { name: 'Skapa', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Hej Olle!' })).toBeVisible()
  return email
}

// Creates records through the API (fast setup); returns the created JSON.
export async function apiPost<T = { id: string }>(page: Page, path: string, data: object): Promise<T> {
  const res = await page.request.post(`/api${path}`, { data, headers: { origin: BASE_ORIGIN } })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as T
}

// Invites a colleague into the owner's company and returns a logged-in page for them.
export async function colleague(owner: Page, browser: Browser, name: string, role = 'member') {
  const email = uniqueEmail(name.toLowerCase())
  await apiPost(owner, '/workspace/invitations', { email, role })
  const { linkFromEmail } = await import('./mailpit.ts')
  const token = (await linkFromEmail(email, '/invite/')).split('/invite/')[1]!
  const context = await browser.newContext({ locale: 'sv-SE', timezoneId: 'Europe/Stockholm', extraHTTPHeaders: { 'x-forwarded-for': randomIp() } })
  const page = await context.newPage()
  const res = await page.request.post(`${BASE_ORIGIN}/api/invitations/${token}/accept`, {
    data: { name, password: NEW_PASSWORD },
    headers: { origin: BASE_ORIGIN },
  })
  expect(res.status(), await res.text()).toBe(200)
  const id = ((await (await page.request.get(`${BASE_ORIGIN}/api/me`)).json()) as { user: { id: string } }).user.id
  return { page, email, id, close: () => context.close() }
}
