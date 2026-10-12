import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { buildApp } from '../../app.js'
import { db } from '../../db/client.js'
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

async function setup(name = 'Säkerhet AB') {
  const owner = new TestClient(app)
  const creds = await signUpVerified(owner, 'Olga Owner')
  const ws = await createWorkspace(owner, name)
  return { owner, ws, ...creds }
}

describe('limits', () => {
  it('limits exports per person, logs every export, and leaves colleagues unaffected', async () => {
    const { owner } = await setup()
    const erik = await addMember(app, owner, 'member', 'Erik')
    for (let i = 0; i < 20; i++) await ok(owner.get('/api/contacts/export?stage=customer'))
    const blocked = await owner.get('/api/contacts/export')
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json().error.code).toBe('rate_limited')
    await ok(erik.client.get('/api/contacts/export'))

    const log = await ok(owner.get('/api/audit?entityType=contacts'))
    const exports = log.items.filter((e: { action: string }) => e.action === 'export')
    expect(exports.length).toBeGreaterThanOrEqual(20)
    expect(exports[0].changes).toEqual(expect.arrayContaining([{ field: 'rows', before: null, after: 0 }]))
  })

  it('limits invitations per workspace, not per IP', async () => {
    const { owner } = await setup()
    const adam = await addMember(app, owner, 'admin', 'Adam')
    // addMember already sent one invitation.
    for (let i = 0; i < 29; i++) await ok(owner.post('/api/workspace/invitations', { email: `p${i}@test.local`, role: 'member' }), 201)
    // A second admin on another IP shares the workspace's budget.
    expect((await adam.client.post('/api/workspace/invitations', { email: 'over@test.local', role: 'member' })).statusCode).toBe(429)
  })

  it('stops any query after 15 seconds', async () => {
    const [row] = await db.execute<{ statement_timeout: string }>(sql`show statement_timeout`)
    expect(row!.statement_timeout).toBe('15s')
  })
})
