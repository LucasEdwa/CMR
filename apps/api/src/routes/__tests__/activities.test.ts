import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq, sql } from 'drizzle-orm'
import { plainToRichDoc, type Activity, type MyTasks, type RichDoc, type Task } from '@crm/shared'
import { buildApp } from '../../app.js'
import { activities, contacts, deals, tasks } from '../../db/schema.js'
import { withTenant } from '../../db/tenant.js'
import { asSystemIn } from '../../test/factories.js'
import { outbox } from '../../email/send.js'
import { purgeRecord } from '../../services/purge.js'
import { sendTaskReminder } from '../../services/tasks.js'
import { TestClient, addMember, createWorkspace, signUpVerified } from '../../test/client.js'

let app: FastifyInstance
beforeAll(async () => {
  app = await buildApp()
})
afterAll(() => app.close())

const expectStatus = async (promise: ReturnType<TestClient['get']>, status: number) => {
  const res = await promise
  if (res.statusCode !== status) throw new Error(`${res.statusCode}: ${res.body}`)
  return res.json()
}

// Owner with a deal that has a contact and a company.
async function setup() {
  const owner = new TestClient(app)
  await signUpVerified(owner, 'Olga Owner')
  const ws = await createWorkspace(owner, 'Aktivitet AB')
  const ownerId = (await owner.get('/api/me')).json().user.id as string
  const company = await expectStatus(owner.post('/api/companies', { name: 'Kund AB' }), 201)
  const contact = await expectStatus(owner.post('/api/contacts', { firstName: 'Åsa', lastName: 'Öberg', companyId: company.id }), 201)
  const deal = await expectStatus(owner.post('/api/deals', { name: 'Licenser', companyId: company.id, contactIds: [contact.id] }), 201)
  return { owner, ownerId, ws, company, contact, deal }
}

const timeline = async (client: TestClient, type: string, id: string, extra = '') =>
  (await expectStatus(client.get(`/api/timeline?type=${type}&id=${id}${extra}`), 200)) as { pinned: Activity[]; items: Activity[]; nextCursor: string | null }

const note = (text: string): RichDoc => plainToRichDoc(text)
const mention = (text: string, user: { id: string; label: string }): RichDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: `${text} ` }, { type: 'mention', attrs: user }] }],
})

const stockholmDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date(Date.now() + offsetDays * 86_400_000))

describe('activities', () => {
  it('a call logged on a deal shows on the deal, its contact and its company', async () => {
    const { owner, company, contact, deal } = await setup()
    const call = await expectStatus(
      owner.post('/api/activities', {
        type: 'call',
        record: { type: 'deal', id: deal.id },
        subject: 'Uppföljning',
        outcome: 'connected',
        durationMinutes: 12,
        body: note('Kunden vill ha offert'),
      }),
      201,
    )
    expect(call).toMatchObject({ type: 'call', outcome: 'connected', durationMinutes: 12, canEdit: true })
    expect(call.links).toEqual({
      contacts: [{ id: contact.id, name: 'Åsa Öberg' }],
      companies: [{ id: company.id, name: 'Kund AB' }],
      deals: [{ id: deal.id, name: 'Licenser' }],
    })
    for (const [type, id] of [['deal', deal.id], ['contact', contact.id], ['company', company.id]]) {
      expect((await timeline(owner, type!, id!)).items.map((a) => a.id)).toEqual([call.id])
    }
  })

  it('a note on a contact also shows on its company, but not on unrelated records', async () => {
    const { owner, company, contact, deal } = await setup()
    const created = await expectStatus(owner.post('/api/activities', { type: 'note', record: { type: 'contact', id: contact.id }, body: note('Hej') }), 201)
    expect((await timeline(owner, 'company', company.id)).items.map((a) => a.id)).toEqual([created.id])
    expect((await timeline(owner, 'deal', deal.id)).items).toEqual([])
  })

  it('logging an activity on a stale deal makes it fresh again', async () => {
    const { owner, ws, deal } = await setup()
    await asSystemIn(ws.id, (tx) => tx.update(deals).set({ lastActivityAt: new Date('2026-01-01') }).where(eq(deals.id, deal.id)))
    expect((await expectStatus(owner.get(`/api/deals/${deal.id}`), 200)).stale).toBe(true)
    await expectStatus(owner.post('/api/activities', { type: 'meeting', record: { type: 'deal', id: deal.id }, subject: 'Demo' }), 201)
    expect((await expectStatus(owner.get(`/api/deals/${deal.id}`), 200)).stale).toBe(false)
  })

  it('pages the timeline newest first and keeps pinned notes on top', async () => {
    const { owner, contact } = await setup()
    const base = Date.parse('2026-10-01T08:00:00Z')
    const ids: string[] = []
    for (let i = 0; i < 35; i++) {
      const a = await expectStatus(
        owner.post('/api/activities', {
          type: 'note',
          record: { type: 'contact', id: contact.id },
          body: note(`Anteckning ${i}`),
          // Two share each timestamp, so the id tiebreak matters.
          occurredAt: new Date(base + Math.floor(i / 2) * 60_000).toISOString(),
        }),
        201,
      )
      ids.push(a.id)
    }
    await expectStatus(owner.patch(`/api/activities/${ids[0]}`, { pinned: true }), 200)

    const first = await timeline(owner, 'contact', contact.id)
    expect(first.pinned.map((a) => a.id)).toEqual([ids[0]])
    expect(first.items).toHaveLength(30)
    expect(first.nextCursor).toBeTruthy()
    const second = await timeline(owner, 'contact', contact.id, `&cursor=${encodeURIComponent(first.nextCursor!)}`)
    expect(second.pinned).toEqual([])
    expect(second.nextCursor).toBeNull()
    const all = [...first.items, ...second.items].map((a) => a.id)
    expect(all).toHaveLength(34)
    expect(new Set(all).size).toBe(34)
    expect(all).not.toContain(ids[0])
    const times = [...first.items, ...second.items].map((a) => a.occurredAt)
    expect(times).toEqual([...times].sort().reverse())

    const calls = await timeline(owner, 'contact', contact.id, '&types=call')
    expect(calls.items).toEqual([])
    expect(calls.pinned).toEqual([])
  })

  it('needs text in a note', async () => {
    const { owner, contact } = await setup()
    const res = await owner.post('/api/activities', { type: 'note', record: { type: 'contact', id: contact.id }, body: { type: 'doc', content: [{ type: 'paragraph' }] } })
    expect(res.statusCode).toBe(400)
  })

  it('viewers read timelines but cannot log; members edit only their own activities, admins any', async () => {
    const { owner, contact } = await setup()
    const viewer = await addMember(app, owner, 'viewer', 'Vera')
    const member = await addMember(app, owner, 'member', 'Erik')
    const admin = await addMember(app, owner, 'admin', 'Adam')
    const ownerNote = await expectStatus(owner.post('/api/activities', { type: 'note', record: { type: 'contact', id: contact.id }, body: note('Ägarens') }), 201)

    expect((await timeline(viewer.client, 'contact', contact.id)).items[0]!.canEdit).toBe(false)
    expect((await viewer.client.post('/api/activities', { type: 'note', record: { type: 'contact', id: contact.id }, body: note('x') })).statusCode).toBe(403)

    expect((await member.client.patch(`/api/activities/${ownerNote.id}`, { body: note('Ändrad') })).statusCode).toBe(403)
    expect((await member.client.delete(`/api/activities/${ownerNote.id}`)).statusCode).toBe(403)
    const memberNote = await expectStatus(member.client.post('/api/activities', { type: 'note', record: { type: 'contact', id: contact.id }, body: note('Eriks') }), 201)
    await expectStatus(member.client.patch(`/api/activities/${memberNote.id}`, { body: note('Eriks, ändrad') }), 200)

    await expectStatus(admin.client.patch(`/api/activities/${ownerNote.id}`, { pinned: true }), 200)
    await expectStatus(admin.client.delete(`/api/activities/${memberNote.id}`), 200)
    const after = await timeline(owner, 'contact', contact.id)
    expect(after.pinned.map((a) => a.id)).toEqual([ownerNote.id])
    expect(after.items).toEqual([])
  })

  it("cannot log on or read another workspace's records", async () => {
    const a = await setup()
    const b = await setup()
    const res = await a.owner.post('/api/activities', { type: 'note', record: { type: 'deal', id: b.deal.id }, body: note('Smyg') })
    expect(res.statusCode).toBe(400)
    await expectStatus(b.owner.post('/api/activities', { type: 'note', record: { type: 'deal', id: b.deal.id }, body: note('Hemligt') }), 201)
    expect((await timeline(a.owner, 'deal', b.deal.id)).items).toEqual([])
  })
})

describe('@mentions', () => {
  it('notifies the mentioned member once, with a link to the record', async () => {
    const { owner, ownerId, deal } = await setup()
    const erik = await addMember(app, owner, 'member', 'Erik')
    const outsider = new TestClient(app)
    await signUpVerified(outsider, 'Utomstående')
    const outsiderId = (await outsider.get('/api/me')).json().user.id

    const created = await expectStatus(
      owner.post('/api/activities', {
        type: 'note',
        record: { type: 'deal', id: deal.id },
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Kan du ringa, ' },
                { type: 'mention', attrs: { id: erik.userId, label: 'Erik' } },
                { type: 'mention', attrs: { id: ownerId, label: 'Olga' } },
                { type: 'mention', attrs: { id: outsiderId, label: 'Utomstående' } },
              ],
            },
          ],
        },
      }),
      201,
    )

    const inbox = await expectStatus(erik.client.get('/api/notifications'), 200)
    expect(inbox.unread).toBe(1)
    expect(inbox.items[0]).toMatchObject({
      type: 'mention',
      actor: 'Olga Owner',
      title: 'Kan du ringa, @Erik@Olga@Utomstående',
      record: { type: 'deal', id: deal.id, name: 'Licenser' },
      activityId: created.id,
      readAt: null,
    })
    // The author is not notified about mentioning themselves.
    expect((await expectStatus(owner.get('/api/notifications'), 200)).items).toEqual([])

    // Editing the note keeps Erik's mention: no second notification.
    await expectStatus(owner.patch(`/api/activities/${created.id}`, { body: mention('Påminnelse', { id: erik.userId, label: 'Erik' }) }), 200)
    expect((await expectStatus(erik.client.get('/api/notifications'), 200)).items).toHaveLength(1)
  })
})

describe('tasks', () => {
  it('groups my tasks into overdue, today and upcoming in my timezone, and completes them', async () => {
    const { owner, deal } = await setup()
    const yesterday = await expectStatus(owner.post('/api/tasks', { title: 'Igår', dueDate: stockholmDate(-1) }), 201)
    const today = await expectStatus(owner.post('/api/tasks', { title: 'Idag', dueDate: stockholmDate(0), record: { type: 'deal', id: deal.id } }), 201)
    const later = await expectStatus(owner.post('/api/tasks', { title: 'Nästa vecka', dueDate: stockholmDate(7), dueTime: '09:30', priority: 'high' }), 201)
    expect(yesterday.overdue).toBe(true)
    expect(today).toMatchObject({ overdue: false, record: { type: 'deal', id: deal.id, name: 'Licenser' }, assignee: { name: 'Olga Owner' } })

    let mine = (await expectStatus(owner.get('/api/tasks/my'), 200)) as MyTasks
    expect(mine.overdue.map((t) => t.id)).toEqual([yesterday.id])
    expect(mine.today.map((t) => t.id)).toEqual([today.id])
    expect(mine.upcoming.map((t) => t.id)).toEqual([later.id])

    await expectStatus(owner.patch(`/api/tasks/${yesterday.id}`, { completed: true }), 200)
    mine = await expectStatus(owner.get('/api/tasks/my'), 200)
    expect(mine.overdue).toEqual([])
    expect(mine.done.map((t) => t.id)).toEqual([yesterday.id])
    expect(mine.done[0]).toMatchObject({ completedBy: 'Olga Owner', overdue: false })

    await expectStatus(owner.patch(`/api/tasks/${yesterday.id}`, { completed: false }), 200)
    expect((await expectStatus(owner.get('/api/tasks/my'), 200)).overdue.map((t: Task) => t.id)).toEqual([yesterday.id])
  })

  it('stores when a task becomes overdue in the assignee timezone', async () => {
    const { owner } = await setup()
    const allDay = await expectStatus(owner.post('/api/tasks', { title: 'Heldag', dueDate: '2026-11-09' }), 201)
    expect(allDay.dueAt).toBe('2026-11-09T23:00:00.000Z')
    const timed = await expectStatus(owner.post('/api/tasks', { title: 'Morgon', dueDate: '2026-07-01', dueTime: '09:30' }), 201)
    expect(timed).toMatchObject({ dueTime: '09:30', dueAt: '2026-07-01T07:30:00.000Z' })

    await expectStatus(owner.patch('/api/me', { timezone: 'America/New_York' }), 200)
    const mine = (await expectStatus(owner.get('/api/tasks/my'), 200)) as MyTasks
    const moved = [...mine.overdue, ...mine.today, ...mine.upcoming].find((t) => t.id === timed.id)
    expect(moved!.dueAt).toBe('2026-07-01T13:30:00.000Z')
    expect((await owner.patch('/api/me', { timezone: 'Mars/Olympus' })).statusCode).toBe(400)
  })

  it('assigning a task to a colleague puts it in their list, not mine, and notifies them', async () => {
    const { owner, contact } = await setup()
    const erik = await addMember(app, owner, 'member', 'Erik')
    const task = await expectStatus(
      owner.post('/api/tasks', { title: 'Ring Åsa', dueDate: stockholmDate(1), assigneeUserId: erik.userId, record: { type: 'contact', id: contact.id } }),
      201,
    )
    expect((await expectStatus(owner.get('/api/tasks/my'), 200)).upcoming).toEqual([])
    expect((await expectStatus(erik.client.get('/api/tasks/my'), 200)).upcoming.map((t: Task) => t.id)).toEqual([task.id])
    expect((await expectStatus(owner.get(`/api/tasks/my?assignee=${erik.userId}`), 200)).upcoming.map((t: Task) => t.id)).toEqual([task.id])

    const inbox = await expectStatus(erik.client.get('/api/notifications'), 200)
    expect(inbox.items[0]).toMatchObject({ type: 'task_assigned', actor: 'Olga Owner', title: 'Ring Åsa', taskId: task.id, record: { type: 'contact', id: contact.id } })

    // Assigning to someone outside the workspace is refused.
    const outsider = new TestClient(app)
    await signUpVerified(outsider)
    const outsiderId = (await outsider.get('/api/me')).json().user.id
    expect((await owner.patch(`/api/tasks/${task.id}`, { assigneeUserId: outsiderId })).statusCode).toBe(400)
  })

  it('shows the next open task on the deal and hides tasks of records in Trash', async () => {
    const { owner, contact, deal } = await setup()
    await expectStatus(owner.post('/api/tasks', { title: 'Senare', dueDate: stockholmDate(5), record: { type: 'deal', id: deal.id } }), 201)
    await expectStatus(owner.post('/api/tasks', { title: 'Först', dueDate: stockholmDate(2), dueTime: '10:00', record: { type: 'deal', id: deal.id } }), 201)
    const done = await expectStatus(owner.post('/api/tasks', { title: 'Klar', dueDate: stockholmDate(1), record: { type: 'deal', id: deal.id } }), 201)
    await expectStatus(owner.patch(`/api/tasks/${done.id}`, { completed: true }), 200)

    const pipelineId = (await expectStatus(owner.get(`/api/deals/${deal.id}`), 200)).pipeline.id
    const board = await expectStatus(owner.get(`/api/deals/board?pipelineId=${pipelineId}`), 200)
    const card = board.columns.flatMap((c: { deals: unknown[] }) => c.deals).find((d: { id: string }) => d.id === deal.id)
    expect(card.nextTask).toEqual({ dueDate: stockholmDate(2), dueTime: '10:00', overdue: false })

    const onDeal = await expectStatus(owner.get(`/api/tasks?type=deal&id=${deal.id}`), 200)
    expect(onDeal.open.map((t: Task) => t.title)).toEqual(['Först', 'Senare'])
    expect(onDeal.done.map((t: Task) => t.title)).toEqual(['Klar'])

    await expectStatus(owner.post('/api/tasks', { title: 'Om kontakten', dueDate: stockholmDate(1), record: { type: 'contact', id: contact.id } }), 201)
    await expectStatus(owner.delete(`/api/contacts/${contact.id}`), 200)
    const mine = (await expectStatus(owner.get('/api/tasks/my'), 200)) as MyTasks
    expect(mine.upcoming.map((t) => t.title)).not.toContain('Om kontakten')
  })

  it('viewers cannot create tasks', async () => {
    const { owner } = await setup()
    const viewer = await addMember(app, owner, 'viewer', 'Vera')
    expect((await viewer.client.post('/api/tasks', { title: 'x', dueDate: stockholmDate(0) })).statusCode).toBe(403)
    await expectStatus(viewer.client.get('/api/tasks/my'), 200)
  })
})

describe('task reminders', () => {
  it('emails the assignee once, in their language, and adds a notification', async () => {
    const { owner, deal, ws } = await setup()
    const erik = await addMember(app, owner, 'member', 'Erik')
    const task = await expectStatus(
      owner.post('/api/tasks', { title: 'Skicka offert', dueDate: stockholmDate(0), dueTime: '23:59', assigneeUserId: erik.userId, record: { type: 'deal', id: deal.id } }),
      201,
    )
    const job = { tenantId: ws.id, userId: erik.userId, taskId: task.id, dueDate: task.dueDate }
    const ctx = { tenantId: ws.id, userId: erik.userId, role: 'member' as const }
    const before = outbox.length
    expect(await withTenant(ctx, (tx) => sendTaskReminder(tx, job))).toBe(true)
    const email = outbox.slice(before).find((m) => m.to === erik.email)
    expect(email).toMatchObject({ subject: 'Påminnelse: Skicka offert' })
    expect(email!.text).toContain('idag kl. 23:59')
    expect(email!.text).toContain('Gäller: Licenser')
    expect(email!.text).toContain('http://localhost:5173/tasks')

    // Second run (retry or duplicate job): nothing more.
    expect(await withTenant(ctx, (tx) => sendTaskReminder(tx, job))).toBe(false)
    const inbox = await expectStatus(erik.client.get('/api/notifications'), 200)
    expect(inbox.items.map((n: { type: string }) => n.type)).toEqual(['task_reminder', 'task_assigned'])
    expect(inbox.items[0].actor).toBeNull()
  })

  it('sends nothing to someone who was removed from the workspace', async () => {
    const { owner, ws } = await setup()
    const erik = await addMember(app, owner, 'member', 'Erik')
    const task = await expectStatus(owner.post('/api/tasks', { title: 'Hemligt', dueDate: stockholmDate(0), assigneeUserId: erik.userId }), 201)
    await expectStatus(owner.delete(`/api/workspace/members/${erik.userId}`), 200)
    const ctx = { tenantId: ws.id, userId: erik.userId, role: 'system' as const }
    const before = outbox.length
    expect(await withTenant(ctx, (tx) => sendTaskReminder(tx, { tenantId: ws.id, userId: erik.userId, taskId: task.id, dueDate: task.dueDate }))).toBe(false)
    expect(outbox.slice(before).filter((m) => m.to === erik.email)).toEqual([])
  })

  it('skips completed, reassigned and rescheduled tasks', async () => {
    const { owner, ownerId, ws } = await setup()
    const erik = await addMember(app, owner, 'member', 'Erik')
    const task = await expectStatus(owner.post('/api/tasks', { title: 'Gammal', dueDate: stockholmDate(0) }), 201)
    const ctx = { tenantId: ws.id, userId: ownerId, role: 'owner' as const }
    const job = { tenantId: ws.id, userId: ownerId, taskId: task.id, dueDate: task.dueDate }

    await expectStatus(owner.patch(`/api/tasks/${task.id}`, { dueDate: stockholmDate(3) }), 200)
    expect(await withTenant(ctx, (tx) => sendTaskReminder(tx, job))).toBe(false)
    await expectStatus(owner.patch(`/api/tasks/${task.id}`, { dueDate: stockholmDate(0), assigneeUserId: erik.userId }), 200)
    expect(await withTenant(ctx, (tx) => sendTaskReminder(tx, job))).toBe(false)
    await expectStatus(owner.patch(`/api/tasks/${task.id}`, { assigneeUserId: ownerId, completed: true }), 200)
    expect(await withTenant(ctx, (tx) => sendTaskReminder(tx, job))).toBe(false)
  })
})

describe('notifications', () => {
  it('marks one or all as read; nobody else can mark mine', async () => {
    const { owner, ownerId } = await setup()
    const erik = await addMember(app, owner, 'member', 'Erik')
    for (const title of ['Ett', 'Två']) {
      await expectStatus(erik.client.post('/api/tasks', { title, dueDate: stockholmDate(1), assigneeUserId: ownerId }), 201)
    }
    const inbox = await expectStatus(owner.get('/api/notifications'), 200)
    expect(inbox.unread).toBe(2)
    expect((await erik.client.post(`/api/notifications/${inbox.items[0].id}/read`)).statusCode).toBe(404)
    await expectStatus(owner.post(`/api/notifications/${inbox.items[0].id}/read`), 200)
    expect((await expectStatus(owner.get('/api/notifications'), 200)).unread).toBe(1)
    await expectStatus(owner.post('/api/notifications/read-all'), 200)
    expect((await expectStatus(owner.get('/api/notifications'), 200)).unread).toBe(0)
  })
})

describe('erasing records', () => {
  it('erases activities that were only on the erased record, and keeps shared ones', async () => {
    const { owner, ownerId, ws, contact, deal } = await setup()
    const onlyContact = await expectStatus(owner.post('/api/activities', { type: 'note', record: { type: 'contact', id: contact.id }, body: note('Bara kontakt') }), 201)
    const onDeal = await expectStatus(owner.post('/api/activities', { type: 'note', record: { type: 'deal', id: deal.id }, body: note('Affär') }), 201)
    await expectStatus(owner.post('/api/tasks', { title: 'Om kontakten', dueDate: stockholmDate(1), record: { type: 'contact', id: contact.id } }), 201)
    await expectStatus(owner.delete(`/api/contacts/${contact.id}`), 200)

    const ctx = { tenantId: ws.id, userId: ownerId, role: 'owner' as const }
    await withTenant(ctx, (tx) => tx.update(contacts).set({ deletedAt: sql`now() - interval '31 days'` }).where(eq(contacts.id, contact.id)))
    expect(await withTenant(ctx, (tx) => purgeRecord(tx, { tenantId: ws.id, userId: ownerId, type: 'contact', id: contact.id }))).toBe(true)

    const left = await withTenant(ctx, (tx) => tx.select({ id: activities.id }).from(activities))
    // The company link keeps the contact-only note visible on the company timeline.
    expect(left.map((a) => a.id).sort()).toEqual([onlyContact.id, onDeal.id].sort())
    expect(await withTenant(ctx, (tx) => tx.select().from(tasks))).toEqual([])
  })

  it('erases an activity whose only record is erased', async () => {
    const { owner, ownerId, ws, company } = await setup()
    const solo = await expectStatus(owner.post('/api/contacts', { firstName: 'Ensam' }), 201)
    await expectStatus(owner.post('/api/activities', { type: 'note', record: { type: 'contact', id: solo.id }, body: note('Försvinner') }), 201)
    await expectStatus(owner.delete(`/api/contacts/${solo.id}`), 200)
    const ctx = { tenantId: ws.id, userId: ownerId, role: 'owner' as const }
    await withTenant(ctx, (tx) => tx.update(contacts).set({ deletedAt: sql`now() - interval '31 days'` }).where(eq(contacts.id, solo.id)))
    await withTenant(ctx, (tx) => purgeRecord(tx, { tenantId: ws.id, userId: ownerId, type: 'contact', id: solo.id }))
    expect((await timeline(owner, 'company', company.id)).items).toEqual([])
    expect(await withTenant(ctx, (tx) => tx.select().from(activities))).toEqual([])
  })
})
