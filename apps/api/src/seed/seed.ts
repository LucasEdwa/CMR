import { hashPassword } from 'better-auth/crypto'
import { appClient, db } from '../db/client.js'
import { accounts, memberships, tenants, users } from '../db/schema.js'
import { withTenant } from '../db/tenant.js'
import { SEED_PASSWORD, SEED_TENANTS, SEED_USERS } from './fixtures.js'

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
  if (large) console.log('--large: contacts arrive in Sprint 2; nothing extra to seed yet.')
}

seed()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => appClient.end())
