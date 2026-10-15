import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { fail } from '../shared/guard'
import { idField, requireEventOwner, requireOwnerEventAccess, type CallerAuth } from './guard'

export const MODERATION_STATUSES = ['pending', 'approved', 'rejected'] as const
export type ModerationStatus = typeof MODERATION_STATUSES[number]

export interface ModerationInput { eventId: string; itemId: string; action: 'set_status' | 'delete'; status?: ModerationStatus }

/** Only eventId, the item id and the action are read from the client. */
export function parseModerationInput(data: unknown, idKey: 'requestId' | 'dedicationId'): ModerationInput {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const eventId = idField(d.eventId, 'eventId'), itemId = idField(d[idKey], idKey)
  if (d.action === 'delete') return { eventId, itemId, action: 'delete' }
  if (d.action === 'set_status' && (MODERATION_STATUSES as readonly unknown[]).includes(d.status)) {
    return { eventId, itemId, action: 'set_status', status: d.status as ModerationStatus }
  }
  throw new HttpsError('invalid-argument', 'invalid action/status', { reason: 'invalid_payload', field: 'action' })
}

export interface ModerationResult { changed: boolean; status?: ModerationStatus; deleted?: boolean }

/** Music requests: approve / reject / reset to pending / delete. Idempotent. Deleting also frees one slot of the event counter. */
export async function moderateRequest(db: Firestore, request: CallerAuth, input: ModerationInput): Promise<ModerationResult> {
  const { ref: eventRef } = await requireEventOwner(db, request, input.eventId, { djOnly: true })
  const reqRef = eventRef.collection('requests').doc(input.itemId)
  const counterRef = eventRef.collection('state').doc('requests')
  return db.runTransaction(async (tx) => {
    const [snap, counter] = await Promise.all([tx.get(reqRef), tx.get(counterRef)])
    if (!snap.exists) {
      if (input.action === 'delete') return { changed: false, deleted: true }       // already gone: idempotent
      throw fail('not-found', 'Request not found', 'request_not_found')
    }
    if (input.action === 'delete') {
      tx.delete(reqRef)
      if (counter.exists) tx.update(counterRef, { total: Math.max(0, (counter.data()!.total as number) - 1), updatedAt: FieldValue.serverTimestamp() })
      return { changed: true, deleted: true }
    }
    if (snap.data()!.status === input.status) return { changed: false, status: input.status }
    tx.update(reqRef, { status: input.status, updatedAt: FieldValue.serverTimestamp() })
    return { changed: true, status: input.status }
  })
}

/** Dedications: same actions. Changing the status needs the premium gate (like the legacy PATCH); deleting does not (like the legacy DELETE). */
export async function moderateDedication(db: Firestore, request: CallerAuth, input: ModerationInput): Promise<ModerationResult> {
  const { ref: eventRef, data } = await requireEventOwner(db, request, input.eventId, { djOnly: true })
  if (input.action === 'set_status') await requireOwnerEventAccess(db, input.eventId, data, 'moderateDedication')
  const dedRef = eventRef.collection('dedications').doc(input.itemId)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(dedRef)
    if (!snap.exists) {
      if (input.action === 'delete') return { changed: false, deleted: true }
      throw fail('not-found', 'Dedication not found', 'dedication_not_found')
    }
    if (input.action === 'delete') { tx.delete(dedRef); return { changed: true, deleted: true } }
    if (snap.data()!.status === input.status) return { changed: false, status: input.status }
    tx.update(dedRef, { status: input.status, updatedAt: FieldValue.serverTimestamp() })
    return { changed: true, status: input.status }
  })
}
