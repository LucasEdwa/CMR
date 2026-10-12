import { expect, apiPost, freshCompany, loginAs, test, users } from './support/fixtures.ts'

test('create contacts and companies, link them, and see them on the company page', async ({ page }) => {
  await freshCompany(page, 'Kontakttest AB')

  // A company through the UI…
  await page.goto('/companies')
  await page.getByRole('button', { name: 'Nytt företag' }).first().click()
  await page.getByLabel('Namn').fill('Fjällbacka Bygg AB')
  await page.getByLabel('Organisationsnummer').fill('5560360793')
  await page.getByLabel('Webbdomän').fill('fjallbacka.se')
  await page.getByRole('button', { name: 'Skapa', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Fjällbacka Bygg AB' })).toBeVisible()
  await expect(page.getByText('556036-0793').first()).toBeVisible()
  const companyUrl = page.url()

  // …and a contact through the UI, linked via the email-domain suggestion.
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Ny kontakt' }).first().click()
  await page.getByLabel('Förnamn').fill('Åsa')
  await page.getByLabel('Efternamn').fill('Lindström')
  await page.getByLabel('E-post').fill('asa@fjallbacka.se')
  await page.getByLabel('Titel').click()
  await page.getByRole('button', { name: 'Koppla', exact: true }).click()
  await page.getByRole('button', { name: 'Skapa', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Åsa Lindström' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Fjällbacka Bygg AB' })).toBeVisible()

  // The rest through the API: 5 contacts and 2 companies in total.
  const company = { id: companyUrl.split('/').pop()! }
  const other = await apiPost(page, '/companies', { name: 'Ödeshög Data AB' })
  await apiPost(page, '/contacts', { firstName: 'Bo', lastName: 'Ek', companyId: company.id })
  await apiPost(page, '/contacts', { firstName: 'Cia', lastName: 'Holm', companyId: company.id })
  await apiPost(page, '/contacts', { firstName: 'Dan', lastName: 'Ödman', companyId: other.id })
  await apiPost(page, '/contacts', { firstName: 'Eva', lastName: 'Utan' })

  await page.goto(companyUrl)
  await expect(page.getByRole('heading', { name: 'Kontakter (3)' })).toBeVisible()
  await page.goto('/contacts')
  await expect(page.getByText('5 träffar')).toBeVisible()
})

test('search by name and email finds the right contact', async ({ page }) => {
  await freshCompany(page, 'Söktest AB')
  await apiPost(page, '/contacts', { firstName: 'Märta', lastName: 'Sjöberg', email: 'marta@sjo.se' })
  await apiPost(page, '/contacts', { firstName: 'Nils', lastName: 'Holm', email: 'nils@holm.se' })
  await page.goto('/contacts')

  const search = page.getByRole('searchbox', { name: 'Sök' })
  await search.fill('sjöb')
  await expect(page.getByText('1 träff')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Märta Sjöberg' }).first()).toBeVisible()

  await search.fill('nils@holm')
  await expect(page.getByText('1 träff')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Nils Holm' }).first()).toBeVisible()
})

test('filter by owner and tag, sort by created date', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Column sorting is a desktop table feature')
  await freshCompany(page, 'Filtertest AB')
  await apiPost(page, '/contacts', { firstName: 'Först', tags: ['VIP'] })
  await apiPost(page, '/contacts', { firstName: 'Andra', ownerUserId: null, tags: ['VIP'] })
  await apiPost(page, '/contacts', { firstName: 'Tredje' })
  await page.goto('/contacts')
  await expect(page.getByText('3 träffar')).toBeVisible()

  await page.getByRole('button', { name: /Filter/ }).click()
  await page.getByLabel('Ägare').selectOption({ label: 'Jag' })
  await page.getByLabel('Taggar').selectOption('VIP')
  await page.keyboard.press('Escape')
  await expect(page.getByText('1 träff')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Först' })).toBeVisible()

  await page.goto('/contacts?cols=name,createdAt')
  await page.getByRole('button', { name: 'Skapad' }).click()
  await expect(page).toHaveURL(/sort=createdAt&dir=asc/)
  await page.getByRole('button', { name: 'Skapad' }).click()
  await expect(page).toHaveURL(/sort=createdAt&dir=desc/)
  // The row link holds the name (the first cell can be the selection checkbox).
  await expect(page.locator('tbody tr td a')).toHaveText(['Tredje', 'Andra', 'Först'])
})

test('a duplicate email is blocked in the same company but allowed in another', async ({ page, browser }) => {
  await freshCompany(page, 'Dubletter AB')
  const email = `dubbel-${Date.now()}@test.se`
  await apiPost(page, '/contacts', { firstName: 'Original', email })

  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Ny kontakt' }).first().click()
  await page.getByLabel('Förnamn').fill('Kopia')
  await page.getByLabel('E-post').fill(email.toUpperCase())
  await page.getByRole('button', { name: 'Skapa', exact: true }).click()
  await expect(page.getByText('Det finns redan en kontakt med den e-postadressen: Original.')).toBeVisible()
  await page.getByRole('link', { name: 'Öppna befintlig' }).click()
  await expect(page.getByRole('heading', { name: 'Original' })).toBeVisible()

  const other = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.8.7' } })
  const beta = await other.newPage()
  await loginAs(beta, users.sara.email)
  await apiPost(beta, '/contacts', { firstName: 'Samma', email })
  await other.close()
})

test('delete a contact, then restore it from Trash with its links intact', async ({ page }) => {
  await freshCompany(page, 'Papperskorg AB')
  const company = await apiPost(page, '/companies', { name: 'Länkat AB' })
  const contact = await apiPost(page, '/contacts', { firstName: 'Tove', lastName: 'Tillfällig', companyId: company.id, tags: ['kund'] })

  await page.goto(`/contacts/${contact.id}`)
  await page.getByRole('button', { name: 'Ta bort' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Ta bort' }).click()
  await expect(page).toHaveURL(/\/contacts$/)
  await expect(page.getByText('Inget här än')).toBeVisible()

  await page.goto('/trash')
  await page.getByRole('listitem').filter({ hasText: 'Tove Tillfällig' }).getByRole('button', { name: 'Återställ' }).click()
  await expect(page.getByText('Tove Tillfällig är återställd')).toBeVisible()
  await expect(page.getByText('Papperskorgen är tom.')).toBeVisible()

  await page.goto(`/contacts/${contact.id}`)
  await expect(page.getByRole('link', { name: 'Länkat AB' })).toBeVisible()
  await expect(page.getByText('kund')).toBeVisible()
})

test('isolation: Beta cannot see Acme contacts, and a direct link shows "not found"', async ({ page, browser }) => {
  await loginAs(page, users.anna.email)
  await page.goto('/contacts')
  const firstLink = page.locator('a[href^="/contacts/"]').first()
  const href = (await firstLink.getAttribute('href'))!
  const acmeName = (await firstLink.textContent())!.trim()

  const other = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.8.6' } })
  const sara = await other.newPage()
  await loginAs(sara, users.sara.email)
  await sara.goto('/contacts')
  await expect(sara.getByRole('button', { name: 'Byt företag' })).toContainText('Beta AB')
  await expect(sara.getByRole('link', { name: acmeName })).toHaveCount(0)
  await sara.goto(href)
  await expect(sara.getByRole('heading', { name: 'Hittades inte' })).toBeVisible()
  await other.close()
})

test('a saved view survives a reload and is visible to colleagues only when shared', async ({ page, browser }) => {
  const viewName = `Mina leads ${Date.now()}`
  await loginAs(page, users.anna.email)
  await page.goto('/contacts?stage=lead&owner=me')
  await page.getByRole('button', { name: /Vyer/ }).click()
  await page.getByRole('menuitem', { name: 'Spara vy…' }).click()
  await page.getByLabel('Namn på vyn').fill(viewName)
  await page.getByRole('button', { name: 'Spara', exact: true }).click()
  await expect(page.getByRole('button', { name: viewName })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: viewName })).toBeVisible()

  const other = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.8.5' } })
  const erik = await other.newPage()
  await loginAs(erik, users.erik.email)
  await erik.goto('/contacts')
  await erik.getByRole('button', { name: /Vyer/ }).click()
  await expect(erik.getByRole('menuitem', { name: new RegExp(viewName) })).toHaveCount(0)
  await erik.keyboard.press('Escape')

  // Share it: Anna re-saves the view as shared through the API.
  const views = await (await page.request.get('/api/saved-views?object=contacts')).json()
  const view = views.find((v: { name: string }) => v.name === viewName)
  await page.request.patch(`/api/saved-views/${view.id}`, { data: { shared: true }, headers: { origin: 'http://localhost:5173' } })

  await erik.reload()
  await erik.getByRole('button', { name: /Vyer/ }).click()
  await expect(erik.getByRole('menuitem', { name: new RegExp(viewName) })).toBeVisible()
  await other.close()

  // Clean up so the seed workspace does not collect test views.
  await page.request.delete(`/api/saved-views/${view.id}`, { headers: { origin: 'http://localhost:5173' } })
})

test('lists, detail pages and the board have no horizontal page scroll on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await loginAs(page, users.anna.email)
  const deals = await (await page.request.get('/api/deals?status=open&pageSize=25')).json()
  const contacts = await (await page.request.get('/api/contacts?pageSize=25')).json()
  for (const path of ['/contacts', '/companies', '/deals', `/deals/${deals.items[0].id}`, `/contacts/${contacts.items[0].id}`, '/settings/pipelines', '/tasks', '/import', '/contacts/duplicates']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(overflow, path).toBe(false)
  }
})
