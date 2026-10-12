import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import type { Role } from '@crm/shared'
import { buildApp } from '../../app.js'
import { TestClient, addMember, createWorkspace, signUpVerified } from '../../test/client.js'

// Who may call each route. Every route the app registers must be listed: a new route without a
// rule fails this test, so permissions are always decided on purpose.
type Rule = 'public' | 'user' | 'all' | 'writers' | 'managers' | 'owners'
const RULES: Record<string, Rule> = {
  'OPTIONS *': 'public',
  'GET /': 'public',
  'GET /api/health': 'public',
  'GET /api/auth/*': 'public',
  'POST /api/auth/*': 'public',
  'GET /api/invitations/:token': 'public',
  'POST /api/invitations/:token/accept': 'public',

  // Logged in, no workspace needed.
  'GET /api/me': 'user',
  'PATCH /api/me': 'user',
  'POST /api/workspaces': 'user',
  'POST /api/workspaces/switch': 'user',

  // Workspace and people.
  'GET /api/workspace': 'all',
  'PATCH /api/workspace': 'managers',
  'DELETE /api/workspace': 'owners',
  'GET /api/workspace/members': 'all',
  'PATCH /api/workspace/members/:userId': 'managers',
  // Anyone may remove themselves (leave); removing someone else needs a manager.
  'DELETE /api/workspace/members/:userId': 'managers',
  'GET /api/workspace/invitations': 'managers',
  'POST /api/workspace/invitations': 'managers',
  'DELETE /api/workspace/invitations/:id': 'managers',
  'GET /api/audit': 'managers',

  // Records: everyone reads, viewers never write.
  'GET /api/contacts': 'all',
  'GET /api/contacts/:id': 'all',
  'POST /api/contacts': 'writers',
  'PATCH /api/contacts/:id': 'writers',
  'DELETE /api/contacts/:id': 'writers',
  'POST /api/contacts/:id/restore': 'writers',
  'GET /api/companies': 'all',
  'GET /api/companies/suggest': 'all',
  'GET /api/companies/:id': 'all',
  'POST /api/companies': 'writers',
  'PATCH /api/companies/:id': 'writers',
  'DELETE /api/companies/:id': 'writers',
  'POST /api/companies/:id/restore': 'writers',
  'GET /api/tags': 'all',
  // Saved views are personal (or shared by their owner), so viewers may keep their own.
  'GET /api/saved-views': 'all',
  'POST /api/saved-views': 'all',
  'PATCH /api/saved-views/:id': 'all',
  'DELETE /api/saved-views/:id': 'all',
  'GET /api/trash': 'writers',
  'GET /api/pipelines': 'all',
  'POST /api/pipelines': 'managers',
  'PATCH /api/pipelines/:id': 'managers',
  'DELETE /api/pipelines/:id': 'managers',
  'PUT /api/pipelines/:id/stages': 'managers',
  'PATCH /api/pipeline-settings': 'managers',
  'GET /api/picklists': 'all',
  'PUT /api/picklists/:kind': 'managers',
  'GET /api/deals': 'all',
  'GET /api/deals/board': 'all',
  'GET /api/deals/:id': 'all',
  'POST /api/deals': 'writers',
  'PATCH /api/deals/:id': 'writers',
  'POST /api/deals/:id/move': 'writers',
  'POST /api/deals/:id/won': 'writers',
  'POST /api/deals/:id/lost': 'writers',
  'POST /api/deals/:id/reopen': 'writers',
  'DELETE /api/deals/:id': 'writers',
  'POST /api/deals/:id/restore': 'writers',

  // Activities, tasks and notifications.
  'GET /api/timeline': 'all',
  'POST /api/activities': 'writers',
  'PATCH /api/activities/:id': 'writers',
  'DELETE /api/activities/:id': 'writers',
  'GET /api/tasks/my': 'all',
  'GET /api/tasks': 'all',
  'POST /api/tasks': 'writers',
  'PATCH /api/tasks/:id': 'writers',
  'DELETE /api/tasks/:id': 'writers',
  'GET /api/notifications': 'all',
  'POST /api/notifications/read-all': 'all',
  'POST /api/notifications/:id/read': 'all',

  // Data tools.
  'GET /api/dashboard': 'all',
  'POST /api/imports': 'writers',
  'GET /api/imports': 'writers',
  'GET /api/imports/:id': 'writers',
  'POST /api/imports/:id/undo': 'writers',
  'GET /api/contacts/export': 'all',
  'GET /api/companies/export': 'all',
  'GET /api/deals/export': 'all',
  'GET /api/search': 'all',
  'GET /api/recent': 'all',
  'POST /api/recent': 'all',
  'POST /api/contacts/bulk': 'writers',
  'POST /api/companies/bulk': 'writers',
  'POST /api/deals/bulk': 'writers',
  'GET /api/contacts/duplicates': 'writers',
  'POST /api/contacts/merge': 'writers',
}

const ALLOWED: Record<Exclude<Rule, 'public' | 'user'>, Role[]> = {
  all: ['owner', 'admin', 'member', 'viewer'],
  writers: ['owner', 'admin', 'member'],
  managers: ['owner', 'admin'],
  owners: ['owner'],
}

let app: FastifyInstance
const clients = {} as Record<Role, TestClient>

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
  clients.owner = new TestClient(app)
  await signUpVerified(clients.owner, 'Olga Owner')
  await createWorkspace(clients.owner, 'Behörighet AB')
  for (const role of ['admin', 'member', 'viewer'] as const) clients[role] = (await addMember(app, clients.owner, role, role)).client
})
afterAll(() => app.close())

// Path parameters get ids that match nothing, so allowed calls end in 400/404 and change nothing.
const fill = (url: string) =>
  url
    .replace(':kind', 'lead_source')
    .replace(':token', `${randomUUID()}.secret`)
    .replace(/:[a-zA-Z]+/g, () => randomUUID())

describe('permission matrix', () => {
  it('has a rule for every route', () => {
    const missing = app.routeList.map((r) => `${r.method} ${r.url}`).filter((key) => !(key in RULES))
    expect(missing).toEqual([])
    const stale = Object.keys(RULES).filter((key) => !app.routeList.some((r) => `${r.method} ${r.url}` === key))
    expect(stale).toEqual([])
  })

  const workspaceRoutes = Object.entries(RULES).filter(([, rule]) => rule !== 'public' && rule !== 'user')

  it.each(workspaceRoutes)('%s: refused for roles outside "%s"', async (key, rule) => {
    const [method, url] = key.split(' ') as [string, string]
    const results: Record<string, number> = {}
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      const res = await clients[role].request(method as 'GET', fill(url), method === 'GET' ? undefined : {})
      results[role] = res.statusCode
    }
    const allowed = ALLOWED[rule as keyof typeof ALLOWED]
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      const refused = results[role] === 403
      expect({ role, refused, status: results[role] }).toEqual({ role, refused: !allowed.includes(role), status: results[role] })
      expect(results[role]).not.toBe(401)
    }
  })

  it('refuses every non-public route without a session', async () => {
    const anonymous = new TestClient(app)
    for (const [key, rule] of Object.entries(RULES)) {
      if (rule === 'public') continue
      const [method, url] = key.split(' ') as [string, string]
      const res = await anonymous.request(method as 'GET', fill(url), method === 'GET' ? undefined : {})
      expect({ key, status: res.statusCode }).toEqual({ key, status: 401 })
    }
  })
})
