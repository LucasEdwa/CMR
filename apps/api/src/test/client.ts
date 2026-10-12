import type { FastifyInstance, InjectOptions } from 'fastify'
import { randomUUID } from 'node:crypto'
import { outbox } from '../email/send.js'

export const WEB_ORIGIN = 'http://localhost:5173'

// A browser-like client for app.inject: keeps cookies, sends our Origin, and uses its own IP
// so rate limits in one test never affect another.
export class TestClient {
  private cookies = new Map<string, string>()
  readonly ip = `10.${rand()}.${rand()}.${rand()}`

  constructor(private app: FastifyInstance) {}

  async request(method: InjectOptions['method'], url: string, body?: unknown) {
    const res = await this.app.inject({
      method,
      url,
      headers: {
        origin: WEB_ORIGIN,
        'x-forwarded-for': this.ip,
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    })
    for (const c of res.cookies) {
      if (c.value === '' || (c.maxAge !== undefined && c.maxAge <= 0)) this.cookies.delete(c.name)
      else this.cookies.set(c.name, c.value)
    }
    return res
  }

  cookieHeader = () => [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')

  get = (url: string) => this.request('GET', url)
  post = (url: string, body: unknown = {}) => this.request('POST', url, body)
  patch = (url: string, body: unknown) => this.request('PATCH', url, body)
  delete = (url: string) => this.request('DELETE', url)

  async login(email: string, password: string) {
    const res = await this.post('/api/auth/sign-in/email', { email, password })
    if (res.statusCode !== 200) throw new Error(`login failed (${res.statusCode}): ${res.body}`)
    return res
  }
}

const rand = () => Math.floor(Math.random() * 250) + 1

export const uniqueEmail = (prefix = 'user') => `${prefix}-${randomUUID().slice(0, 8)}@test.local`

// Finds the newest email to `to` and returns the link in it.
export function lastLinkTo(to: string): string {
  const message = [...outbox].reverse().find((m) => m.to === to)
  if (!message) throw new Error(`No email to ${to}`)
  const match = /(http:\/\/localhost:5173\/\S+)/.exec(message.text)
  if (!match) throw new Error(`No link in email to ${to}`)
  return match[1]!
}

export const tokenFrom = (link: string) => new URL(link).searchParams.get('token') ?? link.split('/').pop()!

// Signs up, verifies the email and leaves the client logged in.
export async function signUpVerified(client: TestClient, name = 'Test Person') {
  const email = uniqueEmail()
  const password = 'Secret123!'
  const res = await client.post('/api/auth/sign-up/email', { name, email, password })
  if (res.statusCode !== 200) throw new Error(`signup failed: ${res.body}`)
  const token = tokenFrom(lastLinkTo(email))
  const verify = await client.get(`/api/auth/verify-email?token=${token}`)
  if (verify.statusCode !== 200) throw new Error(`verify failed: ${verify.body}`)
  return { email, password }
}

export async function createWorkspace(client: TestClient, name = 'Testbolaget AB') {
  const slug = `ws-${randomUUID().slice(0, 8)}`
  const res = await client.post('/api/workspaces', { name, slug })
  if (res.statusCode !== 201) throw new Error(`create workspace failed: ${res.body}`)
  return res.json() as { id: string; slug: string }
}

// Invites a new person with `role` into the owner's active workspace; returns their logged-in client.
export async function addMember(app: FastifyInstance, owner: TestClient, role: 'admin' | 'member' | 'viewer', name: string = role) {
  const email = uniqueEmail(role)
  const res = await owner.post('/api/workspace/invitations', { email, role })
  if (res.statusCode !== 201) throw new Error(`invite failed: ${res.body}`)
  const token = lastLinkTo(email).split('/invite/')[1]!
  const client = new TestClient(app)
  const accept = await client.post(`/api/invitations/${token}/accept`, { name, password: 'Secret123!' })
  if (accept.statusCode !== 200) throw new Error(`accept failed: ${accept.body}`)
  const userId = (await client.get('/api/me')).json().user.id as string
  return { client, userId, email }
}
