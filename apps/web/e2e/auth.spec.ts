import { expect, loginThroughForm, test, uniqueEmail, users } from './support/fixtures.ts'
import { linkFromEmail } from './support/mailpit.ts'

test('sign up, verify by email, create a company and land in an empty app', async ({ page }) => {
  const email = uniqueEmail('signup')
  await page.goto('/signup')
  await page.getByLabel('Namn').fill('Nora Nyström')
  await page.getByLabel('E-post').fill(email)
  await page.getByLabel('Lösenord').fill('Secret123!')
  await page.getByRole('button', { name: 'Skapa konto' }).click()
  await expect(page.getByRole('heading', { name: 'Kolla din inkorg' })).toBeVisible()

  await page.goto(await linkFromEmail(email, '/verify-email'))
  await expect(page.getByRole('heading', { name: 'Skapa ert konto' })).toBeVisible()

  await page.getByLabel('Företagsnamn').fill('Nyström & Co AB')
  await expect(page.getByLabel('Adress')).toHaveValue('nystrom-co-ab')
  await page.getByLabel('Adress').fill(`nystrom-${Date.now()}`)
  await page.getByRole('button', { name: 'Skapa', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Hej Nora!' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Kom igång' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Byt företag' })).toContainText('Nyström & Co AB')
})

test('logged out, app URLs redirect to login and come back after logging in', async ({ page }) => {
  await page.goto('/settings/members')
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fmembers/)
  await loginThroughForm(page, users.anna.email)
  await expect(page).toHaveURL(/\/settings\/members$/)
  await expect(page.getByRole('heading', { name: 'Användare' })).toBeVisible()
})

test('password reset works end to end', async ({ page }) => {
  // Use a fresh account so the seed users keep their password.
  const email = uniqueEmail('reset')
  await page.request.post('/api/auth/sign-up/email', {
    data: { name: 'Rut Reset', email, password: 'OldPassword1!' },
    headers: { origin: 'http://localhost:5173' },
  })
  await page.goto(await linkFromEmail(email, '/verify-email'))
  await expect(page.getByRole('heading', { name: 'Skapa ert konto' })).toBeVisible()
  await page.getByRole('button', { name: 'Logga ut' }).click()

  await page.goto('/forgot-password')
  await page.getByLabel('E-post').fill(email)
  await page.getByRole('button', { name: 'Skicka länk' }).click()
  await expect(page.getByText(`Om det finns ett konto för ${email}`)).toBeVisible()

  await page.goto(await linkFromEmail(email, '/reset-password'))
  await page.getByLabel('Nytt lösenord').fill('NewPassword2!')
  await page.getByRole('button', { name: 'Spara lösenord' }).click()
  await expect(page.getByText('Lösenordet är ändrat')).toBeVisible()

  await page.getByRole('link', { name: 'Logga in' }).click()
  await loginThroughForm(page, email, 'OldPassword1!')
  await expect(page.getByText('Fel e-post eller lösenord.')).toBeVisible()
  await loginThroughForm(page, email, 'NewPassword2!')
  await expect(page).toHaveURL(/\/onboarding$/)
})

test('10 wrong passwords in a row gets you rate-limited', async ({ page }) => {
  await page.goto('/login')
  for (let i = 0; i < 10; i++) {
    await loginThroughForm(page, users.vera.email, `wrong-${i}`)
    await expect(page.getByText('Fel e-post eller lösenord.')).toBeVisible()
  }
  await loginThroughForm(page, users.vera.email, 'still-wrong')
  await expect(page.getByText('För många försök. Vänta en stund och försök igen.')).toBeVisible()
})
