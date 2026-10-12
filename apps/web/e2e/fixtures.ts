// Seed users, mirroring apps/api/src/seed/fixtures.ts. The loginAs(page, user) helper
// arrives with auth in Sprint 1; every later e2e test logs in through it.
export const SEED_PASSWORD = 'Password123!'

export const users = {
  anna: { email: 'anna@acme.test', workspace: 'acme', role: 'owner' },
  adam: { email: 'adam@acme.test', workspace: 'acme', role: 'admin' },
  erik: { email: 'erik@acme.test', workspace: 'acme', role: 'member' },
  vera: { email: 'vera@acme.test', workspace: 'acme', role: 'viewer' },
  sara: { email: 'sara@beta.test', workspace: 'beta', role: 'owner' },
} as const
