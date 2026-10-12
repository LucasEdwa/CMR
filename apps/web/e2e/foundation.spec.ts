import { expect, test } from './support/fixtures.ts'

test('the API and database are up', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(await res.json()).toMatchObject({ status: 'ok', db: 'ok' })
})

test('unknown URLs show a not-found page', async ({ page }) => {
  await page.goto('/does-not-exist')
  await expect(page.getByRole('heading', { name: 'Sidan finns inte' })).toBeVisible()
})

test('the login page can switch language and remembers it', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Logga in' })).toBeVisible()
  await page.getByRole('button', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
})

test('no horizontal scroll at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  for (const path of ['/login', '/signup']) {
    await page.goto(path)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(overflow, path).toBe(false)
  }
})
