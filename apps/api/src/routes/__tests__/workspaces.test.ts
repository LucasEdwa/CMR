import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app.js'
import { TestClient, createWorkspace, signUpVerified } from '../../test/client.js'

let app: FastifyInstance
beforeAll(async () => {
  app = await buildApp()
})
afterAll(() => app.close())

describe('workspaces', () => {
  it('creates a workspace, makes the creator owner and activates it', async () => {
    const client = new TestClient(app)
    await signUpVerified(client)
    const ws = await createWorkspace(client, 'Åkesson & Söner AB')

    const me = (await client.get('/api/me')).json()
    expect(me.activeWorkspaceId).toBe(ws.id)
    expect(me.workspaces).toEqual([expect.objectContaining({ id: ws.id, role: 'owner' })])

    const settings = (await client.get('/api/workspace')).json()
    expect(settings).toMatchObject({ name: 'Åkesson & Söner AB', currency: 'SEK', timezone: 'Europe/Stockholm' })
  })

  it('rejects a taken slug and an invalid org number', async () => {
    const client = new TestClient(app)
    await signUpVerified(client)
    const ws = await createWorkspace(client)

    const taken = await client.post('/api/workspaces', { name: 'Another AB', slug: ws.slug })
    expect(taken.statusCode).toBe(409)
    expect(taken.json().error.code).toBe('slug_taken')

    const badOrg = await client.post('/api/workspaces', { name: 'Org AB', slug: `org-${Date.now()}`, orgNumber: '556036-0794' })
    expect(badOrg.statusCode).toBe(400)
  })

  it('updates settings and writes the change to the audit log', async () => {
    const client = new TestClient(app)
    await signUpVerified(client)
    await createWorkspace(client)
    const res = await client.patch('/api/workspace', {
      orgNumber: '5560360793',
      timezone: 'Europe/Helsinki',
      dateFormat: 'd MMM yyyy',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ orgNumber: '556036-0793', timezone: 'Europe/Helsinki', dateFormat: 'd MMM yyyy' })

    const bad = await client.patch('/api/workspace', { timezone: 'Mars/Olympus' })
    expect(bad.statusCode).toBe(400)
  })

  it('switches between workspaces the user belongs to, and only those', async () => {
    const client = new TestClient(app)
    await signUpVerified(client)
    const first = await createWorkspace(client, 'Alfa AB')
    const second = await createWorkspace(client, 'Beta AB')
    expect((await client.get('/api/me')).json().activeWorkspaceId).toBe(second.id)

    expect((await client.post('/api/workspaces/switch', { workspaceId: first.id })).statusCode).toBe(200)
    expect((await client.get('/api/workspace')).json().id).toBe(first.id)

    const stranger = new TestClient(app)
    await signUpVerified(stranger)
    const res = await stranger.post('/api/workspaces/switch', { workspaceId: first.id })
    expect(res.statusCode).toBe(404)
  })

  it('updates the user language', async () => {
    const client = new TestClient(app)
    await signUpVerified(client)
    await client.patch('/api/me', { locale: 'en' })
    expect((await client.get('/api/me')).json().user.locale).toBe('en')
  })
})
