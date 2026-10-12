// Adds sample companies and contacts to a real workspace, e.g. your own while testing:
//   pnpm seed:sample --email you@example.com [--workspace "Name AB"] [--contacts 50] [--companies 10]
import { and, eq, sql } from 'drizzle-orm'
import { parseArgs } from 'node:util'
import { appClient, db } from '../db/client.js'
import { memberships, tenants, users } from '../db/schema.js'
import { withTenant, withUser } from '../db/tenant.js'
import { seedActivities, seedCrm, seedDeals } from './crm-data.js'

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    workspace: { type: 'string' },
    contacts: { type: 'string', default: '50' },
    companies: { type: 'string', default: '10' },
  },
})

async function main() {
  if (!values.email) throw new Error('Usage: pnpm seed:sample --email you@example.com [--workspace "Name AB"] [--contacts 50] [--companies 10]')
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${values.email.toLowerCase()}`)
  if (!user) throw new Error(`No user with email ${values.email}`)

  const workspaces = await withUser(user.id, (tx) =>
    tx
      .select({ id: tenants.id, name: tenants.name, role: memberships.role })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(and(eq(memberships.userId, user.id))),
  )
  const matches = values.workspace
    ? workspaces.filter((w) => w.name.toLowerCase() === values.workspace!.toLowerCase())
    : workspaces
  if (matches.length !== 1) {
    throw new Error(`Pick one workspace with --workspace. ${user.email} is in: ${workspaces.map((w) => `"${w.name}"`).join(', ') || 'none'}`)
  }
  const ws = matches[0]!
  if (ws.role === 'viewer') throw new Error(`${user.email} is only a viewer in ${ws.name}`)

  const ctx = { tenantId: ws.id, userId: user.id, role: ws.role }
  const ownerIds = (await withTenant(ctx, (tx) => tx.select({ id: memberships.userId }).from(memberships).where(sql`${memberships.role} <> 'viewer'`))).map((m) => m.id)
  const result = await withTenant(ctx, (tx) =>
    seedCrm(tx, ctx, {
      companies: Number(values.companies),
      contacts: Number(values.contacts),
      ownerIds,
      seed: Date.now() % 100_000,
      append: true,
    }),
  )
  const dealCount = await withTenant(ctx, (tx) => seedDeals(tx, ctx, { count: 15, ownerIds, seed: Date.now() % 1000 }))
  const work = await withTenant(ctx, (tx) => seedActivities(tx, ctx, { ownerIds, seed: Date.now() % 1000 }))
  console.log(
    `Added ${result.contacts} contacts, ${result.companies} companies, ${dealCount} deals, ${work.activities} activities and ${work.tasks} tasks to ${ws.name}.`,
  )
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => appClient.end())
