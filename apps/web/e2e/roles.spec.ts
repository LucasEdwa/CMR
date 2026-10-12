import type { Page } from '@playwright/test'
import { BASE_ORIGIN, apiPost, colleague, expect, freshCompany, test } from './support/fixtures.ts'

const call = (page: Page, method: 'POST' | 'PATCH' | 'DELETE' | 'GET', path: string, data: object = {}) =>
  page.request.fetch(`${BASE_ORIGIN}/api${path}`, { method, data: method === 'GET' ? undefined : data, headers: { origin: BASE_ORIGIN } })

test('the dashboard numbers match the deals, activities and tasks', async ({ page }) => {
  await freshCompany(page, 'Översikt AB')
  const { pipelines } = await (await page.request.get('/api/pipelines')).json()
  const [lead, qualified] = pipelines[0].stages
  await apiPost(page, '/deals', { name: 'Ett', value: 100_000_00, stageId: lead.id })
  await apiPost(page, '/deals', { name: 'Två', value: 40_000_00, stageId: qualified.id })
  const won = await apiPost(page, '/deals', { name: 'Vunnen', value: 25_000_00 })
  const lost = await apiPost(page, '/deals', { name: 'Förlorad', value: 5_000_00 })
  await page.request.post(`/api/deals/${won.id}/won`, { headers: { origin: BASE_ORIGIN } })
  await page.request.post(`/api/deals/${lost.id}/lost`, { data: { reason: 'price' }, headers: { origin: BASE_ORIGIN } })
  await apiPost(page, '/activities', { type: 'call', record: { type: 'deal', id: won.id }, subject: 'Avslut' })
  await apiPost(page, '/tasks', { title: 'Sen uppgift', dueDate: '2020-01-01' })

  await page.goto('/')
  const tile = (label: string) => page.locator('dl[aria-label="Nyckeltal"] > div').filter({ hasText: label })
  await expect(tile('Öppen pipeline')).toContainText(/140\s000\skr/)
  await expect(tile('Öppen pipeline')).toContainText('2 affärer')
  // 100 000 × 10 % + 40 000 × 25 %
  await expect(tile('Viktad pipeline')).toContainText(/20\s000\skr/)
  await expect(tile('Vunnet')).toContainText(/25\s000\skr/)
  await expect(tile('Förlorat')).toContainText(/5\s000\skr/)
  await expect(tile('Vinstfrekvens')).toContainText('50 %')
  await expect(page.getByRole('list', { name: 'Öppna affärer per steg' }).getByRole('listitem').first()).toContainText(/1 affär · 100\s000\skr/)
  await expect(page.getByRole('list', { name: 'Försenade uppgifter' })).toContainText('Sen uppgift')
  await expect(page.getByRole('table', { name: 'Aktiviteter per användare' }).getByRole('row', { name: /Olle Owner/ })).toContainText('1')
  await expect(page.getByText('Pris')).toBeVisible()
})

test('a member sees no settings or user management, and the API refuses them', async ({ page, browser }) => {
  await freshCompany(page, 'Medlem AB')
  const erik = await colleague(page, browser, 'Erik')
  await erik.page.goto(`${BASE_ORIGIN}/settings`)
  await expect(erik.page).toHaveURL(/\/settings\/profile$/)
  const tabs = erik.page.getByRole('navigation', { name: 'Inställningar' })
  await expect(tabs.getByRole('link')).toHaveText(['Min profil'])
  await erik.page.goto(`${BASE_ORIGIN}/settings/members`)
  await expect(erik.page).toHaveURL(/\/settings\/profile$/)

  expect((await call(erik.page, 'PATCH', '/workspace', { name: 'Kapat' })).status()).toBe(403)
  expect((await call(erik.page, 'POST', '/workspace/invitations', { email: 'x@e2e.test', role: 'admin' })).status()).toBe(403)
  expect((await call(erik.page, 'GET', '/audit')).status()).toBe(403)
  expect((await call(erik.page, 'POST', '/pipelines', { name: 'Egen' })).status()).toBe(403)
  await erik.close()
})

test('an admin manages users but cannot delete the workspace', async ({ page, browser }) => {
  const name = 'Admintest AB'
  await freshCompany(page, name)
  const adam = await colleague(page, browser, 'Adam', 'admin')
  await adam.page.goto(`${BASE_ORIGIN}/settings/members`)
  await expect(adam.page.getByRole('button', { name: 'Skicka inbjudan' })).toBeVisible()
  await adam.page.goto(`${BASE_ORIGIN}/settings`)
  await expect(adam.page.getByLabel('Namn')).toBeVisible()
  await expect(adam.page.getByRole('button', { name: 'Radera företaget…' })).toHaveCount(0)
  expect((await call(adam.page, 'DELETE', '/workspace', { confirm: name })).status()).toBe(403)

  // The owner can.
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Radera företaget…' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Radera för alltid' })).toBeDisabled()
  await dialog.getByLabel(`Skriv "${name}" för att bekräfta`).fill(name)
  await dialog.getByRole('button', { name: 'Radera för alltid' }).click()
  await expect(page.getByText(`${name} är raderat`)).toBeVisible()
  await adam.close()
})

test('"own records only": a member sees only their own contacts and deals', async ({ page, browser }) => {
  await freshCompany(page, 'Egna poster AB')
  const erik = await colleague(page, browser, 'Erik')
  await apiPost(page, '/contacts', { firstName: 'Ägarens', lastName: 'Kontakt' })
  await apiPost(page, '/deals', { name: 'Ägarens affär' })
  await apiPost(erik.page, '/contacts', { firstName: 'Eriks', lastName: 'Kontakt' })
  await apiPost(erik.page, '/deals', { name: 'Eriks affär' })

  await page.goto('/settings')
  await page.getByLabel('Medlemmar ser bara sina egna poster').check()
  await page.getByRole('button', { name: 'Spara' }).click()
  await expect(page.getByText('Sparat')).toBeVisible()

  await erik.page.goto(`${BASE_ORIGIN}/contacts`)
  await expect(erik.page.getByText('Eriks Kontakt').filter({ visible: true })).toBeVisible()
  await expect(erik.page.getByText('Ägarens Kontakt')).toHaveCount(0)
  await erik.page.goto(`${BASE_ORIGIN}/deals`)
  await expect(erik.page.getByText('Eriks affär')).toBeVisible()
  await expect(erik.page.getByText('Ägarens affär')).toHaveCount(0)

  await page.goto('/contacts')
  await expect(page.getByText('2 träffar')).toBeVisible()
  await erik.close()
})

test('editing a contact shows who changed what in the log, with before and after', async ({ page }) => {
  await freshCompany(page, 'Loggtest AB')
  const contact = await apiPost(page, '/contacts', { firstName: 'Åsa', lastName: 'Lind', title: 'Säljare' })
  await page.goto(`/contacts/${contact.id}`)
  await page.getByRole('button', { name: 'Redigera' }).click()
  await page.getByRole('dialog').getByLabel('Titel').fill('VD')
  await page.getByRole('dialog').getByRole('button', { name: 'Spara' }).click()
  await expect(page.getByText('VD', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Historik' }).click()
  await expect(page.getByText('Visar historiken för Åsa Lind')).toBeVisible()
  const entry = page.getByRole('listitem').filter({ hasText: 'ändrade' })
  await expect(entry).toContainText('Olle Owner')
  await expect(entry.getByRole('row', { name: /Titel/ })).toContainText('Säljare')
  await expect(entry.getByRole('row', { name: /Titel/ })).toContainText('VD')
})

test('a viewer cannot create or edit anything, in the UI or through the API', async ({ page, browser }) => {
  await freshCompany(page, 'Läsare AB')
  const vera = await colleague(page, browser, 'Vera', 'viewer')
  const contact = await apiPost(page, '/contacts', { firstName: 'Läsbar' })
  const deal = await apiPost(page, '/deals', { name: 'Läsbar affär', contactIds: [contact.id] })

  const v = vera.page
  await v.goto(`${BASE_ORIGIN}/contacts`)
  await expect(v.getByText('Läsbar').filter({ visible: true }).first()).toBeVisible()
  await expect(v.getByRole('button', { name: 'Ny kontakt' })).toHaveCount(0)
  await expect(v.getByRole('checkbox')).toHaveCount(0)
  await v.goto(`${BASE_ORIGIN}/contacts/${contact.id}`)
  await expect(v.getByRole('heading', { name: 'Läsbar' })).toBeVisible()
  await expect(v.getByRole('button', { name: 'Redigera' })).toHaveCount(0)
  await expect(v.getByRole('button', { name: 'Spara anteckning' })).toHaveCount(0)
  await expect(v.getByRole('button', { name: 'Ny uppgift' })).toHaveCount(0)
  await v.goto(`${BASE_ORIGIN}/deals/${deal.id}`)
  await expect(v.getByRole('heading', { name: 'Läsbar affär' })).toBeVisible()
  await expect(v.getByRole('button', { name: 'Vunnen' })).toHaveCount(0)
  await v.goto(`${BASE_ORIGIN}/deals`)
  await expect(v.getByRole('button', { name: 'Ny affär' })).toHaveCount(0)
  await v.goto(`${BASE_ORIGIN}/tasks`)
  await expect(v.getByRole('button', { name: 'Ny uppgift' })).toHaveCount(0)

  for (const [method, path, body] of [
    ['POST', '/contacts', { firstName: 'X' }],
    ['PATCH', `/contacts/${contact.id}`, { firstName: 'X' }],
    ['DELETE', `/contacts/${contact.id}`, {}],
    ['POST', '/deals', { name: 'X' }],
    ['POST', `/deals/${deal.id}/won`, {}],
    ['POST', '/tasks', { title: 'X', dueDate: '2030-01-01' }],
    ['POST', '/activities', { type: 'note', record: { type: 'contact', id: contact.id }, body: { type: 'doc', content: [] } }],
    ['POST', '/contacts/bulk', { action: 'delete', ids: [contact.id] }],
  ] as const) {
    expect((await call(v, method, path, body)).status(), `${method} ${path}`).toBe(403)
  }
  await vera.close()
})
