import { and, eq, isNull } from 'drizzle-orm'
import type { RecordRef } from '@crm/shared'
import type { Tx } from '../db/client.js'
import { companies, contacts, deals } from '../db/schema.js'
import { HttpError } from '../errors.js'

export type NamedRecord = RecordRef & { name: string }

// Name of a live (not deleted) contact, company or deal; null if it is missing or in Trash.
export async function recordName(tx: Tx, ref: RecordRef): Promise<NamedRecord | null> {
  if (ref.type === 'contact') {
    const [c] = await tx
      .select({ first: contacts.firstName, last: contacts.lastName })
      .from(contacts)
      .where(and(eq(contacts.id, ref.id), isNull(contacts.deletedAt)))
    return c ? { ...ref, name: `${c.first} ${c.last}`.trim() } : null
  }
  const table = ref.type === 'company' ? companies : deals
  const [r] = await tx
    .select({ name: table.name })
    .from(table)
    .where(and(eq(table.id, ref.id), isNull(table.deletedAt)))
  return r ? { ...ref, name: r.name } : null
}

export async function requireRecord(tx: Tx, ref: RecordRef): Promise<NamedRecord> {
  const found = await recordName(tx, ref)
  if (!found) throw new HttpError(400, 'validation_error', 'Record not found', [{ message: 'invalid_record' }])
  return found
}

// Column values for tables that point at one record (tasks).
export const recordColumns = (ref: RecordRef | null | undefined) => ({
  contactId: ref?.type === 'contact' ? ref.id : null,
  companyId: ref?.type === 'company' ? ref.id : null,
  dealId: ref?.type === 'deal' ? ref.id : null,
})
