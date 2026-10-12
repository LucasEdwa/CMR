import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { buildApp } from '../../app.js'
import { auditLog, contacts } from '../../db/schema.js'
import { withTenant, withTenantOnly } from '../../db/tenant.js'
import { purgeRecord } from '../../services/purge.js'
import { TestClient, addMember, createWorkspace, signUpVerified } from '../../test/client.js'

let app: FastifyInstance
beforeAll(async () => {
  app = await buildApp()
})
afterAll(() => app.close())

async function workspace(name = 'Kundtest AB') {
  const owner = new TestClient(app)
  await signUpVerified(owner, 'Olga Owner')
  const ws = await createWorkspace(owner, name)
  const ownerId = (await owner.get('/api/me')).json().user.id as string
  return { owner, ws, ownerId }
}

const createContact = async (client: TestClient, body: object) => {
  const res = await client.post('/api/contacts', body)
  if (res.statusCode !== 201) throw new Error(`create contact failed: ${res.body}`)
  return res.json()
}
const list = async (client: TestClient, query = '') => (await client.get(`/api/contacts${query}`)).json()

describe('contacts and companies', () => {
  it('creates 5 contacts and 2 companies and links them', async () => {
    const { owner } = await workspace()
    const acme = (await owner.post('/api/companies', { name: 'Acme AB', orgNumber: '5560360793', domain: 'acme.se' })).json()
    const nord = (await owner.post('/api/companies', { name: 'Nordbolaget AB' })).json()
    expect(acme.orgNumber).toBe('556036-0793')

    for (const [first, company] of [['Anna', acme], ['Bo', acme], ['Cecilia', acme], ['David', nord], ['Eva', null]] as const) {
      await createContact(owner, { firstName: first, lastName: 'Test', email: `${first.toLowerCase()}@example.se`, companyId: company?.id ?? null })
    }
    const all = await list(owner)
    expect(all.total).toBe(5)
    expect(all.items.find((c: { firstName: string }) => c.firstName === 'Anna').company).toEqual({ id: acme.id, name: 'Acme AB' })

    const company = (await owner.get(`/api/companies/${acme.id}`)).json()
    expect(company.contactCount).toBe(3)
    expect((await list(owner, `?companyId=${acme.id}`)).total).toBe(3)
  })

  it('sorts names in Swedish order (Å, Ä, Ö after Z)', async () => {
    const { owner } = await workspace()
    for (const lastName of ['Öberg', 'Andersson', 'Ängström', 'Zetterberg', 'Åberg']) {
      await createContact(owner, { firstName: 'X', lastName })
    }
    const order = (await list(owner)).items.map((c: { lastName: string }) => c.lastName)
    expect(order).toEqual(['Andersson', 'Zetterberg', 'Åberg', 'Ängström', 'Öberg'])
  })

  it('searches by name, email and phone digits', async () => {
    const { owner } = await workspace()
    await createContact(owner, { firstName: 'Åsa', lastName: 'Lindström', email: 'asa@lind.se', phone: '070-123 45 67' })
    await createContact(owner, { firstName: 'Per', lastName: 'Persson', email: 'per@persson.se' })

    const names = async (q: string) => (await list(owner, `?q=${encodeURIComponent(q)}`)).items.map((c: { firstName: string }) => c.firstName)
    expect(await names('lindstr')).toEqual(['Åsa'])
    expect(await names('PER@PERS')).toEqual(['Per'])
    expect(await names('0701234567')).toEqual(['Åsa'])
    expect(await names('100%')).toEqual([])
  })

  it('filters by owner and tag, sorts by created date', async () => {
    const { owner } = await workspace()
    const { userId: erikId } = await addMember(app, owner, 'member', 'Erik')
    await createContact(owner, { firstName: 'Först', tags: ['VIP'] })
    await createContact(owner, { firstName: 'Andra', ownerUserId: erikId, tags: ['vip', 'Norden'] })
    await createContact(owner, { firstName: 'Tredje', ownerUserId: null })

    const first = (q: string) => list(owner, q).then((r) => r.items.map((c: { firstName: string }) => c.firstName))
    expect(await first(`?owner=${erikId}`)).toEqual(['Andra'])
    expect(await first('?owner=me')).toEqual(['Först'])
    expect(await first('?owner=none')).toEqual(['Tredje'])
    expect((await first('?tag=vip')).sort()).toEqual(['Andra', 'Först'])
    expect(await first('?tag=Norden&owner=me')).toEqual([])
    expect(await first('?sort=createdAt&dir=desc')).toEqual(['Tredje', 'Andra', 'Först'])

    const tags = (await owner.get('/api/tags')).json()
    expect(tags.map((t: { name: string }) => t.name)).toEqual(['Norden', 'VIP'])
  })

  it('blocks a duplicate email in the same workspace but allows it in another', async () => {
    const a = await workspace('Acme Dublett AB')
    const b = await workspace('Beta Dublett AB')
    const first = await createContact(a.owner, { firstName: 'Anna', email: 'anna@dubbel.se' })

    const dup = await a.owner.post('/api/contacts', { firstName: 'Annan', email: 'ANNA@dubbel.se' })
    expect(dup.statusCode).toBe(409)
    expect(dup.json().error).toMatchObject({ code: 'duplicate_email', details: { contactId: first.id, name: 'Anna' } })

    expect((await b.owner.post('/api/contacts', { firstName: 'Anna', email: 'anna@dubbel.se' })).statusCode).toBe(201)
  })

  it('soft-deletes to Trash and restores with links intact', async () => {
    const { owner } = await workspace()
    const company = (await owner.post('/api/companies', { name: 'Länkat AB' })).json()
    const contact = await createContact(owner, { firstName: 'Tillfällig', companyId: company.id, tags: ['kund'] })

    expect((await owner.delete(`/api/contacts/${contact.id}`)).statusCode).toBe(200)
    expect((await list(owner)).total).toBe(0)
    expect((await owner.get(`/api/contacts/${contact.id}`)).statusCode).toBe(404)

    const trash = (await owner.get('/api/trash')).json()
    expect(trash).toEqual([expect.objectContaining({ type: 'contact', id: contact.id, name: 'Tillfällig', deletedBy: 'Olga Owner' })])

    const restored = (await owner.post(`/api/contacts/${contact.id}/restore`)).json()
    expect(restored).toMatchObject({ company: { id: company.id }, tags: ['kund'] })
    expect((await owner.get('/api/trash')).json()).toEqual([])
  })

  it('will not restore a contact whose email has been taken meanwhile', async () => {
    const { owner } = await workspace()
    const old = await createContact(owner, { firstName: 'Gammal', email: 'samma@epost.se' })
    await owner.delete(`/api/contacts/${old.id}`)
    await createContact(owner, { firstName: 'Ny', email: 'samma@epost.se' })
    const res = await owner.post(`/api/contacts/${old.id}/restore`)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('duplicate_email')
  })

  it('hides a deleted company on its contacts until it is restored', async () => {
    const { owner } = await workspace()
    const company = (await owner.post('/api/companies', { name: 'Försvinner AB' })).json()
    const contact = await createContact(owner, { firstName: 'Kvar', companyId: company.id })
    await owner.delete(`/api/companies/${company.id}`)
    expect((await owner.get(`/api/contacts/${contact.id}`)).json().company).toBeNull()
    await owner.post(`/api/companies/${company.id}/restore`)
    expect((await owner.get(`/api/contacts/${contact.id}`)).json().company).toEqual({ id: company.id, name: 'Försvinner AB' })
  })

  it('erases a record only after 30 days in Trash', async () => {
    const { owner, ws, ownerId } = await workspace()
    const contact = await createContact(owner, { firstName: 'Gammal' })
    await owner.delete(`/api/contacts/${contact.id}`)
    const job = { tenantId: ws.id, userId: ownerId, type: 'contact' as const, id: contact.id }

    expect(await withTenantOnly(ws.id, (tx) => purgeRecord(tx, job))).toBe(false)
    await withTenantOnly(ws.id, (tx) =>
      tx.update(contacts).set({ deletedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(contacts.id, contact.id)),
    )
    const ctx = { tenantId: ws.id, userId: ownerId, role: 'owner' as const }
    expect(await withTenant(ctx, (tx) => purgeRecord(tx, job))).toBe(true)
    const rows = await withTenantOnly(ws.id, (tx) => tx.select().from(contacts).where(eq(contacts.id, contact.id)))
    expect(rows).toHaveLength(0)
  })

  it('writes the audit log for create, update and delete with before and after', async () => {
    const { owner, ws } = await workspace()
    const contact = await createContact(owner, { firstName: 'Granskad', title: 'Säljare' })
    await owner.patch(`/api/contacts/${contact.id}`, { title: 'Säljchef', tags: ['ny'] })
    await owner.delete(`/api/contacts/${contact.id}`)

    const rows = await withTenantOnly(ws.id, (tx) => tx.select().from(auditLog).where(eq(auditLog.entityId, contact.id)))
    expect(rows.map((r) => r.action).sort()).toEqual(['create', 'delete', 'update'])
    expect(rows.find((r) => r.action === 'update')!.diff).toMatchObject({ title: ['Säljare', 'Säljchef'], tags: [[], ['ny']] })
  })

  it('records when consent changes', async () => {
    const { owner } = await workspace()
    const contact = await createContact(owner, { firstName: 'Samtycke' })
    expect(contact.consentUpdatedAt).toBeNull()
    const updated = (await owner.patch(`/api/contacts/${contact.id}`, { marketingConsent: true, consentBasis: 'consent' })).json()
    expect(updated.consentUpdatedAt).not.toBeNull()
  })
})

describe('companies', () => {
  it('rejects a wrong org number and blocks duplicates', async () => {
    const { owner } = await workspace()
    expect((await owner.post('/api/companies', { name: 'Fel AB', orgNumber: '556036-0794' })).statusCode).toBe(400)
    await owner.post('/api/companies', { name: 'Första AB', orgNumber: '556036-0793' })
    const dup = await owner.post('/api/companies', { name: 'Andra AB', orgNumber: '5560360793' })
    expect(dup.statusCode).toBe(409)
    expect(dup.json().error.details.name).toBe('Första AB')
  })

  it('suggests the company by email domain, never for webmail', async () => {
    const { owner } = await workspace()
    const company = (await owner.post('/api/companies', { name: 'Domän AB', domain: 'https://www.doman.se' })).json()
    expect((await owner.get('/api/companies/suggest?email=kim@doman.se')).json().company).toEqual({ id: company.id, name: 'Domän AB' })
    expect((await owner.get('/api/companies/suggest?email=kim@gmail.com')).json().company).toBeNull()
  })
})

describe('access', () => {
  it("another workspace sees nothing and gets 404 for a direct link", async () => {
    const acme = await workspace('Acme Isolering AB')
    const beta = await workspace('Beta Isolering AB')
    const contact = await createContact(acme.owner, { firstName: 'Hemlig' })
    const company = (await acme.owner.post('/api/companies', { name: 'Hemligt AB' })).json()

    expect((await list(beta.owner)).total).toBe(0)
    expect((await beta.owner.get(`/api/contacts/${contact.id}`)).statusCode).toBe(404)
    expect((await beta.owner.get(`/api/companies/${company.id}`)).statusCode).toBe(404)
    expect((await beta.owner.patch(`/api/contacts/${contact.id}`, { firstName: 'Hackad' })).statusCode).toBe(404)
    expect((await beta.owner.delete(`/api/contacts/${contact.id}`)).statusCode).toBe(404)
    // Linking Beta's contact to Acme's company is impossible.
    expect((await beta.owner.post('/api/contacts', { firstName: 'X', companyId: company.id })).statusCode).toBe(400)
  })

  it('viewers can read but not write', async () => {
    const { owner } = await workspace()
    const contact = await createContact(owner, { firstName: 'Läsbar' })
    const { client: vera } = await addMember(app, owner, 'viewer', 'Vera')
    expect((await vera.get(`/api/contacts/${contact.id}`)).statusCode).toBe(200)
    expect((await vera.post('/api/contacts', { firstName: 'Nej' })).statusCode).toBe(403)
    expect((await vera.patch(`/api/contacts/${contact.id}`, { firstName: 'Nej' })).statusCode).toBe(403)
    expect((await vera.delete(`/api/contacts/${contact.id}`)).statusCode).toBe(403)
  })

  it('only members of the workspace can own records', async () => {
    const acme = await workspace('Ägare A AB')
    const beta = await workspace('Ägare B AB')
    const res = await acme.owner.post('/api/contacts', { firstName: 'X', ownerUserId: beta.ownerId })
    expect(res.statusCode).toBe(400)
  })
})

describe('saved views', () => {
  it('private views are only visible to their owner; shared views to everyone, editable only by the owner', async () => {
    const { owner } = await workspace()
    const { client: erik } = await addMember(app, owner, 'member', 'Erik')
    const config = { query: { tag: 'vip', owner: 'me' }, columns: ['name', 'email'] }

    await owner.post('/api/saved-views', { object: 'contacts', name: 'Mina leads', config })
    const names = async (c: TestClient) =>
      (await c.get('/api/saved-views?object=contacts')).json().map((v: { name: string }) => v.name)
    expect(await names(owner)).toEqual(['Mina leads'])
    expect(await names(erik)).toEqual([])

    const shared = (await owner.post('/api/saved-views', { object: 'contacts', name: 'Alla VIP', shared: true, config })).json()
    expect(await names(erik)).toEqual(['Alla VIP'])
    expect((await erik.delete(`/api/saved-views/${shared.id}`)).statusCode).toBe(404)
    expect((await erik.patch(`/api/saved-views/${shared.id}`, { name: 'Kapad' })).statusCode).toBe(404)
    expect((await owner.patch(`/api/saved-views/${shared.id}`, { shared: false })).statusCode).toBe(200)
    expect(await names(erik)).toEqual([])
  })
})
