import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { parseMoney } from '@crm/shared'
import { buildApp } from '../../app.js'
import { deals } from '../../db/schema.js'
import { withTenantOnly } from '../../db/tenant.js'
import { TestClient, addMember, createWorkspace, signUpVerified } from '../../test/client.js'

let app: FastifyInstance
beforeAll(async () => {
  app = await buildApp()
})
afterAll(() => app.close())

async function workspace(name = 'Affärstest AB') {
  const owner = new TestClient(app)
  await signUpVerified(owner, 'Olga Owner')
  const ws = await createWorkspace(owner, name)
  const { pipelines } = (await owner.get('/api/pipelines')).json()
  return { owner, ws, pipeline: pipelines[0] as { id: string; stages: Array<{ id: string; name: string }> } }
}

const post = async (client: TestClient, url: string, body: object = {}, status = 200) => {
  const res = await client.post(url, body)
  if (res.statusCode !== status) throw new Error(`${url} -> ${res.statusCode}: ${res.body}`)
  return res.json()
}

describe('pipelines', () => {
  it('every workspace gets a default pipeline with five Swedish stages', async () => {
    const { owner } = await workspace()
    const { pipelines, staleDays } = (await owner.get('/api/pipelines')).json()
    expect(pipelines).toHaveLength(1)
    expect(pipelines[0].name).toBe('Försäljning')
    expect(pipelines[0].stages.map((s: { name: string }) => s.name)).toEqual(['Ny lead', 'Kvalificerad', 'Möte bokat', 'Offert skickad', 'Förhandling'])
    expect(staleDays).toBe(14)
  })

  it('renames, adds and reorders stages, and refuses to remove a stage that has deals', async () => {
    const { owner, pipeline } = await workspace()
    const [a, b, c, d, e] = pipeline.stages
    await post(owner, '/api/deals', { name: 'I Möte', stageId: c!.id }, 201)

    const res = await owner.request('PUT', `/api/pipelines/${pipeline.id}/stages`, {
      stages: [
        { id: b!.id, name: 'Kvalificerad', probability: 20 },
        { id: a!.id, name: 'Inkommande', probability: 5 },
        { id: c!.id, name: 'Möte', probability: 40 },
        { name: 'Demo', probability: 50 },
        { id: d!.id, name: 'Offert', probability: 60 },
        { id: e!.id, name: 'Förhandling', probability: 80 },
      ],
    })
    expect(res.statusCode).toBe(200)
    const after = (await owner.get('/api/pipelines')).json().pipelines[0].stages
    expect(after.map((s: { name: string }) => s.name)).toEqual(['Kvalificerad', 'Inkommande', 'Möte', 'Demo', 'Offert', 'Förhandling'])

    const blocked = await owner.request('PUT', `/api/pipelines/${pipeline.id}/stages`, {
      stages: after.filter((s: { id: string }) => s.id !== c!.id).map((s: { id: string; name: string; probability: number }) => s),
    })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error).toMatchObject({ code: 'stage_has_deals', details: { stage: 'Möte', count: 1 } })
  })

  it('creates a second pipeline and only deletes empty pipelines, never the last one', async () => {
    const { owner, pipeline } = await workspace()
    const { id } = await post(owner, '/api/pipelines', { name: 'Förnyelser' }, 201)
    expect((await owner.get('/api/pipelines')).json().pipelines.map((p: { name: string }) => p.name)).toEqual(['Försäljning', 'Förnyelser'])

    await post(owner, '/api/deals', { name: 'Avtal 2027', pipelineId: id }, 201)
    expect((await owner.delete(`/api/pipelines/${id}`)).json().error.code).toBe('pipeline_has_deals')

    const empty = await post(owner, '/api/pipelines', { name: 'Tom' }, 201)
    expect((await owner.delete(`/api/pipelines/${empty.id}`)).statusCode).toBe(200)

    const solo = await workspace('Ensam AB')
    expect((await solo.owner.delete(`/api/pipelines/${solo.pipeline.id}`)).json().error.code).toBe('last_pipeline')
    expect(pipeline.id).not.toBe(solo.pipeline.id)
  })

  it('members cannot change pipelines', async () => {
    const { owner, pipeline } = await workspace()
    const { client: erik } = await addMember(app, owner, 'member', 'Erik')
    expect((await erik.post('/api/pipelines', { name: 'Min' })).statusCode).toBe(403)
    expect((await erik.request('PUT', `/api/pipelines/${pipeline.id}/stages`, { stages: [{ name: 'X', probability: 1 }] })).statusCode).toBe(403)
  })
})

describe('deals', () => {
  it('a deal created from a contact lands in the first stage with the contact and company linked', async () => {
    const { owner, pipeline } = await workspace()
    const company = await post(owner, '/api/companies', { name: 'Kund AB' }, 201)
    const contact = await post(owner, '/api/contacts', { firstName: 'Klara', companyId: company.id }, 201)

    const deal = await post(owner, '/api/deals', { name: 'Licenser', value: parseMoney('1 999,50'), contactIds: [contact.id], companyId: company.id }, 201)
    expect(deal).toMatchObject({
      value: 199950,
      currency: 'SEK',
      status: 'open',
      stage: { id: pipeline.stages[0]!.id, name: 'Ny lead', probability: 10 },
      company: { id: company.id },
      contacts: [{ id: contact.id, name: 'Klara' }],
      owner: { name: 'Olga Owner' },
    })
    expect(deal.history).toEqual([expect.objectContaining({ stage: 'Ny lead', leftAt: null, by: 'Olga Owner' })])

    const forContact = (await owner.get(`/api/deals?contactId=${contact.id}`)).json()
    expect(forContact.items.map((d: { id: string }) => d.id)).toEqual([deal.id])
    expect((await owner.get(`/api/deals?companyId=${company.id}`)).json().total).toBe(1)
  })

  it('moving a deal records stage history and the board totals follow', async () => {
    const { owner, pipeline } = await workspace()
    const [first, second] = pipeline.stages
    const a = await post(owner, '/api/deals', { name: 'A', value: 100_000 }, 201)
    const b = await post(owner, '/api/deals', { name: 'B', value: 250_050 }, 201)
    await post(owner, '/api/deals', { name: 'Euro', value: 5_000, currency: 'EUR' }, 201)

    const moved = await post(owner, `/api/deals/${a.id}/move`, { stageId: second!.id })
    expect(moved.stage.id).toBe(second!.id)
    expect(moved.history.map((h: { stage: string; leftAt: string | null }) => [h.stage, h.leftAt === null])).toEqual([
      ['Ny lead', false],
      ['Kvalificerad', true],
    ])

    const board = (await owner.get(`/api/deals/board?pipelineId=${pipeline.id}`)).json()
    const col = (id: string) => board.columns.find((c: { stage: { id: string } }) => c.stage.id === id)
    expect(col(first!.id)).toMatchObject({ count: 2, totals: expect.arrayContaining([{ currency: 'SEK', sum: 250_050 }, { currency: 'EUR', sum: 5_000 }]) })
    expect(col(second!.id)).toMatchObject({ count: 1, totals: [{ currency: 'SEK', sum: 100_000 }] })

    // After "refresh" the deal is still there.
    expect((await owner.get(`/api/deals/${a.id}`)).json().stage.id).toBe(second!.id)
    expect(b.id).toBeDefined()
  })

  it('orders deals within a column by drop position', async () => {
    const { owner, pipeline } = await workspace()
    const stage = pipeline.stages[1]!.id
    const ids: string[] = []
    for (const name of ['Ett', 'Två', 'Tre']) {
      const d = await post(owner, '/api/deals', { name, stageId: stage }, 201)
      ids.push(d.id)
    }
    // New deals go on top: Tre, Två, Ett. Drop "Tre" between Två and Ett.
    await post(owner, `/api/deals/${ids[2]}/move`, { stageId: stage, index: 1 })
    const board = (await owner.get(`/api/deals/board?pipelineId=${pipeline.id}`)).json()
    const names = board.columns.find((c: { stage: { id: string } }) => c.stage.id === stage).deals.map((d: { name: string }) => d.name)
    expect(names).toEqual(['Två', 'Tre', 'Ett'])
  })

  it('marking a deal lost requires a reason from the list', async () => {
    const { owner } = await workspace()
    const deal = await post(owner, '/api/deals', { name: 'Förlorad' }, 201)
    expect((await owner.post(`/api/deals/${deal.id}/lost`, {})).statusCode).toBe(400)
    expect((await owner.post(`/api/deals/${deal.id}/lost`, { reason: 'made-up' })).statusCode).toBe(400)

    const lost = await post(owner, `/api/deals/${deal.id}/lost`, { reason: 'price', note: 'För dyrt i år' })
    expect(lost).toMatchObject({ status: 'lost', lostReason: 'price', lostNote: 'För dyrt i år' })
    expect(lost.closedAt).not.toBeNull()
    expect((await owner.post(`/api/deals/${deal.id}/move`, { stageId: lost.stage.id })).json().error.code).toBe('deal_closed')

    const reopened = await post(owner, `/api/deals/${deal.id}/reopen`)
    expect(reopened).toMatchObject({ status: 'open', lostReason: null, closedAt: null })
  })

  it('won deals leave the board but stay in the list', async () => {
    const { owner, pipeline } = await workspace()
    const deal = await post(owner, '/api/deals', { name: 'Vunnen' }, 201)
    await post(owner, `/api/deals/${deal.id}/won`)
    const board = (await owner.get(`/api/deals/board?pipelineId=${pipeline.id}`)).json()
    expect(board.columns.every((c: { count: number }) => c.count === 0)).toBe(true)
    expect((await owner.get('/api/deals?status=won')).json().items.map((d: { name: string }) => d.name)).toEqual(['Vunnen'])
  })

  it('a deal with no activity for the stale period is marked stale', async () => {
    const { owner, ws } = await workspace()
    const fresh = await post(owner, '/api/deals', { name: 'Färsk' }, 201)
    const old = await post(owner, '/api/deals', { name: 'Gammal' }, 201)
    await withTenantOnly(ws.id, (tx) =>
      tx.update(deals).set({ lastActivityAt: new Date(Date.now() - 20 * 86_400_000) }).where(eq(deals.id, old.id)),
    )
    expect((await owner.get(`/api/deals/${old.id}`)).json().stale).toBe(true)
    expect((await owner.get(`/api/deals/${fresh.id}`)).json().stale).toBe(false)

    await owner.patch('/api/pipeline-settings', { staleDays: 30 })
    expect((await owner.get(`/api/deals/${old.id}`)).json().stale).toBe(false)
  })

  it('soft-deletes deals to Trash and restores them', async () => {
    const { owner } = await workspace()
    const deal = await post(owner, '/api/deals', { name: 'Borta' }, 201)
    await owner.delete(`/api/deals/${deal.id}`)
    expect((await owner.get(`/api/deals/${deal.id}`)).statusCode).toBe(404)
    expect((await owner.get('/api/trash')).json()).toEqual([expect.objectContaining({ type: 'deal', name: 'Borta' })])
    expect((await owner.post(`/api/deals/${deal.id}/restore`)).statusCode).toBe(200)
  })

  it('values like 1 999,50 kr are stored exactly', async () => {
    const { owner } = await workspace()
    const deal = await post(owner, '/api/deals', { name: 'Exakt', value: parseMoney('1 999,50') }, 201)
    const updated = (await owner.patch(`/api/deals/${deal.id}`, { value: parseMoney('0,10')! + parseMoney('0,20')! })).json()
    expect(updated.value).toBe(30)
    expect((await owner.post('/api/deals', { name: 'Float', value: 19.995 })).statusCode).toBe(400)
  })
})

describe('access', () => {
  it('another workspace cannot see, move or link deals', async () => {
    const acme = await workspace('Acme Affär AB')
    const beta = await workspace('Beta Affär AB')
    const deal = await post(acme.owner, '/api/deals', { name: 'Hemlig affär' }, 201)
    expect((await beta.owner.get(`/api/deals/${deal.id}`)).statusCode).toBe(404)
    expect((await beta.owner.post(`/api/deals/${deal.id}/move`, { stageId: beta.pipeline.stages[1]!.id })).statusCode).toBe(404)
    expect((await beta.owner.get(`/api/deals/board?pipelineId=${acme.pipeline.id}`)).statusCode).toBe(404)
    // Beta's deal cannot be put in Acme's stage.
    expect((await beta.owner.post('/api/deals', { name: 'X', stageId: acme.pipeline.stages[0]!.id })).statusCode).toBe(400)
  })

  it('viewers can read deals but not change them', async () => {
    const { owner } = await workspace()
    const deal = await post(owner, '/api/deals', { name: 'Läs' }, 201)
    const { client: vera } = await addMember(app, owner, 'viewer', 'Vera')
    expect((await vera.get(`/api/deals/${deal.id}`)).statusCode).toBe(200)
    expect((await vera.post(`/api/deals/${deal.id}/won`)).statusCode).toBe(403)
    expect((await vera.post('/api/deals', { name: 'Nej' })).statusCode).toBe(403)
  })
})

describe('picklists', () => {
  it('starts with built-in values and can be edited by managers', async () => {
    const { owner } = await workspace()
    const lists = (await owner.get('/api/picklists')).json()
    expect(lists.lost_reason.map((i: { key: string }) => i.key)).toContain('price')

    const res = await owner.request('PUT', '/api/picklists/lost_reason', {
      items: [{ key: 'price', label: 'För dyrt' }, { label: 'Valde konkurrent X' }],
    })
    expect(res.statusCode).toBe(200)
    const after = (await owner.get('/api/picklists')).json().lost_reason
    expect(after).toEqual([{ key: 'price', label: 'För dyrt' }, { key: expect.stringMatching(/^valde-konkurrent-x-/), label: 'Valde konkurrent X' }])

    // The new reason can be used; the removed built-in one no longer can.
    const deal = await post(owner, '/api/deals', { name: 'X' }, 201)
    expect((await owner.post(`/api/deals/${deal.id}/lost`, { reason: 'timing' })).statusCode).toBe(400)
    expect((await owner.post(`/api/deals/${deal.id}/lost`, { reason: after[1].key })).statusCode).toBe(200)
  })
})
