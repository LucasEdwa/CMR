import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app.js'
import { TestClient, lastLinkTo, signUpVerified, tokenFrom, uniqueEmail } from '../../test/client.js'

let app: FastifyInstance
beforeAll(async () => {
  app = await buildApp()
})
afterAll(() => app.close())

describe('signup and email verification', () => {
  it('sends a verification email and blocks login until the address is verified', async () => {
    const client = new TestClient(app)
    const email = uniqueEmail()
    const signup = await client.post('/api/auth/sign-up/email', { name: 'Klara', email, password: 'Secret123!' })
    expect(signup.statusCode).toBe(200)

    const blocked = await client.post('/api/auth/sign-in/email', { email, password: 'Secret123!' })
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().code).toBe('EMAIL_NOT_VERIFIED')

    const link = lastLinkTo(email)
    expect(link).toMatch(/^http:\/\/localhost:5173\/verify-email\?token=/)
    const verify = await client.get(`/api/auth/verify-email?token=${tokenFrom(link)}`)
    expect(verify.statusCode).toBe(200)

    // Verification signs the user in.
    const me = await client.get('/api/me')
    expect(me.statusCode).toBe(200)
    expect(me.json()).toMatchObject({ user: { email }, workspaces: [], activeWorkspaceId: null })
  })

  it('rejects a short password', async () => {
    const client = new TestClient(app)
    const res = await client.post('/api/auth/sign-up/email', { name: 'K', email: uniqueEmail(), password: 'short' })
    expect(res.statusCode).toBe(400)
  })
})

describe('login and logout', () => {
  it('logs in, then logs out so the API no longer knows the user', async () => {
    const client = new TestClient(app)
    const { email, password } = await signUpVerified(client)
    await client.post('/api/auth/sign-out')
    expect((await client.get('/api/me')).statusCode).toBe(401)

    await client.login(email, password)
    expect((await client.get('/api/me')).statusCode).toBe(200)
  })

  it('rate-limits after 10 wrong passwords in a row', async () => {
    const client = new TestClient(app)
    const { email } = await signUpVerified(client)
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      statuses.push((await client.post('/api/auth/sign-in/email', { email, password: 'wrong-password' })).statusCode)
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true)
    expect(statuses[10]).toBe(429)
  })

  it('locks an email after 30 wrong passwords from any mix of IPs', async () => {
    const owner = new TestClient(app)
    const { email, password } = await signUpVerified(owner)
    const statuses: number[] = []
    // Four "attackers" on four IPs, 9 tries each: each stays under the per-IP limit.
    for (let n = 0; n < 4; n++) {
      const attacker = new TestClient(app)
      for (let i = 0; i < 9; i++) statuses.push((await attacker.post('/api/auth/sign-in/email', { email, password: 'wrong-password' })).statusCode)
    }
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true)
    expect(statuses.slice(30).every((s) => s === 429)).toBe(true)
    // The real owner is locked out too until the window passes: the trade-off for stopping spread-out guessing.
    expect((await new TestClient(app).post('/api/auth/sign-in/email', { email, password })).statusCode).toBe(429)
  })

  it('requires passwords of at least 10 characters', async () => {
    const client = new TestClient(app)
    const res = await client.post('/api/auth/sign-up/email', { name: 'Kort', email: `kort-${Date.now()}@test.local`, password: 'Kort1234!' })
    expect(res.statusCode).toBe(400)
  })

  it('does not count successful logins toward the limit', async () => {
    const client = new TestClient(app)
    const { email, password } = await signUpVerified(client)
    for (let i = 0; i < 12; i++) await client.login(email, password)
  })

  it('a successful login resets the failure count', async () => {
    const client = new TestClient(app)
    const { email, password } = await signUpVerified(client)
    for (let i = 0; i < 9; i++) await client.post('/api/auth/sign-in/email', { email, password: 'wrong' })
    await client.login(email, password)
    for (let i = 0; i < 9; i++) {
      expect((await client.post('/api/auth/sign-in/email', { email, password: 'wrong' })).statusCode).toBe(401)
    }
  })

  it('returns 401 for every app route when logged out', async () => {
    const client = new TestClient(app)
    for (const url of ['/api/me', '/api/workspace', '/api/workspace/members']) {
      expect((await client.get(url)).statusCode, url).toBe(401)
    }
  })
})

describe('password reset', () => {
  it('resets the password end to end and signs out other sessions', async () => {
    const browserA = new TestClient(app)
    const { email, password } = await signUpVerified(browserA)

    const browserB = new TestClient(app)
    const request = await browserB.post('/api/auth/request-password-reset', { email, redirectTo: '/reset-password' })
    expect(request.statusCode).toBe(200)

    const token = tokenFrom(lastLinkTo(email))
    const reset = await browserB.post('/api/auth/reset-password', { token, newPassword: 'BrandNew456!' })
    expect(reset.statusCode).toBe(200)

    expect((await browserA.get('/api/me')).statusCode).toBe(401)
    expect((await browserB.post('/api/auth/sign-in/email', { email, password })).statusCode).toBe(401)
    await browserB.login(email, 'BrandNew456!')
  })

  it('answers the same for unknown emails (no account enumeration)', async () => {
    const client = new TestClient(app)
    const res = await client.post('/api/auth/request-password-reset', { email: uniqueEmail('nobody'), redirectTo: '/reset-password' })
    expect(res.statusCode).toBe(200)
  })
})

describe('CSRF', () => {
  it('rejects state-changing requests from another origin', async () => {
    const client = new TestClient(app)
    await signUpVerified(client)
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Evil AB', slug: 'evil-ab' }),
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('invalid_origin')
  })
})
