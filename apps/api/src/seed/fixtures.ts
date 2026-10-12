import type { Role } from '@crm/shared'

// Fixed ids keep the seed idempotent and let tests and e2e refer to seed records directly.
export const SEED_TENANTS = {
  acme: { id: '00000000-0000-4000-8000-0000000ac3e0', name: 'Acme AB', slug: 'acme', orgNumber: '556677-8899' },
  beta: { id: '00000000-0000-4000-8000-0000000be7a0', name: 'Beta AB', slug: 'beta', orgNumber: '559988-7766' },
} as const

export type SeedUser = {
  id: string
  email: string
  name: string
  tenant: keyof typeof SEED_TENANTS
  role: Role
}

// Passwords (Password123!) are set once auth lands in Sprint 1.
export const SEED_USERS: SeedUser[] = [
  { id: '00000000-0000-4000-8000-000000000a01', email: 'anna@acme.test', name: 'Anna Åberg', tenant: 'acme', role: 'owner' },
  { id: '00000000-0000-4000-8000-000000000a02', email: 'adam@acme.test', name: 'Adam Öhman', tenant: 'acme', role: 'admin' },
  { id: '00000000-0000-4000-8000-000000000a03', email: 'erik@acme.test', name: 'Erik Ängström', tenant: 'acme', role: 'member' },
  { id: '00000000-0000-4000-8000-000000000a04', email: 'vera@acme.test', name: 'Vera Lindqvist', tenant: 'acme', role: 'viewer' },
  { id: '00000000-0000-4000-8000-000000000b01', email: 'sara@beta.test', name: 'Sara Björk', tenant: 'beta', role: 'owner' },
]
