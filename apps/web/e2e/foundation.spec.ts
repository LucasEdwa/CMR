import { expect, test } from '@playwright/test'

test('placeholder page loads and the API and database are up', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('CRM')
  await expect(page.getByTestId('health-api')).toContainText('OK')
  await expect(page.getByTestId('health-db')).toContainText('OK')
})

test('switching language translates the page and is remembered', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Systemstatus' })).toBeVisible()

  await page.getByRole('button', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'System status' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'System status' })).toBeVisible()
})

test('amounts use Swedish formatting', async ({ page }) => {
  await page.goto('/')
  const text = await page.getByTestId('sample-amount').textContent()
  expect(text?.replace(/\s/g, ' ')).toBe('1 999,50 kr')
})

test('unknown URLs show a not-found page', async ({ page }) => {
  await page.goto('/does-not-exist')
  await expect(page.getByRole('heading', { name: 'Sidan finns inte' })).toBeVisible()
})

test('page has no horizontal scroll at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})
