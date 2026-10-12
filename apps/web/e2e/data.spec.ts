import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { apiPost, colleague, expect, freshCompany, test } from './support/fixtures.ts'

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/samples/kontakter-500.csv')
const count = (page: Page, label: string) => page.getByRole('list', { name: 'Resultat' }).or(page.locator('dl[aria-label="Resultat"]')).locator('div', { hasText: label }).locator('dd')

async function importSample(page: Page) {
  await page.goto('/import?object=contacts')
  await page.getByLabel('CSV-fil').setInputFiles(SAMPLE)
  await expect(page.getByRole('heading', { name: /2\. Koppla kolumner \(500 rader/ })).toBeVisible()
  // Swedish headers are mapped automatically.
  await expect(page.getByLabel('Fält för kolumnen E-post')).toHaveValue('email')
  await expect(page.getByLabel('Fält för kolumnen Livscykel')).toHaveValue('lifecycleStage')
  await page.getByRole('button', { name: 'Importera 500 rader' }).click()
  await expect(page.getByRole('heading', { name: /Import klar/ })).toBeVisible({ timeout: 45_000 })
}

test('import 500 contacts with bad rows, re-import without duplicates, then undo', async ({ page }) => {
  test.setTimeout(120_000)
  await freshCompany(page, 'Importtest AB')
  await importSample(page)
  await expect(count(page, 'Nya')).toHaveText('491')
  await expect(count(page, 'Fel')).toHaveText('7')
  await expect(count(page, 'Hoppade över')).toHaveText('2')
  const errors = page.getByRole('table').filter({ hasText: 'Problem' })
  await expect(errors.getByText('Ogiltigt värde: E-post').first()).toBeVisible()
  await expect(errors.getByText('Förnamn saknas').first()).toBeVisible()
  await expect(errors.getByText('Ogiltigt värde: Livscykelfas').first()).toBeVisible()

  // The error report downloads as CSV with the original values.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Ladda ner felrapport' }).click()
  const report = await readFile(await (await download).path(), 'utf8')
  expect(report.startsWith('﻿Rad;Problem;Förnamn;Efternamn;E-post')).toBe(true)
  expect(report).toContain('inte-en-epost')

  await page.getByRole('button', { name: 'Importera en fil till' }).click()
  await importSample(page)
  await expect(count(page, 'Nya')).toHaveText('0')
  await expect(count(page, 'Hoppade över')).toHaveText('493')

  await page.goto('/contacts')
  await expect(page.getByText('491 träffar')).toBeVisible()

  // Undo the first import from the history.
  await page.goto('/import')
  await page.getByRole('button', { name: /kontakter-500\.csv/ }).last().click()
  await page.getByRole('button', { name: 'Ångra import' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Ångra import' }).click()
  await expect(page.getByText('Importen är ångrad').first()).toBeVisible()
  await page.goto('/contacts')
  await expect(page.getByRole('heading', { name: 'Inget här än' })).toBeVisible()
})

test('export a filtered list to an Excel-friendly CSV with å, ä and ö', async ({ page }) => {
  await freshCompany(page, 'Exporttest AB')
  await apiPost(page, '/contacts', { firstName: 'Åsa', lastName: 'Öberg', lifecycleStage: 'customer', city: 'Malmö' })
  await apiPost(page, '/contacts', { firstName: 'Björn', lastName: 'Ärlig', lifecycleStage: 'lead' })

  await page.goto('/contacts?stage=customer')
  await expect(page.getByText('Åsa Öberg').filter({ visible: true })).toBeVisible()
  await page.getByRole('button', { name: 'Fler åtgärder' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Exportera till CSV' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^kontakter-\d{4}-\d{2}-\d{2}\.csv$/)
  const csv = await readFile(await file.path(), 'utf8')
  const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n')
  expect(csv.charCodeAt(0)).toBe(0xfeff)
  expect(lines).toHaveLength(2)
  expect(lines[0]).toMatch(/^Förnamn;Efternamn;E-post;/)
  expect(lines[1]).toMatch(/^Åsa;Öberg;;.*;Kund;.*;Malmö;/)
})

test('Ctrl/Cmd+K finds a contact, a company and a deal, and remembers what I opened', async ({ page }) => {
  await freshCompany(page, 'Söktest AB')
  const company = await apiPost(page, '/companies', { name: 'Fjällräv Konsult AB' })
  await apiPost(page, '/contacts', { firstName: 'Fjällborg', lastName: 'Person' })
  await apiPost(page, '/deals', { name: 'Fjällprojekt', companyId: company.id })

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Sök' })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  const dialog = page.getByRole('dialog', { name: 'Sök i CRM' })
  await dialog.getByRole('combobox').fill('fjäll')
  await expect(dialog.getByRole('option', { name: /Fjällborg Person/ })).toBeVisible()
  await expect(dialog.getByRole('option', { name: /Fjällräv Konsult AB/ }).first()).toBeVisible()
  await expect(dialog.getByRole('option', { name: /Fjällprojekt/ })).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await dialog.getByRole('option', { name: /Fjällprojekt/ }).click()
  await expect(page.getByRole('heading', { name: 'Fjällprojekt' })).toBeVisible()

  await page.getByRole('button', { name: 'Sök' }).click()
  await expect(page.getByRole('dialog').getByRole('group', { name: 'Senast visade' }).getByRole('option', { name: /Fjällprojekt/ })).toBeVisible()
})

test('bulk reassign 20 contacts to Erik', async ({ page, browser }) => {
  await freshCompany(page, 'Bulktest AB')
  const erik = await colleague(page, browser, 'Erik')
  await erik.close()
  for (let i = 0; i < 25; i++) await apiPost(page, '/contacts', { firstName: `Kund${String(i).padStart(2, '0')}` })

  await page.goto('/contacts?pageSize=25')
  const boxes = page.getByRole('checkbox', { name: /^Välj Kund/ })
  await expect(boxes).toHaveCount(25)
  for (let i = 0; i < 20; i++) await boxes.nth(i).click()
  const bar = page.getByRole('region', { name: 'Åtgärder för valda' })
  await expect(bar.getByText('20 valda')).toBeVisible()
  await bar.getByLabel('Byt ägare…').selectOption({ label: 'Erik' })
  await expect(page.getByText('20 poster har fått ny ägare')).toBeVisible()

  await page.goto(`/contacts?owner=${erik.id}`)
  await expect(page.getByText('20 träffar')).toBeVisible()
})

test('merge two duplicate contacts; activities and deals from both end up on the survivor', async ({ page }) => {
  await freshCompany(page, 'Dubblett AB')
  const first = await apiPost(page, '/contacts', { firstName: 'Märta', lastName: 'Sjöberg', title: 'VD' })
  const second = await apiPost(page, '/contacts', { firstName: 'Märta', lastName: 'Sjöberg', email: 'marta@kund.se' })
  await apiPost(page, '/deals', { name: 'Affär ett', contactIds: [first.id] })
  await apiPost(page, '/deals', { name: 'Affär två', contactIds: [second.id] })
  await apiPost(page, '/activities', { type: 'call', record: { type: 'contact', id: first.id }, subject: 'Samtal ett' })
  await apiPost(page, '/activities', { type: 'call', record: { type: 'contact', id: second.id }, subject: 'Samtal två' })

  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Fler åtgärder' }).click()
  await page.getByRole('menuitem', { name: 'Dubbletter' }).click()
  await expect(page.getByText('Samma namn')).toBeVisible()
  await page.getByRole('button', { name: 'Slå ihop' }).click()
  const dialog = page.getByRole('dialog')
  // The survivor has no email: the merged contact's email is picked by default.
  await expect(dialog.getByRole('radio', { name: 'marta@kund.se' })).toBeChecked()
  await dialog.getByRole('button', { name: 'Slå ihop' }).click()
  await expect(page.getByText('Kontakterna är ihopslagna')).toBeVisible()
  await expect(page.getByText('Inga dubbletter')).toBeVisible()

  await page.goto(`/contacts/${first.id}`)
  await expect(page.getByText('marta@kund.se')).toBeVisible()
  await expect(page.getByRole('link', { name: /Affär ett/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Affär två/ })).toBeVisible()
  const timeline = page.getByRole('list', { name: 'Aktiviteter' })
  await expect(timeline.getByText('· Samtal ett')).toBeVisible()
  await expect(timeline.getByText('· Samtal två')).toBeVisible()
})
