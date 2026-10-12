import { asc, count, eq, inArray, sql } from 'drizzle-orm'
import { CALL_OUTCOMES, CONSENT_BASES, DEFAULT_PICKLISTS, LEAD_SOURCES, LIFECYCLE_STAGES, COMPANY_SIZES, plainToRichDoc } from '@crm/shared'
import type { Tx } from '../db/client.js'
import {
  activities,
  activityLinks,
  companies,
  contacts,
  contactTags,
  companyTags,
  dealContacts,
  dealStageHistory,
  deals,
  pipelineStages,
  tags,
  tasks,
  tenants,
} from '../db/schema.js'
import type { TenantContext } from '../db/tenant.js'
import { buildSearchText } from '../services/common.js'
import { ensureDefaultPipeline } from '../services/pipelines.js'

// Deterministic pseudo-random numbers, so every seed run produces the same data.
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const pick = <T>(r: () => number, items: readonly T[]) => items[Math.floor(r() * items.length)]!

const FIRST = ['Anna', 'Björn', 'Åsa', 'Örjan', 'Märta', 'Erik', 'Karin', 'Lars', 'Sofia', 'Johan', 'Maja', 'Oskar', 'Elin', 'Gustav', 'Ingrid', 'Nils', 'Linnéa', 'Pär', 'Ebba', 'Mattias', 'Saga', 'Viktor', 'Ylva', 'Håkan']
const LAST = ['Andersson', 'Johansson', 'Karlsson', 'Nilsson', 'Eriksson', 'Ödman', 'Ångström', 'Björklund', 'Lindqvist', 'Bergström', 'Sjöberg', 'Wallin', 'Holm', 'Åberg', 'Lundgren', 'Ekström', 'Hägg', 'Nyström', 'Söderberg', 'Fransson']
const COMPANY_WORDS = ['Nordlund', 'Fjällräv', 'Sjövik', 'Granskog', 'Älvdal', 'Stenhög', 'Björkvik', 'Solhem', 'Ekbacken', 'Lövånger', 'Havsbris', 'Kvarnen', 'Ängsgård', 'Vinterviken', 'Brofästet']
// Used in generated company names.
const COMPANY_TYPES = ['Bygg', 'Konsult', 'Logistik', 'Data', 'Fastigheter', 'Design', 'Teknik', 'Handel']
const CITIES = ['Stockholm', 'Göteborg', 'Malmö', 'Uppsala', 'Västerås', 'Örebro', 'Linköping', 'Umeå', 'Luleå', 'Jönköping']
const TITLES = ['VD', 'Inköpschef', 'Säljare', 'Ekonomichef', 'IT-chef', 'Marknadschef', 'Projektledare', null, null]
const TAGS = ['VIP', 'Norden', 'Partner', 'Nyhetsbrev']

const ascii = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '')

// A valid Swedish org number (Luhn check digit) built from a number.
function orgNumber(n: number) {
  const body = `55${String(1000000 + n).slice(-7)}`
  let sum = 0
  for (let i = 0; i < 9; i++) {
    let d = Number(body[8 - i]) * (i % 2 === 0 ? 2 : 1)
    if (d > 9) d -= 9
    sum += d
  }
  const check = (10 - (sum % 10)) % 10
  return `${body.slice(0, 6)}-${body.slice(6)}${check}`
}

async function tagIds(tx: Tx, ctx: TenantContext) {
  await tx.insert(tags).values(TAGS.map((name) => ({ tenantId: ctx.tenantId, name }))).onConflictDoNothing()
  return tx.select({ id: tags.id, name: tags.name }).from(tags)
}

// Seeds companies and contacts once per workspace (skipped when it already has contacts).
export async function seedCrm(
  tx: Tx,
  ctx: TenantContext,
  opts: { companies: number; contacts: number; ownerIds: string[]; seed: number; emailDomain?: string; append?: boolean },
) {
  const [existing] = await tx.select({ n: count() }).from(contacts)
  if (existing!.n > 0 && !opts.append) return { companies: 0, contacts: 0 }
  const r = rng(opts.seed)
  const tagRows = await tagIds(tx, ctx)

  const companyValues = Array.from({ length: opts.companies }, (_, i) => {
    const name = `${pick(r, COMPANY_WORDS)} ${pick(r, COMPANY_TYPES)} AB`
    const domain = `${ascii(name.replace(/ AB$/, ''))}${opts.seed % 1000}${i}.se`
    const city = pick(r, CITIES)
    const phone = `08-${String(Math.floor(r() * 9_000_000) + 1_000_000)}`
    const org = orgNumber(opts.seed * 1000 + i)
    return {
      tenantId: ctx.tenantId,
      name,
      orgNumber: org,
      vatNumber: `SE${org.replace('-', '')}01`,
      domain,
      industry: pick(r, DEFAULT_PICKLISTS.industry),
      size: pick(r, COMPANY_SIZES),
      phone,
      city,
      postalCode: String(10000 + Math.floor(r() * 89999)).replace(/(\d{3})(\d{2})/, '$1 $2'),
      street: `${pick(r, ['Storgatan', 'Kungsgatan', 'Drottninggatan', 'Sveavägen', 'Hamngatan'])} ${1 + Math.floor(r() * 80)}`,
      ownerUserId: pick(r, opts.ownerIds),
      createdByUserId: ctx.userId,
      searchText: buildSearchText([name, org, org.replace('-', ''), domain, city], [phone]),
    }
  })
  const companyRows = companyValues.length
    ? await tx.insert(companies).values(companyValues).returning({ id: companies.id, domain: companies.domain })
    : []
  if (companyRows.length) {
    await tx.insert(companyTags).values(
      companyRows.filter(() => r() < 0.3).map((c) => ({ tenantId: ctx.tenantId, companyId: c.id, tagId: pick(r, tagRows).id })),
    )
  }

  for (let start = 0; start < opts.contacts; start += 1000) {
    const batch = Array.from({ length: Math.min(1000, opts.contacts - start) }, (_, j) => {
      const i = start + j
      const firstName = pick(r, FIRST)
      const lastName = pick(r, LAST)
      const company = companyRows.length && r() < 0.8 ? pick(r, companyRows) : null
      const domain = opts.emailDomain ?? company?.domain ?? 'example.se'
      // The seed number keeps emails unique when sample data is added more than once.
      const email = `${ascii(firstName)}.${ascii(lastName)}.${opts.seed}${i}@${domain}`
      const mobilePhone = `07${Math.floor(r() * 4)}-${String(Math.floor(r() * 9_000_000) + 1_000_000)}`
      const title = pick(r, TITLES)
      const consent = r() < 0.4
      // Spread creation dates over the last year so date sorting and filters are meaningful.
      const createdAt = new Date(Date.now() - Math.floor(r() * 365 * 86_400_000))
      return {
        tenantId: ctx.tenantId,
        firstName,
        lastName,
        email,
        mobilePhone,
        title,
        companyId: company?.id ?? null,
        lifecycleStage: pick(r, LIFECYCLE_STAGES),
        leadSource: pick(r, LEAD_SOURCES),
        marketingConsent: consent,
        consentBasis: consent ? pick(r, CONSENT_BASES) : null,
        consentUpdatedAt: consent ? createdAt : null,
        city: pick(r, CITIES),
        ownerUserId: pick(r, opts.ownerIds),
        createdByUserId: ctx.userId,
        createdAt,
        updatedAt: createdAt,
        searchText: buildSearchText([firstName, lastName, email, title], [mobilePhone]),
      }
    })
    const rows = await tx.insert(contacts).values(batch).returning({ id: contacts.id })
    const links = rows.filter(() => r() < 0.35).map((c) => ({ tenantId: ctx.tenantId, contactId: c.id, tagId: pick(r, tagRows).id }))
    if (links.length) await tx.insert(contactTags).values(links)
  }
  await tx.execute(sql`analyze contacts`)
  return { companies: companyRows.length, contacts: opts.contacts }
}

const DEAL_WORDS = ['Licenser', 'Ramavtal', 'Konsulttimmar', 'Support', 'Utbildning', 'Hårdvara', 'Molntjänst', 'Pilotprojekt', 'Förnyelse', 'Uppgradering']

// Deals across the default pipeline: mostly open, some won and lost, two stale, and one worth
// exactly 1 999,50 kr for the rounding check.
export async function seedDeals(tx: Tx, ctx: TenantContext, opts: { count: number; ownerIds: string[]; seed: number }) {
  const [existing] = await tx.select({ n: count() }).from(deals)
  if (existing!.n > 0) return 0
  const r = rng(opts.seed)
  const pipeline = await ensureDefaultPipeline(tx, ctx)
  const stages = await tx.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, pipeline.id)).orderBy(asc(pipelineStages.position))
  const companyRows = await tx.select({ id: companies.id, name: companies.name }).from(companies).limit(200)
  const contactRows = await tx.select({ id: contacts.id, companyId: contacts.companyId }).from(contacts).limit(500)
  const DAY = 86_400_000

  for (let i = 0; i < opts.count; i++) {
    const company = pick(r, companyRows)
    const stage = pick(r, stages)
    const roll = r()
    const status = roll < 0.12 ? 'won' : roll < 0.22 ? 'lost' : 'open'
    const stale = i < 2
    const created = new Date(Date.now() - (stale ? 60 : Math.floor(r() * 50)) * DAY)
    const lastActivity = stale ? new Date(Date.now() - (20 + i * 5) * DAY) : new Date(Date.now() - Math.floor(r() * 5) * DAY)
    const name = i === 2 ? `Startpaket – ${company.name}` : stale ? `Gammal offert – ${company.name}` : `${pick(r, DEAL_WORDS)} – ${company.name}`
    const value = i === 2 ? 199_950 : Math.round(5 + r() * 400) * 1_000_00
    const closeIn = Math.floor(r() * 90) - 10
    const [deal] = await tx
      .insert(deals)
      .values({
        tenantId: ctx.tenantId,
        name,
        value,
        pipelineId: pipeline.id,
        stageId: stage.id,
        position: i,
        status,
        lostReason: status === 'lost' ? pick(r, DEFAULT_PICKLISTS.lost_reason) : null,
        closedAt: status === 'open' ? null : lastActivity,
        expectedCloseDate: new Date(Date.now() + closeIn * DAY).toISOString().slice(0, 10),
        companyId: company.id,
        ownerUserId: pick(r, opts.ownerIds),
        createdByUserId: ctx.userId,
        searchText: buildSearchText([name]),
        createdAt: created,
        updatedAt: lastActivity,
        lastActivityAt: lastActivity,
        stageEnteredAt: lastActivity,
      })
      .returning({ id: deals.id })
    const people = contactRows.filter((c) => c.companyId === company.id).slice(0, 2)
    if (people.length) await tx.insert(dealContacts).values(people.map((p) => ({ tenantId: ctx.tenantId, dealId: deal!.id, contactId: p.id })))
    await tx.insert(dealStageHistory).values({
      tenantId: ctx.tenantId,
      dealId: deal!.id,
      stageId: stage.id,
      stageName: stage.name,
      pipelineName: pipeline.name,
      enteredAt: lastActivity,
      changedByUserId: ctx.userId,
    })
  }
  return opts.count
}

const NOTES = [
  'Kunden vill se en demo med hela teamet innan beslut.',
  'Budgeten är godkänd för Q1. Återkom med offert.',
  'Pratade om integration med Fortnox, viktigt för dem.',
  'Beslutsfattare är ekonomichefen, inte IT.',
  'Önskar faktura per kvartal.',
]
const CALL_SUBJECTS = ['Uppföljning', 'Behovsanalys', 'Prisfråga', 'Avstämning', 'Första samtal']
const MEETING_SUBJECTS = ['Demo', 'Workshop', 'Avtalsgenomgång', 'Lunchmöte']
const TASK_TITLES = ['Ring och stäm av', 'Skicka offert', 'Boka demo', 'Följ upp mejl', 'Skicka avtal', 'Kolla budget med ekonomi', 'Förbered presentation']

// Activities on open deals (also linked to their contacts and company), and a spread of tasks per
// user: some overdue, some due today, some upcoming and a few completed. Dates are relative to today.
export async function seedActivities(tx: Tx, ctx: TenantContext, opts: { ownerIds: string[]; seed: number }) {
  const [existing] = await tx.select({ n: count() }).from(activities)
  if (existing!.n > 0) return { activities: 0, tasks: 0 }
  const r = rng(opts.seed)
  const DAY = 86_400_000
  const [tenant] = await tx.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId))
  const tz = tenant!.tz
  const openDeals = await tx
    .select({ id: deals.id, companyId: deals.companyId, ownerUserId: deals.ownerUserId, lastActivityAt: deals.lastActivityAt })
    .from(deals)
    .where(eq(deals.status, 'open'))
    .orderBy(asc(deals.createdAt))
  const links = await tx
    .select({ dealId: dealContacts.dealId, contactId: dealContacts.contactId })
    .from(dealContacts)
    .where(inArray(dealContacts.dealId, openDeals.length ? openDeals.map((d) => d.id) : [ctx.tenantId]))

  let activityCount = 0
  for (const deal of openDeals) {
    const n = 1 + Math.floor(r() * 3)
    for (let i = 0; i < n; i++) {
      // Never newer than the deal's last activity, so stale deals stay stale.
      const occurredAt = new Date(deal.lastActivityAt.getTime() - i * Math.floor(1 + r() * 6) * DAY)
      const type = pick(r, ['note', 'call', 'call', 'meeting', 'email'] as const)
      // Notes and meetings always have text; calls and emails sometimes.
      const text = type === 'note' || type === 'meeting' || r() < 0.6 ? pick(r, NOTES) : ''
      const [a] = await tx
        .insert(activities)
        .values({
          tenantId: ctx.tenantId,
          type,
          subject: type === 'note' ? null : type === 'call' ? pick(r, CALL_SUBJECTS) : type === 'meeting' ? pick(r, MEETING_SUBJECTS) : 'Offert bifogad',
          body: text ? plainToRichDoc(text) : null,
          bodyText: text,
          occurredAt,
          durationMinutes: type === 'call' ? 2 + Math.floor(r() * 25) : type === 'meeting' ? 30 + 15 * Math.floor(r() * 4) : null,
          outcome: type === 'call' ? pick(r, CALL_OUTCOMES) : null,
          direction: type === 'email' ? 'outbound' : null,
          authorUserId: deal.ownerUserId ?? ctx.userId,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        })
        .returning({ id: activities.id })
      const rows = [
        { dealId: deal.id },
        ...(deal.companyId ? [{ companyId: deal.companyId }] : []),
        ...links.filter((l) => l.dealId === deal.id).map((l) => ({ contactId: l.contactId })),
      ]
      await tx.insert(activityLinks).values(rows.map((l) => ({ tenantId: ctx.tenantId, activityId: a!.id, ...l })))
      activityCount++
    }
  }

  const localDate = (offset: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(new Date(Date.now() + offset * DAY))
  const dueAt = (date: string, time: string | null) =>
    sql`((${time ? sql`${date}::date + ${time}::time` : sql`${date}::date + 1`})::timestamp at time zone ${tz})`
  let taskCount = 0
  for (const userId of opts.ownerIds) {
    const theirs = openDeals.filter((d) => d.ownerUserId === userId && d.lastActivityAt.getTime() > Date.now() - 10 * DAY)
    const plan: Array<{ offset: number; time: string | null; done?: boolean }> = [
      { offset: -3, time: null },
      { offset: -1, time: '10:00' },
      { offset: 0, time: null },
      { offset: 0, time: '15:30' },
      { offset: 2, time: null },
      { offset: 5, time: '09:00' },
      { offset: 9, time: null },
      { offset: -2, time: null, done: true },
      { offset: -5, time: null, done: true },
    ]
    for (const [i, item] of plan.entries()) {
      const date = localDate(item.offset)
      const deal = theirs[i % Math.max(theirs.length, 1)]
      await tx.insert(tasks).values({
        tenantId: ctx.tenantId,
        title: pick(r, TASK_TITLES),
        dueDate: date,
        dueTime: item.time,
        dueAt: dueAt(date, item.time),
        priority: i === 1 ? 'high' : 'normal',
        assigneeUserId: userId,
        dealId: i < 6 ? (deal?.id ?? null) : null,
        completedAt: item.done ? new Date(Date.now() + item.offset * DAY) : null,
        completedByUserId: item.done ? userId : null,
        // Seeded tasks never trigger reminder emails.
        reminderSentFor: date,
        createdByUserId: ctx.userId,
      })
      taskCount++
    }
  }
  return { activities: activityCount, tasks: taskCount }
}
