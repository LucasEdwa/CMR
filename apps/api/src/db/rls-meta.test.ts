import { afterAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

// Fails when any table is added without proper RLS. Runs as the owner to see the full catalog.
const sql = postgres(process.env.DATABASE_OWNER_URL!, { max: 1, onnotice: () => {} })
afterAll(() => sql.end())

describe('RLS meta-test', () => {
  it('every tenant table has RLS enabled, forced, and a policy', async () => {
    const offenders = await sql<{ table: string; rls: boolean; forced: boolean; policies: number }[]>`
      select c.relname as table,
             c.relrowsecurity as rls,
             c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and (c.relname = 'tenants'
             or exists (select 1 from pg_attribute a
                        where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped))
    `
    expect(offenders.length).toBeGreaterThan(0)
    const broken = offenders.filter((t) => !t.rls || !t.forced || t.policies === 0)
    expect(broken, `Tables missing RLS: ${broken.map((t) => t.table).join(', ')}`).toEqual([])
  })

  it('every tenant policy is defined for both reads and writes', async () => {
    const rows = await sql<{ table: string; missing: string }[]>`
      select t.tablename as table, 'with check' as missing
      from pg_policies t
      where t.schemaname = 'public' and t.cmd in ('ALL', 'INSERT', 'UPDATE') and t.with_check is null
    `
    expect(rows).toEqual([])
  })

  it('every view is security_invoker so it cannot bypass RLS', async () => {
    const views = await sql<{ view: string }[]>`
      select c.relname as view from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'
        and not coalesce('security_invoker=true' = any(c.reloptions), false)
    `
    expect(views).toEqual([])
  })
})
