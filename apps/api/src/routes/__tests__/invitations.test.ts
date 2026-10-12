import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { buildApp } from '../../app.js'
import { invitations } from '../../db/schema.js'
import { asSystemIn } from '../../test/factories.js'
import { TestClient, createWorkspace, lastLinkTo, signUpVerified, uniqueEmail } from '../../test/client.js'

let app: FastifyInstance
beforeAll(async () => {
  app = await buildApp()
})
afterAll(() => app.close())

const inviteToken = (email: string) => lastLinkTo(email).split('/invite/')[1]!

async function ownerWithWorkspace() {
  const owner = new TestClient(app)
  await signUpVerified(owner, 'Olga Owner')
  const ws = await createWorkspace(owner, 'Inbjudan AB')
  return { owner, ws }
}

describe('invitations', () => {
  it('invites a new person as Member; they accept in another browser and both see the workspace', async () => {
    const { owner, ws } = await ownerWithWorkspace()
    const email = uniqueEmail('invitee')
    expect((await owner.post('/api/workspace/invitations', { email, role: 'member' })).statusCode).toBe(201)

    const token = inviteToken(email)
    const guest = new TestClient(app)
    const preview = await guest.get(`/api/invitations/${token}`)
    expect(preview.json()).toMatchObject({ workspaceName: 'Inbjudan AB', email, role: 'member', invitedBy: 'Olga Owner', accountExists: false })

    const accept = await guest.post(`/api/invitations/${token}/accept`, { name: 'Ivar Invitee', password: 'Secret123!' })
    expect(accept.statusCode).toBe(200)

    const me = (await guest.get('/api/me')).json()
    expect(me.activeWorkspaceId).toBe(ws.id)
    expect(me.workspaces[0]).toMatchObject({ id: ws.id, role: 'member' })

    const members = (await owner.get('/api/workspace/members')).json()
    expect(members.map((m: { email: string }) => m.email)).toContain(email)
  })

  it('rejects a reused invitation link', async () => {
    const { owner } = await ownerWithWorkspace()
    const email = uniqueEmail('reuse')
    await owner.post('/api/workspace/invitations', { email, role: 'member' })
    const token = inviteToken(email)

    const first = new TestClient(app)
    expect((await first.post(`/api/invitations/${token}/accept`, { name: 'A', password: 'Secret123!' })).statusCode).toBe(200)

    const second = new TestClient(app)
    const again = await second.get(`/api/invitations/${token}`)
    expect(again.statusCode).toBe(410)
    expect(again.json().error.code).toBe('invitation_used')
  })

  it('rejects an expired invitation link', async () => {
    const { owner, ws } = await ownerWithWorkspace()
    const email = uniqueEmail('expired')
    const { id } = (await owner.post('/api/workspace/invitations', { email, role: 'member' })).json()
    await asSystemIn(ws.id, (tx) =>
      tx.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitations.id, id)),
    )
    const res = await new TestClient(app).get(`/api/invitations/${inviteToken(email)}`)
    expect(res.statusCode).toBe(410)
    expect(res.json().error.code).toBe('invitation_expired')
  })

  it('rejects a tampered link', async () => {
    const { ws } = await ownerWithWorkspace()
    const res = await new TestClient(app).get(`/api/invitations/${ws.id}.not-the-secret`)
    expect(res.statusCode).toBe(404)
  })

  it('requires login when the invited email already has an account, and checks it is the same person', async () => {
    const { owner, ws } = await ownerWithWorkspace()
    const existing = new TestClient(app)
    const { email, password } = await signUpVerified(existing)
    await existing.post('/api/auth/sign-out')
    await owner.post('/api/workspace/invitations', { email, role: 'admin' })
    const token = inviteToken(email)

    const loggedOut = await existing.post(`/api/invitations/${token}/accept`)
    expect(loggedOut.json().error.code).toBe('login_required')

    const someoneElse = new TestClient(app)
    await signUpVerified(someoneElse)
    expect((await someoneElse.post(`/api/invitations/${token}/accept`)).json().error.code).toBe('email_mismatch')

    await existing.login(email, password)
    expect((await existing.post(`/api/invitations/${token}/accept`)).statusCode).toBe(200)
    expect((await existing.get('/api/me')).json().workspaces).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: ws.id, role: 'admin' })]),
    )
  })

  it('does not invite someone who is already a member, and replaces a pending invite', async () => {
    const { owner } = await ownerWithWorkspace()
    const ownerEmail = (await owner.get('/api/me')).json().user.email
    expect((await owner.post('/api/workspace/invitations', { email: ownerEmail, role: 'member' })).statusCode).toBe(409)

    const email = uniqueEmail('twice')
    await owner.post('/api/workspace/invitations', { email, role: 'member' })
    const oldToken = inviteToken(email)
    await owner.post('/api/workspace/invitations', { email, role: 'admin' })
    expect((await new TestClient(app).get(`/api/invitations/${oldToken}`)).json().error.code).toBe('invitation_revoked')

    const pending = (await owner.get('/api/workspace/invitations')).json()
    expect(pending).toEqual([expect.objectContaining({ email, role: 'admin' })])
  })
})

describe('roles and membership', () => {
  async function teamOf(roles: Array<'admin' | 'member' | 'viewer'>) {
    const { owner, ws } = await ownerWithWorkspace()
    const people = []
    for (const role of roles) {
      const email = uniqueEmail(role)
      await owner.post('/api/workspace/invitations', { email, role })
      const client = new TestClient(app)
      await client.post(`/api/invitations/${inviteToken(email)}/accept`, { name: role, password: 'Secret123!' })
      const userId = (await client.get('/api/me')).json().user.id as string
      people.push({ role, client, userId })
    }
    return { owner, ws, people }
  }

  it('members and viewers cannot invite or change settings', async () => {
    const { people } = await teamOf(['member', 'viewer'])
    for (const { client } of people) {
      expect((await client.post('/api/workspace/invitations', { email: uniqueEmail(), role: 'member' })).statusCode).toBe(403)
      expect((await client.patch('/api/workspace', { name: 'Hacked AB' })).statusCode).toBe(403)
    }
  })

  it('admins manage members but not owners', async () => {
    const { people } = await teamOf(['admin', 'member'])
    const [admin, member] = people
    expect((await admin!.client.post('/api/workspace/invitations', { email: uniqueEmail(), role: 'owner' })).statusCode).toBe(403)
    expect((await admin!.client.patch(`/api/workspace/members/${member!.userId}`, { role: 'viewer' })).statusCode).toBe(200)
    expect((await admin!.client.patch(`/api/workspace/members/${member!.userId}`, { role: 'owner' })).statusCode).toBe(403)
  })

  it('never leaves a workspace without an owner', async () => {
    const { owner } = await teamOf([])
    const ownerId = (await owner.get('/api/me')).json().user.id
    expect((await owner.patch(`/api/workspace/members/${ownerId}`, { role: 'admin' })).json().error.code).toBe('last_owner')
    expect((await owner.delete(`/api/workspace/members/${ownerId}`)).json().error.code).toBe('last_owner')
  })

  it('a removed member loses access on their next request', async () => {
    const { owner, people } = await teamOf(['member'])
    const [erik] = people
    expect((await erik!.client.get('/api/workspace')).statusCode).toBe(200)

    expect((await owner.delete(`/api/workspace/members/${erik!.userId}`)).statusCode).toBe(200)

    const after = await erik!.client.get('/api/workspace')
    expect(after.statusCode).toBe(403)
    expect(after.json().error.code).toBe('no_workspace')
    expect((await erik!.client.get('/api/me')).json().workspaces).toEqual([])
  })
})
