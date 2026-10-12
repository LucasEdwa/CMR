import type { Browser, Page } from '@playwright/test'
import { BASE_ORIGIN, apiPost, expect, freshCompany, test, uniqueEmail } from './support/fixtures.ts'
import { linkFromEmail } from './support/mailpit.ts'

const stockholmDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date(Date.now() + offsetDays * 86_400_000))
const stockholmHour = () => Number(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit' }).format(new Date()))

// Invites a colleague into the owner's company and returns a logged-in page for them.
async function colleague(owner: Page, browser: Browser, name: string, role = 'member') {
  const email = uniqueEmail(name.toLowerCase())
  await apiPost(owner, '/workspace/invitations', { email, role })
  const token = (await linkFromEmail(email, '/invite/')).split('/invite/')[1]!
  const context = await browser.newContext({ locale: 'sv-SE', timezoneId: 'Europe/Stockholm', extraHTTPHeaders: { 'x-forwarded-for': `10.9.${Date.now() % 250}.${Math.floor(Math.random() * 250)}` } })
  const page = await context.newPage()
  const res = await page.request.post(`${BASE_ORIGIN}/api/invitations/${token}/accept`, {
    data: { name, password: 'Secret123!' },
    headers: { origin: BASE_ORIGIN },
  })
  expect(res.status(), await res.text()).toBe(200)
  const id = ((await (await page.request.get(`${BASE_ORIGIN}/api/me`)).json()) as { user: { id: string } }).user.id
  return { page, email, id, close: () => context.close() }
}

async function dealWithContactAndCompany(page: Page) {
  const company = await apiPost(page, '/companies', { name: 'Tidslinje AB' })
  const contact = await apiPost(page, '/contacts', { firstName: 'Åke', lastName: 'Öst', companyId: company.id })
  const deal = await apiPost(page, '/deals', { name: 'Serviceavtal', companyId: company.id, contactIds: [contact.id] })
  return { company, contact, deal }
}

test('a call logged on a deal shows on the deal, its contact and its company', async ({ page }) => {
  await freshCompany(page, 'Samtalstest AB')
  const { company, contact, deal } = await dealWithContactAndCompany(page)

  await page.goto(`/deals/${deal.id}`)
  await page.getByRole('tab', { name: 'Samtal' }).click()
  await page.getByLabel('Ämne').fill('Prisdiskussion')
  await page.getByLabel('Längd (minuter)').fill('15')
  await page.getByLabel('Resultat').selectOption('connected')
  await page.getByRole('textbox', { name: /Vad pratade ni om/ }).fill('De vill ha 10 % rabatt')
  await page.getByRole('button', { name: 'Logga samtal' }).click()
  await expect(page.getByText('Aktiviteten är sparad')).toBeVisible()

  const timeline = page.getByRole('list', { name: 'Aktiviteter' })
  await expect(timeline.getByText('· Prisdiskussion')).toBeVisible()
  await expect(timeline.getByText(/15 min · Fick svar/)).toBeVisible()
  await expect(timeline.getByText('De vill ha 10 % rabatt')).toBeVisible()

  for (const path of [`/contacts/${contact.id}`, `/companies/${company.id}`]) {
    await page.goto(path)
    const list = page.getByRole('list', { name: 'Aktiviteter' })
    await expect(list.getByText('· Prisdiskussion')).toBeVisible()
    await expect(list.getByRole('link', { name: 'Serviceavtal' })).toBeVisible()
  }
})

test('notes are rich text, can be pinned, filtered and deleted', async ({ page }) => {
  await freshCompany(page, 'Anteckningar AB')
  const contact = await apiPost(page, '/contacts', { firstName: 'Nora', lastName: 'Not' })
  await page.goto(`/contacts/${contact.id}`)

  const editor = page.getByRole('textbox', { name: /Skriv en anteckning/ })
  await editor.click()
  await page.getByRole('button', { name: 'Fetstil' }).click()
  await page.keyboard.type('Viktigt:')
  await page.getByRole('button', { name: 'Fetstil' }).click()
  await page.keyboard.type(' ring före fredag')
  await page.getByRole('button', { name: 'Spara anteckning' }).click()
  await expect(page.getByText('Aktiviteten är sparad')).toBeVisible()
  const timeline = page.getByRole('list', { name: 'Aktiviteter' })
  await expect(timeline.locator('strong', { hasText: 'Viktigt:' })).toBeVisible()

  await apiPost(page, '/activities', { type: 'meeting', record: { type: 'contact', id: contact.id }, subject: 'Lunch' })
  await page.reload()
  await expect(timeline.getByRole('listitem')).toHaveCount(2)
  // Newest first: the meeting is on top until the note is pinned.
  await expect(timeline.getByRole('listitem').first()).toContainText('Lunch')
  await timeline.getByRole('listitem').filter({ hasText: 'Viktigt' }).getByRole('button', { name: 'Åtgärder för aktivitet' }).click()
  await page.getByRole('menuitem', { name: 'Fäst överst' }).click()
  await expect(timeline.getByRole('listitem').first()).toContainText('Fäst')
  await expect(timeline.getByRole('listitem').first()).toContainText('Viktigt')

  await page.getByRole('button', { name: 'Möten' }).click()
  await expect(timeline.getByRole('listitem')).toHaveCount(1)
  await expect(timeline.getByRole('listitem')).toContainText('Lunch')
  await page.getByRole('button', { name: 'Möten' }).click()

  await timeline.getByRole('listitem').filter({ hasText: 'Lunch' }).getByRole('button', { name: 'Åtgärder för aktivitet' }).click()
  await page.getByRole('menuitem', { name: 'Ta bort' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Ta bort' }).click()
  await expect(timeline.getByRole('listitem')).toHaveCount(1)
})

test('a task due yesterday is overdue in My tasks; completing it moves it to done', async ({ page }) => {
  await freshCompany(page, 'Uppgiftstest AB')
  await apiPost(page, '/tasks', { title: 'Skicka avtal', dueDate: stockholmDate(-1) })
  await apiPost(page, '/tasks', { title: 'Boka demo', dueDate: stockholmDate(3) })

  await page.goto('/')
  await page.getByRole('navigation', { name: 'Meny' }).getByRole('link', { name: 'Uppgifter' }).or(page.getByRole('button', { name: 'Meny' })).first().click()
  if (await page.getByRole('dialog').isVisible()) await page.getByRole('dialog').getByRole('link', { name: 'Uppgifter' }).click()
  await expect(page.getByRole('heading', { name: 'Mina uppgifter' })).toBeVisible()

  const overdue = page.getByRole('list', { name: 'Försenade' })
  await expect(overdue.getByText('Skicka avtal')).toBeVisible()
  await expect(overdue.getByText(/Försenad/)).toBeAttached()
  await expect(page.getByRole('list', { name: 'Kommande' }).getByText('Boka demo')).toBeVisible()

  await page.getByRole('checkbox', { name: 'Markera "Skicka avtal" som klar' }).click()
  await expect(page.getByText('Uppgiften är klar')).toBeVisible()
  await expect(page.getByText('Inget försenat.')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Klara' }).getByText('Skicka avtal')).toBeVisible()
})

test('a task assigned to a colleague shows in their list, not mine, and notifies them', async ({ page, browser }) => {
  await freshCompany(page, 'Tilldelning AB')
  const erik = await colleague(page, browser, 'Erik')
  const contact = await apiPost(page, '/contacts', { firstName: 'Åsa', lastName: 'Kund' })

  await page.goto(`/contacts/${contact.id}`)
  await page.getByRole('button', { name: 'Ny uppgift' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Vad ska göras?').fill('Ring Åsa om offerten')
  await dialog.getByLabel('Ansvarig').selectOption({ label: 'Erik' })
  await dialog.getByRole('button', { name: 'Skapa' }).click()
  await expect(page.getByText('Uppgiften är skapad')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Öppna uppgifter' }).getByText('Ring Åsa om offerten')).toBeVisible()

  await page.goto('/tasks')
  await expect(page.getByText('Ring Åsa om offerten')).toHaveCount(0)

  await erik.page.goto(`${BASE_ORIGIN}/tasks`)
  await expect(erik.page.getByRole('list', { name: 'Idag' }).getByText('Ring Åsa om offerten')).toBeVisible()
  // After 08:00 the reminder for a task due today arrives at once, next to the assignment.
  await erik.page.getByRole('button', { name: /Aviseringar, \d+ olästa?/ }).click()
  await erik.page.getByRole('button', { name: /Olle Owner gav dig en uppgift/ }).click()
  await expect(erik.page).toHaveURL(new RegExp(`/contacts/${contact.id}`))
  await expect(erik.page.getByRole('button', { name: 'Aviseringar' })).toBeVisible()
  await erik.close()
})

test('@mentioning a colleague in a note notifies them with a link to the record', async ({ page, browser }) => {
  await freshCompany(page, 'Omnämnande AB')
  const erik = await colleague(page, browser, 'Erik')
  const { deal } = await dealWithContactAndCompany(page)

  await page.goto(`/deals/${deal.id}`)
  const editor = page.getByRole('textbox', { name: /Skriv en anteckning/ })
  await editor.click()
  await page.keyboard.type('Kan du ta detta, @Er')
  await page.getByRole('option', { name: 'Erik' }).click()
  await page.keyboard.type('?')
  await page.getByRole('button', { name: 'Spara anteckning' }).click()
  await expect(page.getByRole('list', { name: 'Aktiviteter' }).getByText('@Erik')).toBeVisible()

  await erik.page.goto(`${BASE_ORIGIN}/`)
  await erik.page.getByRole('button', { name: /Aviseringar, 1 oläst/ }).click()
  await erik.page.getByRole('button', { name: /Olle Owner nämnde dig på Serviceavtal/ }).click()
  await expect(erik.page).toHaveURL(new RegExp(`/deals/${deal.id}#activity-`))
  await expect(erik.page.getByRole('heading', { name: 'Serviceavtal' })).toBeVisible()
  await expect(erik.page.locator(':focus')).toContainText('Kan du ta detta')
  await erik.close()
})

test('the deal card shows the date of the next task', async ({ page }) => {
  await freshCompany(page, 'Nästa uppgift AB')
  const deal = await apiPost(page, '/deals', { name: 'Med uppgift' })
  await apiPost(page, '/deals', { name: 'Utan uppgift' })
  await apiPost(page, '/tasks', { title: 'Senare', dueDate: '2030-03-20', record: { type: 'deal', id: deal.id } })
  await apiPost(page, '/tasks', { title: 'Först', dueDate: '2030-03-14', dueTime: '10:00', record: { type: 'deal', id: deal.id } })

  await page.goto('/deals')
  const column = page.getByRole('region', { name: 'Ny lead' })
  await expect(column.getByText('Nästa: tors 14 mars 10:00')).toBeVisible()
  await expect(column.getByText('Ingen planerad uppgift')).toBeVisible()
})

test('the reminder email for a task due today arrives', async ({ page }) => {
  test.skip(stockholmHour() < 8, 'Before 08:00 the reminder is scheduled for 08:00 Stockholm time')
  const email = await freshCompany(page, 'Påminnelse AB')
  await apiPost(page, '/tasks', { title: 'Förnya avtalet', dueDate: stockholmDate(0) })
  expect(await linkFromEmail(email, '/tasks')).toBe('/tasks')
})
