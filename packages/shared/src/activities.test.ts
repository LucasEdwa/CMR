import { describe, expect, it } from 'vitest'
import { createActivitySchema, createTaskSchema, mentionedUserIds, richDocSchema, richTextToPlain, type RichDoc } from './activities.js'

const anna = '0b6f3c56-3f3e-4b8f-9a3e-1d2c3b4a5f60'
const erik = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

const doc: RichDoc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Ring ' }, { type: 'mention', attrs: { id: erik, label: 'Erik' } }, { type: 'text', text: ' imorgon', marks: [{ type: 'bold' }] }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pris' }] }] }] },
    { type: 'paragraph', content: [{ type: 'mention', attrs: { id: anna, label: 'Anna' } }, { type: 'mention', attrs: { id: erik, label: 'Erik' } }] },
  ],
}

describe('rich text', () => {
  it('turns a document into plain text with @names', () => {
    expect(richTextToPlain(doc)).toBe('Ring @Erik imorgon\nPris\n@Anna@Erik')
  })

  it('lists each mentioned user once', () => {
    expect(mentionedUserIds(doc)).toEqual([erik, anna])
  })

  it('rejects node types outside the allowlist', () => {
    const bad = { type: 'doc', content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }] }
    expect(richDocSchema.safeParse(bad).success).toBe(false)
  })

  it('strips unknown attributes and marks', () => {
    const input = {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { onclick: 'x' }, content: [{ type: 'text', text: 'hej', marks: [{ type: 'bold', attrs: { style: 'x' } }] }] }],
    }
    expect(richDocSchema.parse(input)).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hej', marks: [{ type: 'bold' }] }] }] })
    const link = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link' }] }] }] }
    expect(richDocSchema.safeParse(link).success).toBe(false)
  })
})

describe('createActivitySchema', () => {
  const record = { type: 'deal', id: anna } as const
  it('requires text in a note', () => {
    expect(createActivitySchema.safeParse({ type: 'note', record, body: { type: 'doc', content: [{ type: 'paragraph' }] } }).success).toBe(false)
    expect(createActivitySchema.safeParse({ type: 'note', record, subject: 'Only a subject' }).success).toBe(false)
  })
  it('accepts a call with only a subject', () => {
    expect(createActivitySchema.safeParse({ type: 'call', record, subject: 'Uppföljning', outcome: 'connected', durationMinutes: 5 }).success).toBe(true)
  })
})

describe('createTaskSchema', () => {
  it('treats an empty time as all day and defaults the priority', () => {
    expect(createTaskSchema.parse({ title: 'Ring Åsa', dueDate: '2026-11-09', dueTime: '' })).toMatchObject({ dueTime: null, priority: 'normal' })
  })
  it('rejects impossible times', () => {
    expect(createTaskSchema.safeParse({ title: 'x', dueDate: '2026-11-09', dueTime: '24:00' }).success).toBe(false)
  })
})
