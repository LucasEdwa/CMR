import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { plainToRichDoc, type Contact, type ImportDetail } from '@crm/shared'
import { buildApp } from '../../app.js'
import { TestClient, addMember, createWorkspace, signUpVerified } from '../../test/client.js'

let app: FastifyInstance
beforeAll(async () => {
  app = await buildApp()
})
afterAll(() => app.close())

const ok = async (promise: ReturnType<TestClient['get']>, status = 200) => {
  const res = await promise
  if (res.statusCode !== status) throw new Error(`${res.statusCode}: ${res.body}`)
  return res.json()
}

async function setup(name = 'Datatest AB') {
  const owner = new TestClient(app)
  const { email } = await signUpVerified(owner, 'Olga Owner')
  await createWorkspace(owner, name)
  const ownerId = (await owner.get('/api/me')).json().user.id as string
  return { owner, ownerId, ownerEmail: email }
}

// Imports run inline in tests (no worker), so the result is ready when the request returns.
async function runImport(client: TestClient, body: object) {
  const { id } = await ok(client.post('/api/imports', { fileName: 'test.csv', mode: 'skip', ...body }), 202)
  return (await ok(client.get(`/api/imports/${id}`))) as ImportDetail
}

const contactsCsv = (ownerEmail: string) =>
  [
    'Förnamn;Efternamn;E-post;Företag;Livscykel;Taggar;Ägare',
    `Åsa;Öberg;asa@kund.se;Kundbolaget AB;Kund;VIP, Norden;${ownerEmail}`,
    'Björn;Ek;bjorn@kund.se;Kundbolaget AB;Lead;;',
    ';Utan förnamn;nofirst@kund.se;;;;',
    'Dålig;Adress;inte-en-adress;;;;',
    'Okänd;Ägare;okand@kund.se;;;;nobody@nowhere.se',
    'Åsa;Dubblett;ASA@kund.se;;;;',
    'Märta;Lind;marta@annat.se;Annat AB;Påhittad fas;;',
  ].join('\r\n')
const contactMapping = ['firstName', 'lastName', 'email', 'company', 'lifecycleStage', 'tags', 'owner']

const contactsNamed = async (client: TestClient, q: string) =>
  (await ok(client.get(`/api/contacts?q=${encodeURIComponent(q)}`))).items as Contact[]

describe('import', () => {
  it('imports good rows, reports bad rows, and creates no duplicates the second time', async () => {
    const { owner, ownerEmail } = await setup()
    const result = await runImport(owner, { object: 'contacts', csv: contactsCsv(ownerEmail), mapping: contactMapping })
    expect(result).toMatchObject({ status: 'done', total: 7, processed: 7, created: 2, skipped: 1, failed: 4 })
    expect(result.errors.map((e) => [e.row, e.field, e.code])).toEqual([
      [3, 'firstName', 'required'],
      [4, 'email', 'invalid'],
      [5, 'owner', 'not_found'],
      [6, null, 'duplicate_in_file'],
      [7, 'lifecycleStage', 'invalid'],
    ])
    expect(result.errors[1]!.values).toEqual(['Dålig', 'Adress', 'inte-en-adress', '', '', '', ''])

    const [asa] = await contactsNamed(owner, 'asa@kund.se')
    expect(asa).toMatchObject({ firstName: 'Åsa', lifecycleStage: 'customer', tags: ['Norden', 'VIP'], company: { name: 'Kundbolaget AB' }, owner: { name: 'Olga Owner' } })
    const companies = (await ok(owner.get('/api/companies?q=kundbolaget'))).items
    expect(companies).toHaveLength(1)

    const again = await runImport(owner, { object: 'contacts', csv: contactsCsv(ownerEmail), mapping: contactMapping })
    expect(again).toMatchObject({ created: 0, skipped: 3, failed: 4 })
    expect((await ok(owner.get('/api/contacts'))).total).toBe(2)
    expect((await ok(owner.get('/api/companies'))).total).toBe(1)
  })

  it('update mode fills in values on existing contacts, and undo puts them back', async () => {
    const { owner } = await setup()
    const existing = await ok(owner.post('/api/contacts', { firstName: 'Åsa', lastName: 'Gammal', email: 'asa@kund.se', title: 'VD' }), 201)
    const csv = 'Förnamn;E-post;Efternamn;Mobil\r\nÅsa;asa@kund.se;Ny;070-123 45 67\r\nNy;ny@kund.se;Person;'
    const result = await runImport(owner, { object: 'contacts', csv, mapping: ['firstName', 'email', 'lastName', 'mobilePhone'], mode: 'update' })
    expect(result).toMatchObject({ updated: 1, created: 1, failed: 0 })
    const updated = (await ok(owner.get(`/api/contacts/${existing.id}`))) as Contact
    expect(updated).toMatchObject({ lastName: 'Ny', mobilePhone: '070-123 45 67', title: 'VD', firstName: 'Åsa' })

    await ok(owner.post(`/api/imports/${result.id}/undo`))
    expect(await ok(owner.get(`/api/contacts/${existing.id}`))).toMatchObject({ lastName: 'Gammal', mobilePhone: null, title: 'VD' })
    expect((await ok(owner.get('/api/contacts'))).total).toBe(1)
  })

  it('undo erases everything the import created, including new companies, but keeps older records', async () => {
    const { owner, ownerEmail } = await setup()
    const older = await ok(owner.post('/api/contacts', { firstName: 'Kvar', email: 'kvar@kund.se' }), 201)
    const result = await runImport(owner, { object: 'contacts', csv: contactsCsv(ownerEmail), mapping: contactMapping })
    const imported = (await contactsNamed(owner, 'asa@kund.se'))[0]!
    await ok(owner.post('/api/activities', { type: 'note', record: { type: 'contact', id: imported.id }, body: plainToRichDoc('Ringde') }), 201)
    // Moved under an imported company after the import: survives, without the company.
    await ok(owner.patch(`/api/contacts/${older.id}`, { companyId: imported.company!.id }))

    const undone = await ok(owner.post(`/api/imports/${result.id}/undo`))
    expect(undone).toMatchObject({ status: 'undone' })
    expect(undone.undoneAt).toBeTruthy()
    const left = (await ok(owner.get('/api/contacts'))).items as Contact[]
    expect(left.map((c) => c.email)).toEqual(['kvar@kund.se'])
    expect(left[0]!.company).toBeNull()
    expect((await ok(owner.get('/api/companies'))).total).toBe(0)
    expect((await owner.post(`/api/imports/${result.id}/undo`)).statusCode).toBe(409)
  })

  it('imports a webshop customer export: billing, terms, private customers and contact persons', async () => {
    const { owner } = await setup()
    const header = 'name;org_number;fortnox_customer_number;contact_email;contact_phone;contact_person;company_street;company_postal_code;company_city;invoice_street;invoice_postal_code;invoice_city;invoice_email;payment_term;is_credit_approved;credit_limit;discount;discount_rental;notes;id;updated_by'
    const csv = [
      header,
      'Bygg AB;556036-0793;20605;Info@bygg.se;\t+46 736566043;Anna Ek;Gatan 1;12458;Bandhagen;Box 44;12421;BANDHAGEN;faktura@bygg.se;30;true;0.00;0.00;20;"Rad ett\nRad två";a7ef5fed-799b-4191-ab6c-898f626199db;',
      'Anders Högblom;1000000334;1000000334;anders@bank.se;;Anders Högblom;\t-;\t-;\t-;;;;;10;false;;0.00;;;df643a6d-5960-4e5f-80c5-fbae6326a5ab;',
    ].join('\r\n')
    const mapping = ['name', 'orgNumber', 'fortnoxCustomerNumber', 'email', 'phone', 'contactName', 'street', 'postalCode', 'city', 'invoiceStreet', 'invoicePostalCode', 'invoiceCity', 'invoiceEmail', 'paymentTermDays', 'creditApproved', 'creditLimit', 'discount', 'discountRental', 'notes', null, null]
    const first = await runImport(owner, { object: 'companies', csv, mapping })
    expect(first).toMatchObject({ created: 2, failed: 0 })
    expect(first.errors.map((e) => [e.row, e.code])).toEqual([[2, 'imported_as_private']])

    const { items } = await ok(owner.get('/api/companies?sort=name'))
    const [privat, bygg] = items
    expect(bygg).toMatchObject({
      customerType: 'company', orgNumber: '556036-0793', fortnoxCustomerNumber: '20605', email: 'info@bygg.se', phone: '+46 736566043',
      street: 'Gatan 1', invoiceStreet: 'Box 44', invoiceCity: 'BANDHAGEN', invoiceEmail: 'faktura@bygg.se',
      paymentTermDays: 30, creditApproved: true, creditLimit: 0, discount: 0, discountRental: 20, notes: 'Rad ett\nRad två', contactCount: 1,
    })
    expect(privat).toMatchObject({ name: 'Anders Högblom', customerType: 'private', orgNumber: null, street: null, city: null, paymentTermDays: 10, contactCount: 0 })
    // The contact person gets the row's phone, but not the company's shared info@ mailbox.
    expect((await contactsNamed(owner, 'anna ek'))[0]).toMatchObject({ firstName: 'Anna', lastName: 'Ek', email: null, phone: '+46 736566043', company: { id: bygg.id } })
    // Searchable by Fortnox customer number.
    expect((await ok(owner.get('/api/companies?q=20605'))).items).toHaveLength(1)

    // A private customer has no org number, so the Fortnox number recognises it the second time.
    const again = await runImport(owner, { object: 'companies', csv: csv.replace(';10;false;', ';30;false;'), mapping, mode: 'update' })
    expect(again).toMatchObject({ created: 0, updated: 2 })
    expect((await ok(owner.get(`/api/companies/${privat.id}`))).paymentTermDays).toBe(30)
    expect(await contactsNamed(owner, 'anna ek')).toHaveLength(1)

    await ok(owner.post(`/api/imports/${first.id}/undo`, {}))
    expect((await ok(owner.get('/api/companies'))).total).toBe(0)
    expect(await contactsNamed(owner, 'anna ek')).toHaveLength(0)
  })

  it('dedupes companies by org number and imports deals into named stages', async () => {
    const { owner } = await setup()
    const companies = await runImport(owner, {
      object: 'companies',
      csv: 'Namn,Organisationsnummer,Webbplats,Anställda\nByggbolaget AB,556036-0793,https://www.bygg.se/,120\nSamma AB,5560360793,,\nTrasigt AB,123,,',
      mapping: ['name', 'orgNumber', 'domain', 'size'],
    })
    // An org number that is not one makes the row a private customer instead of failing it.
    expect(companies).toMatchObject({ created: 2, skipped: 1, failed: 0 })
    expect(companies.errors.map((e) => e.code)).toEqual(['duplicate_in_file', 'imported_as_private'])
    const [bygg] = (await ok(owner.get('/api/companies?q=byggbolaget'))).items
    expect(bygg).toMatchObject({ name: 'Byggbolaget AB', orgNumber: '556036-0793', domain: 'bygg.se', size: '50-249' })

    const deals = await runImport(owner, {
      object: 'deals',
      csv: 'Affär;Värde;Steg;Företag;Status\nLicenser;1 999,50;Offert skickad;byggbolaget ab;\nAvslutad;100;Ny lead;Byggbolaget AB;Vunnen\nFel steg;0;Påhittat;;',
      mapping: ['name', 'value', 'stage', 'company', 'status'],
    })
    expect(deals).toMatchObject({ created: 2, failed: 1 })
    expect(deals.errors[0]).toMatchObject({ row: 3, field: 'stage', code: 'not_found' })
    const list = (await ok(owner.get('/api/deals?sort=name&dir=asc'))).items
    expect(list.map((d: { name: string; value: number; stage: { name: string }; status: string; company: { name: string } }) => [d.name, d.value, d.stage.name, d.status, d.company.name])).toEqual([
      ['Avslutad', 10000, 'Ny lead', 'won', 'Byggbolaget AB'],
      ['Licenser', 199950, 'Offert skickad', 'open', 'Byggbolaget AB'],
    ])
  })

  it('refuses files without the required columns, and viewers cannot import', async () => {
    const { owner } = await setup()
    const res = await owner.post('/api/imports', { object: 'contacts', fileName: 'x.csv', csv: 'E-post\na@b.se', mapping: ['email'] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: 'import_missing_fields', details: { fields: ['firstName'] } })
    const viewer = await addMember(app, owner, 'viewer', 'Vera')
    expect((await viewer.client.post('/api/imports', { object: 'contacts', fileName: 'x.csv', csv: 'Förnamn\nA', mapping: ['firstName'] })).statusCode).toBe(403)
  })

  it("only shows a workspace's own imports", async () => {
    const a = await setup()
    const b = await setup()
    const result = await runImport(a.owner, { object: 'contacts', csv: 'Förnamn\nAnna', mapping: ['firstName'] })
    expect((await ok(b.owner.get('/api/imports'))).map((i: { id: string }) => i.id)).not.toContain(result.id)
    expect((await b.owner.get(`/api/imports/${result.id}`)).statusCode).toBe(404)
    expect((await b.owner.post(`/api/imports/${result.id}/undo`)).statusCode).toBe(404)
  })
})

describe('export', () => {
  it('returns every record matching the filters, beyond one page', async () => {
    const { owner } = await setup()
    const rows = Array.from({ length: 120 }, (_, i) => `Person${i};${i % 2 ? 'customer' : 'lead'}`)
    await runImport(owner, { object: 'contacts', csv: ['Förnamn;Livscykel', ...rows].join('\n'), mapping: ['firstName', 'lifecycleStage'] })
    const all = await ok(owner.get('/api/contacts/export'))
    expect(all).toMatchObject({ total: 120, truncated: false })
    expect(all.items).toHaveLength(120)
    const customers = await ok(owner.get('/api/contacts/export?stage=customer&sort=name'))
    expect(customers.items).toHaveLength(60)
    expect(customers.items.every((c: Contact) => c.lifecycleStage === 'customer')).toBe(true)
  })
})

describe('search and recently viewed', () => {
  it('finds contacts, companies and deals of the own workspace only', async () => {
    const a = await setup()
    const b = await setup()
    const company = await ok(a.owner.post('/api/companies', { name: 'Sökbar Fastighet AB' }), 201)
    await ok(a.owner.post('/api/contacts', { firstName: 'Sökbar', lastName: 'Person', companyId: company.id }), 201)
    await ok(a.owner.post('/api/deals', { name: 'Sökbar affär' }), 201)
    await ok(b.owner.post('/api/contacts', { firstName: 'Sökbar', lastName: 'Hemlig' }), 201)

    const { hits } = await ok(a.owner.get(`/api/search?q=${encodeURIComponent('sökbar')}`))
    expect(hits.map((h: { type: string; name: string }) => `${h.type}:${h.name}`).sort()).toEqual([
      'company:Sökbar Fastighet AB',
      'contact:Sökbar Person',
      'deal:Sökbar affär',
    ])
    expect(hits.find((h: { type: string }) => h.type === 'contact').detail).toBe('Sökbar Fastighet AB')
  })

  it('lists my recently viewed records, newest first, without other people’s or deleted ones', async () => {
    const { owner } = await setup()
    const erik = await addMember(app, owner, 'member', 'Erik')
    const c1 = await ok(owner.post('/api/contacts', { firstName: 'Först' }), 201)
    const c2 = await ok(owner.post('/api/contacts', { firstName: 'Sedan' }), 201)
    await ok(owner.post('/api/recent', { type: 'contact', id: c1.id }))
    await ok(owner.post('/api/recent', { type: 'contact', id: c2.id }))
    await ok(owner.post('/api/recent', { type: 'contact', id: c1.id }))
    expect((await ok(owner.get('/api/recent'))).hits.map((h: { name: string }) => h.name)).toEqual(['Först', 'Sedan'])
    expect((await ok(erik.client.get('/api/recent'))).hits).toEqual([])
    await ok(owner.delete(`/api/contacts/${c1.id}`))
    expect((await ok(owner.get('/api/recent'))).hits.map((h: { name: string }) => h.name)).toEqual(['Sedan'])
  })
})

describe('bulk actions', () => {
  it('reassigns 20 contacts to a colleague, and deletes in bulk', async () => {
    const { owner } = await setup()
    const erik = await addMember(app, owner, 'member', 'Erik')
    await runImport(owner, { object: 'contacts', csv: ['Förnamn', ...Array.from({ length: 25 }, (_, i) => `K${i}`)].join('\n'), mapping: ['firstName'] })
    const all = (await ok(owner.get('/api/contacts?pageSize=25'))).items as Contact[]
    const twenty = all.slice(0, 20).map((c) => c.id)

    expect(await ok(owner.post('/api/contacts/bulk', { action: 'update', ids: twenty, changes: { ownerUserId: erik.userId, addTags: ['Flyttad'] } }))).toEqual({ count: 20 })
    const mine = await ok(owner.get(`/api/contacts?owner=${erik.userId}&pageSize=50`))
    expect(mine.total).toBe(20)
    expect(mine.items.every((c: Contact) => c.tags.includes('Flyttad'))).toBe(true)

    expect(await ok(owner.post('/api/contacts/bulk', { action: 'delete', ids: all.slice(20).map((c) => c.id) }))).toEqual({ count: 5 })
    expect((await ok(owner.get('/api/contacts'))).total).toBe(20)
    expect((await ok(owner.get('/api/trash'))).length).toBe(5)
  })

  it('refuses owners outside the workspace and viewers', async () => {
    const { owner } = await setup()
    const viewer = await addMember(app, owner, 'viewer', 'Vera')
    const c = await ok(owner.post('/api/contacts', { firstName: 'X' }), 201)
    const outsider = new TestClient(app)
    await signUpVerified(outsider)
    const outsiderId = (await outsider.get('/api/me')).json().user.id
    expect((await owner.post('/api/contacts/bulk', { action: 'update', ids: [c.id], changes: { ownerUserId: outsiderId } })).statusCode).toBe(400)
    expect((await viewer.client.post('/api/contacts/bulk', { action: 'delete', ids: [c.id] })).statusCode).toBe(403)
  })

  it("ignores another workspace's ids", async () => {
    const a = await setup()
    const b = await setup()
    const theirs = await ok(b.owner.post('/api/deals', { name: 'Deras' }), 201)
    expect(await ok(a.owner.post('/api/deals/bulk', { action: 'delete', ids: [theirs.id] }))).toEqual({ count: 0 })
    expect((await b.owner.get(`/api/deals/${theirs.id}`)).statusCode).toBe(200)
  })
})

describe('duplicates and merge', () => {
  it('finds contacts with the same name or phone', async () => {
    const { owner } = await setup()
    await ok(owner.post('/api/contacts', { firstName: 'Åsa', lastName: 'Lind', email: 'asa@a.se' }), 201)
    await ok(owner.post('/api/contacts', { firstName: 'åsa', lastName: 'LIND', email: 'asa@b.se' }), 201)
    await ok(owner.post('/api/contacts', { firstName: 'Per', lastName: 'Ek', mobilePhone: '070-123 45 67' }), 201)
    await ok(owner.post('/api/contacts', { firstName: 'Petter', lastName: 'Ek', phone: '0701234567' }), 201)
    await ok(owner.post('/api/contacts', { firstName: 'Ensam', lastName: 'Person' }), 201)
    const { groups } = await ok(owner.get('/api/contacts/duplicates'))
    expect(groups.map((g: { reason: string; contacts: Array<{ name: string }> }) => [g.reason, g.contacts.map((c) => c.name)])).toEqual(
      expect.arrayContaining([
        ['name', ['Åsa Lind', 'åsa LIND']],
        ['phone', ['Per Ek', 'Petter Ek']],
      ]),
    )
    expect(groups).toHaveLength(2)
  })

  it('merges two contacts: deals, activities, tasks and tags end up on the survivor', async () => {
    const { owner } = await setup()
    const keep = await ok(owner.post('/api/contacts', { firstName: 'Åsa', lastName: 'Lind', title: 'VD', tags: ['VIP'] }), 201)
    const drop = await ok(owner.post('/api/contacts', { firstName: 'Åsa', lastName: 'Lind', email: 'asa@kund.se', mobilePhone: '070-1', tags: ['Norden'] }), 201)
    const deal = await ok(owner.post('/api/deals', { name: 'Från dubbletten', contactIds: [drop.id] }), 201)
    await ok(owner.post('/api/deals', { name: 'Båda', contactIds: [keep.id, drop.id] }), 201)
    await ok(owner.post('/api/activities', { type: 'note', record: { type: 'contact', id: drop.id }, body: plainToRichDoc('Anteckning på dubbletten') }), 201)
    await ok(owner.post('/api/activities', { type: 'note', record: { type: 'contact', id: keep.id }, body: plainToRichDoc('Anteckning på originalet') }), 201)
    await ok(owner.post('/api/tasks', { title: 'Ring', dueDate: '2030-01-01', record: { type: 'contact', id: drop.id } }), 201)

    const merged = await ok(owner.post('/api/contacts/merge', { survivorId: keep.id, mergedId: drop.id, takeFromMerged: ['email', 'mobilePhone'] }))
    expect(merged).toMatchObject({ id: keep.id, email: 'asa@kund.se', mobilePhone: '070-1', title: 'VD', tags: ['Norden', 'VIP'] })
    expect((await owner.get(`/api/contacts/${drop.id}`)).statusCode).toBe(404)

    const deals = (await ok(owner.get(`/api/deals?contactId=${keep.id}`))).items
    expect(deals.map((d: { name: string }) => d.name).sort()).toEqual(['Båda', 'Från dubbletten'])
    expect((await ok(owner.get(`/api/deals/${deal.id}`))).contacts).toEqual([{ id: keep.id, name: 'Åsa Lind' }])
    const timeline = await ok(owner.get(`/api/timeline?type=contact&id=${keep.id}`))
    expect(timeline.items).toHaveLength(2)
    expect((await ok(owner.get(`/api/tasks?type=contact&id=${keep.id}`))).open.map((t: { title: string }) => t.title)).toEqual(['Ring'])
  })

  it('refuses to merge a contact with itself or across workspaces', async () => {
    const a = await setup()
    const b = await setup()
    const mine = await ok(a.owner.post('/api/contacts', { firstName: 'A' }), 201)
    const theirs = await ok(b.owner.post('/api/contacts', { firstName: 'B' }), 201)
    expect((await a.owner.post('/api/contacts/merge', { survivorId: mine.id, mergedId: mine.id })).statusCode).toBe(400)
    expect((await a.owner.post('/api/contacts/merge', { survivorId: mine.id, mergedId: theirs.id })).statusCode).toBe(404)
    expect((await b.owner.get(`/api/contacts/${theirs.id}`)).statusCode).toBe(200)
  })
})
