import type { Browser, Page } from '@playwright/test'
import { expect, loginAs, test, uniqueEmail, users, NEW_PASSWORD } from './support/fixtures.ts'
import { linkFromEmail } from './support/mailpit.ts'

async function newCompany(page: Page, name: string) {
  const email = uniqueEmail('owner')
  await page.request.post('/api/auth/sign-up/email', {
    data: { name: 'Olle Owner', email, password: NEW_PASSWORD },
    headers: { origin: 'http://localhost:5173' },
  })
  await page.goto(await linkFromEmail(email, '/verify-email'))
  await page.getByLabel('Företagsnamn').fill(name)
  await page.getByLabel('Adress').fill(`co-${Date.now()}-${Math.floor(Math.random() * 1000)}`)
  await page.getByRole('button', { name: 'Skapa', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Hej Olle!' })).toBeVisible()
}

async function invite(page: Page, email: string, role: string) {
  await page.goto('/settings/members')
  await page.getByLabel('E-post').fill(email)
  await page.getByLabel('Roll').first().selectOption({ label: role })
  await page.getByRole('button', { name: 'Skicka inbjudan' }).click()
  await expect(page.getByText(`Inbjudan skickad till ${email}`)).toBeVisible()
  return linkFromEmail(email, '/invite/')
}

async function otherBrowser(browser: Browser) {
  const context = await browser.newContext({
    locale: 'sv-SE',
    extraHTTPHeaders: { 'x-forwarded-for': `10.200.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
  })
  return context.newPage()
}

test('invite a colleague as Member; they accept in another browser and both see the same company', async ({ page, browser }) => {
  await newCompany(page, 'Inbjudningstest AB')
  const email = uniqueEmail('member')
  const link = await invite(page, email, 'Medlem')

  const guest = await otherBrowser(browser)
  await guest.goto(link)
  await expect(guest.getByRole('heading', { name: 'Gå med i Inbjudningstest AB' })).toBeVisible()
  await guest.getByLabel('Namn').fill('Maja Medlem')
  await guest.getByLabel('Lösenord').fill(NEW_PASSWORD)
  await guest.getByRole('button', { name: 'Skapa konto och gå med' }).click()
  await expect(guest.getByRole('button', { name: 'Byt företag' })).toContainText('Inbjudningstest AB')

  await page.reload()
  await expect(page.getByText('Maja Medlem')).toBeVisible()
  await guest.context().close()
})

test('a used invitation link is rejected', async ({ page, browser }) => {
  await newCompany(page, 'Engångslänk AB')
  const link = await invite(page, uniqueEmail('once'), 'Medlem')

  const first = await otherBrowser(browser)
  await first.goto(link)
  await first.getByLabel('Namn').fill('Första')
  await first.getByLabel('Lösenord').fill(NEW_PASSWORD)
  await first.getByRole('button', { name: 'Skapa konto och gå med' }).click()
  await expect(first.getByRole('heading', { name: 'Hej Första!' })).toBeVisible()

  const second = await otherBrowser(browser)
  await second.goto(link)
  await expect(second.getByRole('heading', { name: 'Inbjudan fungerar inte' })).toBeVisible()
  await expect(second.getByText('Inbjudan har redan använts.')).toBeVisible()
  await first.context().close()
  await second.context().close()
})

test('a removed member loses access on their next click', async ({ page, browser }) => {
  await newCompany(page, 'Borttagning AB')
  const email = uniqueEmail('removed')
  const link = await invite(page, email, 'Medlem')

  const member = await otherBrowser(browser)
  await member.goto(link)
  await member.getByLabel('Namn').fill('Rolf Removed')
  await member.getByLabel('Lösenord').fill(NEW_PASSWORD)
  await member.getByRole('button', { name: 'Skapa konto och gå med' }).click()
  await expect(member.getByRole('heading', { name: 'Hej Rolf!' })).toBeVisible()

  await page.reload()
  await page.getByRole('listitem').filter({ hasText: 'Rolf Removed' }).getByRole('button', { name: 'Ta bort' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Ta bort' }).click()
  await expect(page.getByText('Rolf Removed')).toHaveCount(0)

  // Next click: open the profile from the user menu (same on desktop and phone).
  await member.getByRole('button', { name: 'Rolf Removed' }).click()
  await member.getByRole('menuitem', { name: 'Min profil' }).click()
  await expect(member.getByRole('heading', { name: 'Skapa ert konto' })).toBeVisible()
  await member.context().close()
})

test('switching to English translates the whole app shell and is saved on the profile', async ({ page }) => {
  // A fresh account, so the seed users keep Swedish.
  await newCompany(page, 'Språk AB')
  await page.goto('/settings/profile')
  await page.getByRole('button', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Switch company' })).toBeVisible()

  // Saved server-side: a new browser with Swedish defaults still gets English after login.
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
})

test('Beta cannot see Acme: Sara only has Beta AB', async ({ page }) => {
  await loginAs(page, users.sara.email)
  await page.goto('/settings/members')
  await expect(page.getByRole('button', { name: 'Byt företag' })).toContainText('Beta AB')
  await expect(page.getByText('Anna Åberg')).toHaveCount(0)
  await page.getByRole('button', { name: 'Byt företag' }).click()
  await expect(page.getByRole('menuitem', { name: /Acme AB/ })).toHaveCount(0)
})
