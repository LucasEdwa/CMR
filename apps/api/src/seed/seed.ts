import { hashPassword } from 'better-auth/crypto'
import { appClient, db } from '../db/client.js'
import { accounts, memberships, tenants, users } from '../db/schema.js'
import { withTenant } from '../db/tenant.js'
import { SEED_PASSWORD, SEED_TENANTS, SEED_USERS } from './fixtures.js'
import { seedActivities, seedCrm, seedDeals } from './crm-data.js'

const large = process.argv.includes('--large')

async function seed() {
  const password = await hashPassword(SEED_PASSWORD)

  // Auth tables are global (no tenant_id), so they are written without tenant context.
  for (const u of SEED_USERS) {
    await db
      .insert(users)
      .values({ id: u.id, email: u.email, name: u.name, emailVerified: true })
      .onConflictDoUpdate({ target: users.id, set: { name: u.name, emailVerified: true } })
    await db
      .insert(accounts)
      .values({ userId: u.id, accountId: u.id, providerId: 'credential', password })
      .onConflictDoUpdate({ target: [accounts.providerId, accounts.accountId], set: { password } })
  }

  for (const t of Object.values(SEED_TENANTS)) {
    const owner = SEED_USERS.find((u) => u.tenant === t.slug && u.role === 'owner')!
    await withTenant({ tenantId: t.id, userId: owner.id, role: 'owner' }, async (tx) => {
      await tx.insert(tenants).values(t).onConflictDoNothing()
      for (const u of SEED_USERS.filter((u) => u.tenant === t.slug)) {
        await tx
          .insert(memberships)
          .values({ tenantId: t.id, userId: u.id, role: u.role })
          .onConflictDoNothing()
      }
    })
  }

  console.log(`Seeded ${Object.keys(SEED_TENANTS).length} workspaces and ${SEED_USERS.length} users (password ${SEED_PASSWORD}).`)

  const ownerOf = (slug: string) => SEED_USERS.find((u) => u.tenant === slug && u.role === 'owner')!
  const acme = { tenantId: SEED_TENANTS.acme.id, userId: ownerOf('acme').id, role: 'owner' as const }
  const acmeOwners = SEED_USERS.filter((u) => u.tenant === 'acme' && u.role !== 'viewer').map((u) => u.id)
  const beta = { tenantId: SEED_TENANTS.beta.id, userId: ownerOf('beta').id, role: 'owner' as const }

  const a = await withTenant(acme, (tx) => seedCrm(tx, acme, { companies: 30, contacts: 200, ownerIds: acmeOwners, seed: 1 }))
  const b = await withTenant(beta, (tx) => seedCrm(tx, beta, { companies: 3, contacts: 10, ownerIds: [beta.userId], seed: 2 }))
  console.log(`CRM data: Acme ${a.contacts} contacts / ${a.companies} companies, Beta ${b.contacts} / ${b.companies} (0 = already seeded).`)

  const acmeDeals = await withTenant(acme, (tx) => seedDeals(tx, acme, { count: 40, ownerIds: acmeOwners, seed: 11 }))
  const betaDeals = await withTenant(beta, (tx) => seedDeals(tx, beta, { count: 5, ownerIds: [beta.userId], seed: 12 }))
  console.log(`Deals: Acme ${acmeDeals}, Beta ${betaDeals} (0 = already seeded).`)

  const acmeWork = await withTenant(acme, (tx) => seedActivities(tx, acme, { ownerIds: acmeOwners, seed: 21 }))
  const betaWork = await withTenant(beta, (tx) => seedActivities(tx, beta, { ownerIds: [beta.userId], seed: 22 }))
  console.log(
    `Activities/tasks: Acme ${acmeWork.activities}/${acmeWork.tasks}, Beta ${betaWork.activities}/${betaWork.tasks} (0 = already seeded).`,
  )

  if (large) {
    // A separate workspace keeps the 20 000 contacts out of Acme's everyday test data.
    const big = { id: '00000000-0000-4000-8000-0000000b16a0', name: 'Stor Data AB', slug: 'stordata' }
    const ctx = { tenantId: big.id, userId: acme.userId, role: 'owner' as const }
    await withTenant(ctx, async (tx) => {
      await tx.insert(tenants).values(big).onConflictDoNothing()
      await tx.insert(memberships).values({ tenantId: big.id, userId: acme.userId, role: 'owner' }).onConflictDoNothing()
    })
    const started = Date.now()
    const l = await withTenant(ctx, (tx) =>
      seedCrm(tx, ctx, { companies: 500, contacts: 20_000, ownerIds: [acme.userId], seed: 3 }),
    )
    console.log(`Large: Stor Data AB has ${l.contacts || 'its'} contacts (${Date.now() - started} ms). Log in as anna@acme.test and switch company.`)
  }
}

seed()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => appClient.end())
