import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { plainToRichDoc, type AuditEntry, type Dashboard } from '@crm/shared'
import { buildApp } from '../../app.js'
import { deals } from '../../db/schema.js'
import { TestClient, addMember, createWorkspace, signUpVerified } from '../../test/client.js'
import { asSystemIn } from '../../test/factories.js'

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

async function setup(name = 'Adminbolaget AB') {
  const owner = new TestClient(app)
  await signUpVerified(owner, 'Olga Owner')
  const ws = await createWorkspace(owner, name)
  const ownerId = (await owner.get('/api/me')).json().user.id as string
  const { pipelines } = await ok(owner.get('/api/pipelines'))
  return { owner, ownerId, ws, stages: pipelines[0].stages as Array<{ id: string; name: string }> }
}

describe('dashboard', () => {
  it('adds up the pipeline, closed deals, activities and overdue tasks', async () => {
    const { owner, ws, stages } = await setup()
    const erik = await addMember(app, owner, 'member', 'Erik')
    const [lead, qualified] = stages
    await ok(owner.post('/api/deals', { name: 'A', value: 100_000_00, stageId: lead!.id }), 201)
    await ok(owner.post('/api/deals', { name: 'B', value: 50_000_00, stageId: qualified!.id }), 201)
    await ok(owner.post('/api/deals', { name: 'Euro', value: 1_000_00, currency: 'EUR', stageId: lead!.id }), 201)
    const eriks = await ok(erik.client.post('/api/deals', { name: 'C', value: 20_000_00, stageId: qualified!.id }), 201)
    const won = await ok(owner.post('/api/deals', { name: 'Vunnen', value: 30_000_00 }), 201)
    const lost = await ok(owner.post('/api/deals', { name: 'Förlorad', value: 10_000_00 }), 201)
    const lostOld = await ok(owner.post('/api/deals', { name: 'Förlorad i fjol', value: 99_00 }), 201)
    await ok(owner.post(`/api/deals/${won.id}/won`))
    await ok(owner.post(`/api/deals/${lost.id}/lost`, { reason: 'price' }))
    await ok(owner.post(`/api/deals/${lostOld.id}/lost`, { reason: 'timing' }))
    await asSystemIn(ws.id, (tx) => tx.update(deals).set({ closedAt: new Date('2020-01-15') }).where(eq(deals.id, lostOld.id)))
    await ok(owner.post('/api/activities', { type: 'call', record: { type: 'deal', id: won.id }, subject: 'Ring' }), 201)
    await ok(owner.post('/api/activities', { type: 'note', record: { type: 'deal', id: won.id }, body: plainToRichDoc('Bra') }), 201)
    await ok(erik.client.post('/api/activities', { type: 'meeting', record: { type: 'deal', id: eriks.id }, subject: 'Möte' }), 201)
    await ok(erik.client.post('/api/tasks', { title: 'Sen', dueDate: '2020-01-01' }), 201)
    await ok(owner.post('/api/tasks', { title: 'Inte sen', dueDate: '2099-01-01' }), 201)

    const d = (await ok(owner.get('/api/dashboard'))) as Dashboard
    expect(d.currency).toBe('SEK')
    expect(d.pipeline.stages[0]).toMatchObject({ name: 'Ny lead', count: 1, value: 100_000_00, weighted: 10_000_00 })
    expect(d.pipeline.stages[1]).toMatchObject({ name: 'Kvalificerad', count: 2, value: 70_000_00, weighted: 17_500_00 })
    expect(d.pipeline).toMatchObject({ count: 3, value: 170_000_00, weighted: 27_500_00, otherCurrencyCount: 1 })
    expect(d.won).toEqual({ count: 1, value: 30_000_00 })
    expect(d.lost).toEqual({ count: 1, value: 10_000_00 })
    expect(d.winRate).toBe(0.5)
    expect(d.lostReasons).toEqual([{ reason: 'price', count: 1 }])
    expect(d.activities.map((a) => [a.user.name, a.call, a.note, a.meeting, a.total])).toEqual([
      ['Olga Owner', 1, 1, 0, 2],
      ['Erik', 0, 0, 1, 1],
    ])
    expect(d.overdueTasks.count).toBe(1)
    expect(d.overdueTasks.items[0]).toMatchObject({ title: 'Sen', assignee: 'Erik' })

    // One person's numbers.
    const eriksView = (await ok(owner.get(`/api/dashboard?owner=${erik.userId}`))) as Dashboard
    expect(eriksView.pipeline).toMatchObject({ count: 1, value: 20_000_00 })
    expect(eriksView.won.count).toBe(0)
    expect(eriksView.activities.map((a) => a.user.name)).toEqual(['Erik'])
    expect((await ok(erik.client.get('/api/dashboard?owner=me'))).overdueTasks.count).toBe(1)

    // Last month has none of this month's closed deals.
    const last = (await ok(owner.get('/api/dashboard?period=last_month'))) as Dashboard
    expect(last.won.count).toBe(0)
    expect(last.winRate).toBeNull()
    expect(last.period.to).toBe(d.period.from)
  })
})

describe('own records only', () => {
  it('limits members and viewers to their own records once turned on', async () => {
    const { owner } = await setup()
    const erik = await addMember(app, owner, 'member', 'Erik')
    const vera = await addMember(app, owner, 'viewer', 'Vera')
    const mine = await ok(owner.post('/api/contacts', { firstName: 'Ägarens' }), 201)
    const his = await ok(erik.client.post('/api/contacts', { firstName: 'Eriks' }), 201)
    await ok(owner.post('/api/deals', { name: 'Ägarens affär' }), 201)
    await ok(erik.client.post('/api/deals', { name: 'Eriks affär' }), 201)

    expect((await ok(erik.client.get('/api/contacts'))).total).toBe(2)
    // Only owners and admins can change the setting.
    expect((await erik.client.patch('/api/workspace', { ownRecordsOnly: true })).statusCode).toBe(403)
    expect(await ok(owner.patch('/api/workspace', { ownRecordsOnly: true }))).toMatchObject({ ownRecordsOnly: true })

    const contacts = await ok(erik.client.get('/api/contacts'))
    expect(contacts.items.map((c: { id: string }) => c.id)).toEqual([his.id])
    expect((await erik.client.get(`/api/contacts/${mine.id}`)).statusCode).toBe(404)
    expect((await ok(erik.client.get('/api/deals'))).items.map((d: { name: string }) => d.name)).toEqual(['Eriks affär'])
    expect((await ok(erik.client.get(`/api/search?q=${encodeURIComponent('ägarens')}`))).hits).toEqual([])
    expect((await ok(vera.client.get('/api/contacts'))).total).toBe(0)
    expect((await ok(owner.get('/api/contacts'))).total).toBe(2)

    // Erik cannot hand a record to someone else (he would lose it), nor edit the owner's.
    expect((await erik.client.patch(`/api/contacts/${his.id}`, { ownerUserId: (await owner.get('/api/me')).json().user.id })).statusCode).toBe(403)
    expect((await erik.client.patch(`/api/contacts/${mine.id}`, { firstName: 'Kapad' })).statusCode).toBe(404)
  })
})

describe('audit log', () => {
  it('shows who changed what, with before and after, to owners and admins only', async () => {
    const { owner } = await setup()
    const adam = await addMember(app, owner, 'admin', 'Adam')
    const erik = await addMember(app, owner, 'member', 'Erik')
    const contact = await ok(erik.client.post('/api/contacts', { firstName: 'Åsa', lastName: 'Lind', title: 'Säljare' }), 201)
    await ok(erik.client.patch(`/api/contacts/${contact.id}`, { title: 'VD', lastName: 'Berg' }))

    const log = await ok(adam.client.get(`/api/audit?entityType=contact&entityId=${contact.id}`))
    expect(log.items.map((e: AuditEntry) => [e.action, e.actor, e.entityName])).toEqual([
      ['update', 'Erik', 'Åsa Berg'],
      ['create', 'Erik', 'Åsa Berg'],
    ])
    const update = log.items[0] as AuditEntry
    expect(update.changes).toEqual(
      expect.arrayContaining([
        { field: 'title', before: 'Säljare', after: 'VD' },
        { field: 'lastName', before: 'Lind', after: 'Berg' },
      ]),
    )
    expect(update.changes.map((c) => c.field)).not.toContain('searchText')

    const byErik = await ok(owner.get(`/api/audit?actor=${erik.userId}`))
    expect(byErik.items.every((e: AuditEntry) => e.actor === 'Erik')).toBe(true)
    const future = await ok(owner.get('/api/audit?from=2099-01-01'))
    expect(future.total).toBe(0)
    expect((await erik.client.get('/api/audit')).statusCode).toBe(403)
  })

  it('never shows invitation token hashes', async () => {
    const { owner } = await setup()
    await ok(owner.post('/api/workspace/invitations', { email: 'ny@test.local', role: 'member' }), 201)
    const log = await ok(owner.get('/api/audit?entityType=invitation'))
    expect(JSON.stringify(log)).not.toMatch(/tokenHash/)
  })
})

describe('people in several workspaces', () => {
  it('see, change and leave only the active workspace', async () => {
    const { owner, ws: first } = await setup('Första AB')
    const second = await createWorkspace(owner, 'Andra AB')
    const members = await ok(owner.get('/api/workspace/members'))
    expect(members).toHaveLength(1)
    // The last owner of the active workspace cannot leave it; the other workspace is not involved.
    const me = (await owner.get('/api/me')).json()
    expect(me.activeWorkspaceId).toBe(second.id)
    expect((await owner.delete(`/api/workspace/members/${me.user.id}`)).statusCode).toBe(409)
    await ok(owner.post('/api/workspaces/switch', { workspaceId: first.id }))
    expect(await ok(owner.get('/api/workspace/members'))).toHaveLength(1)
  })
})

describe('deleting the workspace', () => {
  it('needs the owner and the workspace name, then erases it', async () => {
    const { owner, ws } = await setup('Raderas AB')
    const adam = await addMember(app, owner, 'admin', 'Adam')
    await ok(owner.post('/api/contacts', { firstName: 'Borta' }), 201)
    expect((await adam.client.request('DELETE', '/api/workspace', { confirm: 'Raderas AB' })).statusCode).toBe(403)
    expect((await owner.request('DELETE', '/api/workspace', { confirm: 'Fel namn' })).statusCode).toBe(400)
    await ok(owner.request('DELETE', '/api/workspace', { confirm: 'raderas ab' }))

    const me = await ok(owner.get('/api/me'))
    expect(me.workspaces.map((w: { id: string }) => w.id)).not.toContain(ws.id)
    expect(me.activeWorkspaceId).toBeNull()
    expect((await adam.client.get('/api/contacts')).statusCode).toBe(403)
  })
})
