import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { buildApp } from '../../app.js'
import { db } from '../../db/client.js'
import { TestClient, addMember, createWorkspace, signUpVerified } from '../../test/client.js'
import { totp } from '../../test/totp.js'

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

describe('cross-site requests', () => {
  it('refuses changes without our Origin or Referer, even with a valid session', async () => {
    const { owner } = await setup()
    const inject = (headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: '/api/contacts',
        headers: { 'content-type': 'application/json', cookie: owner.cookieHeader(), ...headers },
        payload: JSON.stringify({ firstName: 'Utan ursprung' }),
      })
    expect((await inject({})).statusCode).toBe(403)
    expect((await inject({ origin: 'https://evil.example' })).statusCode).toBe(403)
    expect((await inject({ referer: 'https://evil.example/page' })).statusCode).toBe(403)
    expect((await inject({ referer: 'http://localhost:5173/contacts' })).statusCode).toBe(201)
  })
})

describe('public surface', () => {
  it('the health check says nothing about environment or version, and there is no debug route', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(Object.keys(res.json()).sort()).toEqual(['db', 'status'])
    expect((await app.inject({ method: 'GET', url: '/api/debug/error' })).statusCode).toBe(404)
  })
})

describe('security log and sessions', () => {
  it('records logins, failed logins and logouts, and lists only my own', async () => {
    const { owner, email, password } = await setup()
    await owner.post('/api/auth/sign-out')
    expect((await new TestClient(app).post('/api/auth/sign-in/email', { email, password: 'fel-lösenord-123' })).statusCode).toBe(401)
    await owner.login(email, password)
    const events = await ok(owner.get('/api/me/security-events'))
    expect(events.map((e: { type: string }) => e.type).slice(0, 4)).toEqual(['login', 'login_failed', 'logout', 'login'])
    expect(events[0].ipAddress).toBeTruthy()

    const other = new TestClient(app)
    await signUpVerified(other)
    expect((await ok(other.get('/api/me/security-events'))).map((e: { type: string }) => e.type)).toEqual(['login'])
  })

  it('lists my sessions without tokens, and can end the others', async () => {
    const { owner, email, password } = await setup()
    const laptop = new TestClient(app)
    await laptop.login(email, password)
    const list = await ok(owner.get('/api/me/sessions'))
    expect(list).toHaveLength(2)
    expect(list.filter((s: { current: boolean }) => s.current)).toHaveLength(1)
    expect(JSON.stringify(list)).not.toMatch(/token/i)

    await ok(owner.post('/api/me/sessions/revoke-others'))
    expect((await laptop.get('/api/me')).statusCode).toBe(401)
    expect((await owner.get('/api/me')).statusCode).toBe(200)

    // Someone else's session id is not mine to end.
    const stranger = new TestClient(app)
    await signUpVerified(stranger)
    const [theirs] = await ok(stranger.get('/api/me/sessions'))
    expect((await owner.delete(`/api/me/sessions/${theirs.id}`)).statusCode).toBe(404)
    expect((await stranger.get('/api/me')).statusCode).toBe(200)
  })

  it('ends sessions older than 30 days however active they are', async () => {
    const { owner } = await setup()
    const userId = (await ok(owner.get('/api/me'))).user.id
    await db.execute(sql`update sessions set created_at = now() - interval '31 days' where user_id = ${userId}`)
    expect((await owner.get('/api/me')).statusCode).toBe(401)
  })
})

describe('two-factor login', () => {
  async function enable2fa(client: TestClient, password: string) {
    const { totpURI, backupCodes } = await ok(client.post('/api/auth/two-factor/enable', { password }))
    await ok(client.post('/api/auth/two-factor/verify-totp', { code: totp(totpURI) }))
    return { totpURI: totpURI as string, backupCodes: backupCodes as string[] }
  }

  it('asks for a code after the password, accepts an authenticator code or a backup code once', async () => {
    const { owner, email, password } = await setup()
    const { totpURI, backupCodes } = await enable2fa(owner, password)
    expect((await ok(owner.get('/api/me'))).user.twoFactorEnabled).toBe(true)
    expect(backupCodes).toHaveLength(10)

    const phone = new TestClient(app)
    const first = await ok(phone.post('/api/auth/sign-in/email', { email, password }))
    expect(first.twoFactorRedirect).toBe(true)
    expect((await phone.get('/api/me')).statusCode).toBe(401)
    expect((await phone.post('/api/auth/two-factor/verify-totp', { code: '000000' })).statusCode).toBe(401)
    await ok(phone.post('/api/auth/two-factor/verify-totp', { code: totp(totpURI) }))
    expect((await phone.get('/api/me')).statusCode).toBe(200)

    const tablet = new TestClient(app)
    await ok(tablet.post('/api/auth/sign-in/email', { email, password }))
    await ok(tablet.post('/api/auth/two-factor/verify-backup-code', { code: backupCodes[0] }))
    expect((await tablet.get('/api/me')).statusCode).toBe(200)
    const reuse = new TestClient(app)
    await ok(reuse.post('/api/auth/sign-in/email', { email, password }))
    expect((await reuse.post('/api/auth/two-factor/verify-backup-code', { code: backupCodes[0] })).statusCode).toBe(401)

    const types = (await ok(owner.get('/api/me/security-events'))).map((e: { type: string }) => e.type)
    expect(types).toContain('two_factor_enabled')
  })

  it('a workspace can require it: members without 2FA can only reach /me until they set it up', async () => {
    const { owner, password } = await setup()
    const erik = await addMember(app, owner, 'member', 'Erik')
    expect((await owner.patch('/api/workspace', { requireTwoFactor: true })).statusCode).toBe(409)
    await enable2fa(owner, password)
    expect(await ok(owner.patch('/api/workspace', { requireTwoFactor: true }))).toMatchObject({ requireTwoFactor: true })

    const blocked = await erik.client.get('/api/contacts')
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().error.code).toBe('two_factor_required')
    expect(await ok(erik.client.get('/api/me'))).toMatchObject({ twoFactorSetupRequired: true })
    await enable2fa(erik.client, 'Secret123!')
    await ok(erik.client.get('/api/contacts'))
    expect((await ok(erik.client.get('/api/me'))).twoFactorSetupRequired).toBe(false)
  })
})
