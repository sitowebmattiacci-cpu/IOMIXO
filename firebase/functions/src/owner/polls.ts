import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { str } from '../requests/validation'
import { fail } from '../shared/guard'
import { MAX_OPTIONS } from '../polls/validation'
import { idField, requireEventOwner, requireOwnerEventAccess, type CallerAuth } from './guard'

export const POLL_LIMITS = { question: 200, option: 80, minOptions: 2, maxOptions: MAX_OPTIONS } as const

export interface CreatePollInput { eventId: string; question: string; options: string[] }
export interface SetPollStatusInput { eventId: string; pollId: string; open: boolean }

export function parseCreatePollInput(data: unknown): CreatePollInput {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const eventId = idField(d.eventId, 'eventId')
  const question = str(d.question, 'question', POLL_LIMITS.question, true)!
  if (!Array.isArray(d.options)) throw new HttpsError('invalid-argument', 'options required', { reason: 'invalid_payload', field: 'options' })
  const options = d.options.map((o) => str(o, 'options', POLL_LIMITS.option, true)!)
  if (options.length < POLL_LIMITS.minOptions || options.length > POLL_LIMITS.maxOptions) {
    throw new HttpsError('invalid-argument', 'a poll needs 2-4 options', { reason: 'invalid_payload', field: 'options' })
  }
  return { eventId, question, options }
}
export function parseSetPollStatusInput(data: unknown): SetPollStatusInput {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  if (typeof d.open !== 'boolean') throw new HttpsError('invalid-argument', 'open must be a boolean', { reason: 'invalid_payload', field: 'open' })
  return { eventId: idField(d.eventId, 'eventId'), pollId: idField(d.pollId, 'pollId'), open: d.open }
}

/** Polls exist only for Party / Wedding events (legacy isEventSession) and need the premium gate. */
async function pollsGate(db: Firestore, request: CallerAuth, eventId: string, fn: string) {
  const owner = await requireEventOwner(db, request, eventId)
  if (owner.data.type !== 'party' && owner.data.type !== 'wedding') throw fail('failed-precondition', 'Polls are for Party / Wedding events', 'polls_unavailable')
  await requireOwnerEventAccess(db, eventId, owner.data, fn)
  return owner
}

/** Creates a poll and closes the previously open ones, atomically (legacy behaviour). The result is readable by guests right away. */
export async function createPoll(db: Firestore, request: CallerAuth, input: CreatePollInput): Promise<{ pollId: string; closedPollIds: string[] }> {
  const { ref: eventRef } = await pollsGate(db, request, input.eventId, 'createPoll')
  const polls = eventRef.collection('polls'), pollRef = polls.doc()
  return db.runTransaction(async (tx) => {
    const open = await tx.get(polls.where('status', '==', 'open').limit(50))
    open.docs.forEach((p) => tx.update(p.ref, { status: 'closed', updatedAt: FieldValue.serverTimestamp() }))
    tx.create(pollRef, { question: input.question, options: input.options, status: 'open', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    return { pollId: pollRef.id, closedPollIds: open.docs.map((p) => p.id) }
  })
}

/** Opens / closes one poll. Idempotent. Opening does not close the others (legacy PATCH semantics: the newest open poll is the active one). */
export async function setPollStatus(db: Firestore, request: CallerAuth, input: SetPollStatusInput): Promise<{ changed: boolean; status: 'open' | 'closed' }> {
  const { ref: eventRef } = await pollsGate(db, request, input.eventId, 'setPollStatus')
  const pollRef = eventRef.collection('polls').doc(input.pollId), status = input.open ? 'open' as const : 'closed' as const
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(pollRef)
    if (!snap.exists) throw fail('not-found', 'Poll not found', 'poll_not_found')
    if (snap.data()!.status === status) return { changed: false, status }
    tx.update(pollRef, { status, updatedAt: FieldValue.serverTimestamp() })
    return { changed: true, status }
  })
}
