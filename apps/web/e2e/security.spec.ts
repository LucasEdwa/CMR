import { BASE_ORIGIN, NEW_PASSWORD, OTHER_PASSWORD, colleague, expect, freshCompany, loginThroughForm, test } from './support/fixtures.ts'
import { totp } from './support/totp.ts'
import type { Page } from '@playwright/test'

// Turns on two-factor login from the profile page and returns the key the app would hold.
async function turnOn2fa(page: Page, password = NEW_PASSWORD) {
  await page.goto(`${BASE_ORIGIN}/settings/profile`)
  const section = page.getByRole('region', { name: 'Tvåstegsinloggning' })
  await section.getByRole('button', { name: 'Slå på tvåstegsinloggning' }).click()
  await section.getByLabel('Nuvarande lösenord').fill(password)
  await section.getByRole('button', { name: 'Fortsätt' }).click()
  await expect(section.getByRole('img', { name: 'QR-kod för appen' })).toBeVisible()
  const key = (await section.locator('code').textContent())!.trim()
  await section.getByLabel('Kod från appen (6 siffror)').fill(totp(key))
  await section.getByRole('button', { name: 'Bekräfta' }).click()
  await expect(page.getByRole('list', { name: 'Reservkoder' }).getByRole('listitem')).toHaveCount(10)
  const backup = (await page.getByRole('list', { name: 'Reservkoder' }).getByRole('listitem').first().textContent())!.trim()
  await page.getByRole('button', { name: 'Jag har sparat koderna' }).click()
  return { key, backup }
}

test('turn on two-factor login; logging in then asks for a code from the app', async ({ page }) => {
  const email = await freshCompany(page, 'Tvåsteg AB')
  const { key, backup } = await turnOn2fa(page)
  await expect(page.getByText('Status: På')).toBeVisible()

  await page.context().clearCookies()
  await page.goto('/login')
  await loginThroughForm(page, email, NEW_PASSWORD)
  await expect(page.getByRole('heading', { name: 'Tvåstegsinloggning' })).toBeVisible()
  await page.getByLabel('Kod från appen (6 siffror)').fill('000000')
  await page.getByRole('button', { name: 'Logga in' }).click()
  await expect(page.getByText(/Fel kod/)).toBeVisible()
  await page.getByLabel('Kod från appen (6 siffror)').fill(totp(key))
  await page.getByRole('button', { name: 'Logga in' }).click()
  await expect(page.getByRole('heading', { name: 'Hej Olle!' })).toBeVisible()

  // A backup code works once instead of the app.
  await page.context().clearCookies()
  await page.goto('/login')
  await loginThroughForm(page, email, NEW_PASSWORD)
  await page.getByRole('button', { name: 'Använd en reservkod i stället' }).click()
  await page.getByLabel('Reservkod').fill(backup)
  await page.getByRole('button', { name: 'Logga in' }).click()
  await expect(page.getByRole('heading', { name: 'Hej Olle!' })).toBeVisible()

  await page.goto('/settings/profile')
  const log = page.getByRole('list', { name: 'Säkerhetslogg' })
  await expect(log.getByText('Tvåstegsinloggning slogs på')).toBeVisible()
  await expect(log.getByText('Inloggning').first()).toBeVisible()
})

test('a workspace that requires two-factor login sends members to set it up first', async ({ page, browser }) => {
  await freshCompany(page, 'Krav AB')
  const erik = await colleague(page, browser, 'Erik')
  await turnOn2fa(page)
  await page.goto('/settings')
  await page.getByLabel('Kräv tvåstegsinloggning för alla').check()
  await page.getByRole('button', { name: 'Spara' }).click()
  await expect(page.getByText('Sparat')).toBeVisible()

  await erik.page.goto(`${BASE_ORIGIN}/contacts`)
  await expect(erik.page).toHaveURL(/\/setup-2fa$/)
  await expect(erik.page.getByRole('heading', { name: 'Slå på tvåstegsinloggning' })).toBeVisible()
  await erik.page.getByLabel('Nuvarande lösenord').fill(NEW_PASSWORD)
  await erik.page.getByRole('button', { name: 'Fortsätt' }).click()
  const key = (await erik.page.locator('code').first().textContent())!.trim()
  await erik.page.getByLabel('Kod från appen (6 siffror)').fill(totp(key))
  await erik.page.getByRole('button', { name: 'Bekräfta' }).click()
  await erik.page.getByRole('button', { name: 'Jag har sparat koderna' }).click()
  await expect(erik.page.getByRole('heading', { name: 'Hej Erik!' })).toBeVisible()
  await erik.close()
})

test('change the password and log out other devices', async ({ page, browser }) => {
  const email = await freshCompany(page, 'Byte AB')
  const other = await browser.newContext()
  const laptop = await other.newPage()
  await laptop.goto(`${BASE_ORIGIN}/login`)
  await loginThroughForm(laptop, email, NEW_PASSWORD)
  await expect(laptop.getByRole('heading', { name: 'Hej Olle!' })).toBeVisible()

  await page.goto('/settings/profile')
  await expect(page.getByRole('list', { name: 'Inloggade enheter' }).getByRole('listitem')).toHaveCount(2)
  const passwordSection = page.getByRole('region', { name: 'Lösenord' })
  await passwordSection.getByLabel('Nuvarande lösenord').fill(NEW_PASSWORD)
  await passwordSection.getByLabel('Nytt lösenord').fill(OTHER_PASSWORD)
  await page.getByRole('button', { name: 'Byt lösenord' }).click()
  await expect(page.getByText('Lösenordet är bytt')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('list', { name: 'Inloggade enheter' }).getByRole('listitem')).toHaveCount(1)

  await laptop.goto(`${BASE_ORIGIN}/contacts`)
  await expect(laptop).toHaveURL(/\/login/)
  await other.close()
})
