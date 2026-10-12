import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { plainToRichDoc } from '@crm/shared'
import { buildApp } from '../../app.js'
import { TestClient, addMember, createWorkspace, signUpVerified } from '../../test/client.js'

// One generic attack on tenant isolation, over every route the app has: workspace B fills every
// kind of record with a secret marker, then workspace A calls every route with B's ids in every
// id slot and the marker as the search term. B's marker must never appear in a response, and
// B's data must be exactly the same afterwards.

let app: FastifyInstance
const MARKER = `hemlig${randomUUID().slice(0, 8)}`
const a = {} as { owner: TestClient }
const b = {} as { owner: TestClient; ids: Record<string, string>; token: string; snapshot: string }

const ok = async (promise: ReturnType<TestClient['get']>, status = 200) => {
  const res = await promise
  if (res.statusCode !== status) throw new Error(`${res.statusCode}: ${res.body}`)
  return res.json()
}

// Everything B can see, to compare before and after the attack.
async function snapshotOfB() {
  const get = (url: string) => ok(b.owner.get(url))
  const parts = await Promise.all([
    get('/api/contacts/export'),
    get('/api/companies/export'),
    get('/api/deals/export?status=open&status=won&status=lost'),
    get(`/api/deals/${b.ids.deal}`),
    get(`/api/timeline?type=deal&id=${b.ids.deal}`),
    get(`/api/tasks?type=deal&id=${b.ids.deal}`),
    get('/api/pipelines'),
    get('/api/picklists'),
    get('/api/saved-views?object=contacts'),
    get('/api/workspace'),
    get('/api/workspace/members'),
    get('/api/workspace/invitations'),
    get('/api/tags'),
    get('/api/imports'),
    get('/api/notifications'),
  ])
  // Volatile fields (stale markers, "now"-based durations) are not changes.
  return JSON.stringify(parts, (key, value) => (['duration', 'overdue', 'stale', 'expiresAt'].includes(key) ? undefined : value))
}

beforeAll(async () => {
  app = await buildApp()
  await app.ready()

  b.owner = new TestClient(app)
  await signUpVerified(b.owner, `Bo ${MARKER}`)
  await createWorkspace(b.owner, `B ${MARKER} AB`)
  const erik = await addMember(app, b.owner, 'member', `Erik ${MARKER}`)
  const company = await ok(b.owner.post('/api/companies', { name: `Företag ${MARKER}`, orgNumber: '556036-0793', tags: [`tagg${MARKER}`] }), 201)
  const contact = await ok(b.owner.post('/api/contacts', { firstName: MARKER, lastName: 'Kontakt', email: `${MARKER}@b.se`, companyId: company.id }), 201)
  const deal = await ok(b.owner.post('/api/deals', { name: `Affär ${MARKER}`, companyId: company.id, contactIds: [contact.id] }), 201)
  const activity = await ok(
    b.owner.post('/api/activities', {
      type: 'note',
      record: { type: 'deal', id: deal.id },
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Anteckning ${MARKER} ` }, { type: 'mention', attrs: { id: erik.userId, label: 'Erik' } }] }] },
    }),
    201,
  )
  const task = await ok(b.owner.post('/api/tasks', { title: `Uppgift ${MARKER}`, dueDate: '2030-01-01', assigneeUserId: erik.userId, record: { type: 'deal', id: deal.id } }), 201)
  const pipeline = await ok(b.owner.post('/api/pipelines', { name: `Pipeline ${MARKER}` }), 201)
  const view = await ok(b.owner.post('/api/saved-views', { object: 'contacts', name: `Vy ${MARKER}`, shared: true, config: { query: {}, columns: [] } }), 201)
  const invitation = await ok(b.owner.post('/api/workspace/invitations', { email: `inbjuden${MARKER}@b.se`, role: 'member' }), 201)
  const imp = await ok(b.owner.post('/api/imports', { object: 'contacts', fileName: `${MARKER}.csv`, csv: `Förnamn\nImporterad${MARKER}`, mapping: ['firstName'] }), 202)
  const trashed = await ok(b.owner.post('/api/contacts', { firstName: `Papperskorg${MARKER}` }), 201)
  await ok(b.owner.delete(`/api/contacts/${trashed.id}`))
  await ok(b.owner.post('/api/recent', { type: 'contact', id: contact.id }))
  const notification = (await ok(erik.client.get('/api/notifications'))).items[0]
  const { pipelines } = await ok(b.owner.get('/api/pipelines'))

  b.ids = {
    contact: contact.id,
    company: company.id,
    deal: deal.id,
    activity: activity.id,
    task: task.id,
    pipeline: pipeline.id,
    stage: pipelines[0].stages[0].id,
    view: view.id,
    invitation: invitation.id,
    import: imp.id,
    trashed: trashed.id,
    notification: notification.id,
    user: erik.userId,
  }
  b.token = `${(await ok(b.owner.get('/api/workspace'))).id}.not-the-secret`
  b.snapshot = await snapshotOfB()

  a.owner = new TestClient(app)
  await signUpVerified(a.owner, 'Angripare')
  await createWorkspace(a.owner, 'A AB')
})
afterAll(() => app.close())

// Plausible bodies, so write routes get past validation and reach the data layer.
function bodyFor(method: string, url: string): object {
  const ids = b.ids
  if (url.endsWith('/bulk')) return url.includes('contacts') ? { action: 'update', ids: [ids.contact, ids.trashed], changes: { lifecycleStage: 'customer' } } : { action: 'delete', ids: [ids.company, ids.deal] }
  if (url.endsWith('/merge')) return { survivorId: ids.contact, mergedId: ids.trashed, takeFromMerged: ['email'] }
  if (url.endsWith('/move')) return { stageId: ids.stage }
  if (url.endsWith('/lost')) return { reason: 'price' }
  if (url.endsWith('/stages')) return { stages: [{ id: ids.stage, name: 'Kapad', probability: 1 }] }
  if (url.includes('/workspace/members')) return { role: 'viewer' }
  if (url.endsWith('/recent')) return { type: 'contact', id: ids.contact }
  if (url.endsWith('/activities')) return { type: 'note', record: { type: 'deal', id: ids.deal }, body: plainToRichDoc('Intrång') }
  if (url.endsWith('/tasks')) return { title: 'Intrång', dueDate: '2030-01-01', record: { type: 'deal', id: ids.deal }, assigneeUserId: ids.user }
  if (url.endsWith('/deals')) return { name: 'Intrång', companyId: ids.company, contactIds: [ids.contact], stageId: ids.stage }
  if (url.endsWith('/contacts')) return { firstName: 'Intrång', companyId: ids.company }
  if (url.includes('/activities/')) return { pinned: true, body: plainToRichDoc('Ändrad') }
  if (url.includes('/tasks/')) return { completed: true, title: 'Ändrad' }
  if (url.includes('/pipelines/')) return { name: 'Kapad' }
  if (url.includes('/saved-views/')) return { name: 'Kapad', shared: false }
  if (method === 'PATCH') return { name: 'Kapad', firstName: 'Kapad', ownerUserId: ids.user }
  return {}
}

// Every way to fill a route's parameters with B's ids.
function urlsFor(url: string): string[] {
  const query = `q=${MARKER}&type=deal&id=${b.ids.deal}&contactId=${b.ids.contact}&companyId=${b.ids.company}&pipelineId=${b.ids.pipeline}&assignee=${b.ids.user}&owner=${b.ids.user}&entityId=${b.ids.contact}&email=${MARKER}@b.se&object=contacts`
  if (url.includes(':token')) return [url.replace(':token', b.token)]
  if (url.includes(':kind')) return [url.replace(':kind', 'lead_source')]
  if (!url.includes(':')) return [`${url}?${query}`]
  const param = /:([a-zA-Z]+)/.exec(url)![1]!
  const candidates: string[] = param === 'userId' ? [b.ids.user!] : Object.values(b.ids)
  return candidates.map((id) => url.replace(`:${param}`, id))
}

const SKIP = new Set(['OPTIONS *', 'GET /', 'GET /api/auth/*', 'POST /api/auth/*', 'POST /api/workspaces', 'POST /api/workspaces/switch', 'DELETE /api/workspace', 'PATCH /api/me'])

describe('cross-workspace attack over every route', () => {
  it("never returns or changes another workspace's data", async () => {
    const leaks: string[] = []
    const successes: string[] = []
    let calls = 0
    for (const { method, url } of app.routeList) {
      if (SKIP.has(`${method} ${url}`)) continue
      for (const target of urlsFor(url)) {
        const res = await a.owner.request(method as 'GET', target, method === 'GET' ? undefined : bodyFor(method, target))
        calls++
        if (res.body.includes(MARKER)) leaks.push(`${method} ${target} -> ${res.statusCode}: ${res.body.slice(0, 200)}`)
        // A write that "succeeded" on one of B's ids would be a hole even without echoing data.
        if (method !== 'GET' && res.statusCode < 300 && Object.values(b.ids).some((id) => target.split('?')[0]!.includes(id))) successes.push(`${method} ${target} -> ${res.statusCode}`)
      }
    }
    // Control: B's own data does carry the marker, so a leak would be visible.
    expect(b.snapshot).toContain(MARKER)
    expect(calls).toBeGreaterThan(400)
    expect(leaks).toEqual([])
    // Marking someone else's notification read, or leaving with someone else's id, must fail too.
    expect(successes).toEqual([])
    expect(await snapshotOfB()).toBe(b.snapshot)
  })

  it('A still works normally in its own workspace afterwards', async () => {
    const mine = await ok(a.owner.post('/api/contacts', { firstName: 'Egen' }), 201)
    expect((await ok(a.owner.get('/api/contacts'))).items.map((c: { id: string }) => c.id)).toContain(mine.id)
  })
})
