import type { Page } from '@playwright/test'
import { apiPost, expect, freshCompany, test } from './support/fixtures.ts'

type Pipeline = { id: string; stages: Array<{ id: string; name: string }> }
const pipelinesOf = async (page: Page) => (await (await page.request.get('/api/pipelines')).json()).pipelines as Pipeline[]
const column = (page: Page, name: string) => page.getByRole('region', { name })
const totals = (page: Page, stage: string) => page.getByTestId(`totals-${stage}`)

// dnd-kit needs real pointer movement: press, move past the activation distance, then glide.
async function drag(page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>) {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 5 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 })
  await page.mouse.up()
}

test('create a deal from a contact page; it appears in the first stage', async ({ page }) => {
  await freshCompany(page, 'Affärskontakt AB')
  const company = await apiPost(page, '/companies', { name: 'Kundbolaget AB' })
  const contact = await apiPost(page, '/contacts', { firstName: 'Kim', lastName: 'Köpare', companyId: company.id })

  await page.goto(`/contacts/${contact.id}`)
  await page.getByRole('button', { name: 'Ny affär' }).click()
  await page.getByLabel('Namn', { exact: true }).fill('Ramavtal 2027')
  await page.getByLabel('Värde').fill('1 999,50')
  await page.getByRole('button', { name: 'Skapa', exact: true }).click()
  await expect(page.getByText('Affären är skapad')).toBeVisible()
  await expect(page.getByRole('link', { name: /Ramavtal 2027/ })).toBeVisible()

  await page.goto('/deals')
  const first = column(page, 'Ny lead')
  await expect(first.getByText('Ramavtal 2027')).toBeVisible()
  await expect(first.getByText('Kundbolaget AB')).toBeVisible()
  // 1 999,50 kr displays without rounding (Intl uses a non-breaking space).
  await expect(first.getByText(/1\s999,50\skr/).first()).toBeVisible()
})

test('drag a deal to another stage; it stays after refresh and the totals update', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Mouse drag; touch drag uses a long-press instead')
  await freshCompany(page, 'Dragtest AB')
  await apiPost(page, '/deals', { name: 'Flyttbar', value: 100_000_00 })
  await apiPost(page, '/deals', { name: 'Stannar', value: 50_000_00 })

  await page.goto('/deals')
  await expect(totals(page, 'Ny lead')).toContainText('2 affärer')
  await drag(page, column(page, 'Ny lead').getByText('Flyttbar'), column(page, 'Kvalificerad').getByText('Inga affärer'))
  await expect(column(page, 'Kvalificerad').getByText('Flyttbar')).toBeVisible()
  await expect(totals(page, 'Kvalificerad')).toContainText(/1 affär\s*100\s000\skr/)
  await expect(totals(page, 'Ny lead')).toContainText(/1 affär\s*50\s000\skr/)

  await page.reload()
  await expect(column(page, 'Kvalificerad').getByText('Flyttbar')).toBeVisible()
  await expect(column(page, 'Ny lead').getByText('Flyttbar')).toHaveCount(0)
})

test('moving with the stage bar records the history', async ({ page }) => {
  await freshCompany(page, 'Stegbar AB')
  const deal = await apiPost(page, '/deals', { name: 'Stegvis' })
  await page.goto(`/deals/${deal.id}`)
  await page.getByRole('button', { name: /Möte bokat/ }).click()
  await expect(page.getByText('Flyttad till Möte bokat')).toBeVisible()
  await expect(page.getByRole('button', { name: /Möte bokat/ })).toHaveAttribute('aria-current', 'step')
  const history = page.locator('[data-slot="card"]').filter({ has: page.getByRole('heading', { name: 'Steghistorik' }) })
  await expect(history.getByText('Möte bokat')).toBeVisible()
  await expect(history.getByText('Ny lead')).toBeVisible()
})

test('marking a deal lost requires a reason', async ({ page }) => {
  await freshCompany(page, 'Förlust AB')
  const deal = await apiPost(page, '/deals', { name: 'Tappad' })
  await page.goto(`/deals/${deal.id}`)
  await page.getByRole('button', { name: 'Förlorad' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Förlorad' })).toBeDisabled()
  await dialog.getByLabel('Anledning').selectOption({ label: 'Valde en konkurrent' })
  await dialog.getByRole('button', { name: 'Förlorad' }).click()
  await expect(page.getByText('Förlorad: Valde en konkurrent')).toBeVisible()
  await page.getByRole('button', { name: 'Öppna igen' }).click()
  await expect(page.getByText('Affären är öppen igen')).toBeVisible()
})

test('lost reasons are editable in settings', async ({ page }) => {
  await freshCompany(page, 'Listor AB')
  await page.goto('/settings/lists')
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Anledningar till förlorade affärer' }) })
  await section.getByRole('button', { name: 'Lägg till' }).click()
  await section.getByRole('textbox').last().fill('Valde att bygga själva')
  await section.getByRole('button', { name: 'Spara' }).click()
  await expect(page.getByText('Listan är sparad')).toBeVisible()

  const deal = await apiPost(page, '/deals', { name: 'Egen lösning' })
  await page.goto(`/deals/${deal.id}`)
  await page.getByRole('button', { name: 'Förlorad' }).click()
  await page.getByRole('dialog').getByLabel('Anledning').selectOption({ label: 'Valde att bygga själva' })
  await page.getByRole('dialog').getByRole('button', { name: 'Förlorad' }).click()
  await expect(page.getByText('Förlorad: Valde att bygga själva')).toBeVisible()
})

test('rename, add and reorder stages in settings', async ({ page }) => {
  await freshCompany(page, 'Stegredigering AB')
  await page.goto('/settings/pipelines')
  const names = page.getByLabel('Namn på steget')
  await names.first().fill('Inkommande')
  await page.getByRole('button', { name: 'Lägg till steg' }).click()
  await names.last().fill('Avtal skickat')
  await page.getByRole('button', { name: 'Flytta upp' }).last().click()
  await page.getByRole('button', { name: 'Spara steg' }).click()
  await expect(page.getByText('Stegen är sparade')).toBeVisible()

  const [pipeline] = await pipelinesOf(page)
  expect(pipeline!.stages.map((s) => s.name)).toEqual(['Inkommande', 'Kvalificerad', 'Möte bokat', 'Offert skickad', 'Avtal skickat', 'Förhandling'])
  await page.goto('/deals')
  await expect(column(page, 'Inkommande')).toBeVisible()
  await expect(column(page, 'Avtal skickat')).toBeVisible()
})

test('a second pipeline "Renewals" can be created and shown on the board', async ({ page }) => {
  await freshCompany(page, 'Förnyelse AB')
  await page.goto('/settings/pipelines')
  await page.getByLabel('Namn på pipelinen').first().fill('Försäljning')
  await page.getByPlaceholder('Ny pipeline').fill('Renewals')
  await page.getByRole('button', { name: 'Ny pipeline' }).click()
  await expect(page.getByLabel('Pipeline', { exact: true })).toContainText('Renewals')

  const renewals = (await pipelinesOf(page)).find((p) => p.stages.length && p.id)!
  const all = await pipelinesOf(page)
  const second = all.find((p) => p.id !== all[0]!.id)!
  await apiPost(page, '/deals', { name: 'Förnyelse 2027', pipelineId: second.id })
  expect(renewals).toBeDefined()

  await page.goto('/deals')
  await expect(page.getByText('Förnyelse 2027')).toHaveCount(0)
  await page.getByLabel('Pipeline').selectOption({ label: 'Renewals' })
  await expect(page.getByText('Förnyelse 2027')).toBeVisible()
})

test('a deal without activity for the stale period shows as stale', async ({ page }) => {
  await freshCompany(page, 'Inaktiv AB')
  await apiPost(page, '/deals', { name: 'Färsk affär' })
  await page.request.patch('/api/pipeline-settings', { data: { staleDays: 1 }, headers: { origin: 'http://localhost:5173' } })
  await page.goto('/deals')
  // A brand-new deal is not stale, even with a 1-day limit.
  await expect(page.getByText('Inaktiv', { exact: true })).toHaveCount(0)
})

test('the seeded stale deal in Acme shows as stale', async ({ page }) => {
  const { loginAs, users } = await import('./support/fixtures.ts')
  await loginAs(page, users.anna.email)
  await page.goto('/deals')
  const card = page.getByRole('button').filter({ hasText: 'Gammal offert' }).first()
  await expect(card.getByText('Inaktiv')).toBeVisible()
})
