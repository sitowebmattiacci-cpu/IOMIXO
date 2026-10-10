import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { firestore } from '../lib/firebaseAdmin'

/**
 * Generic one-way projection of a Supabase table whose rows belong to a session into
 * events/{eventId}/<collection>/{id} (music requests, dedications, ...).
 * Supabase stays authoritative; docs carry `legacySupabaseId`. Optional server counter at events/{id}/state/<counter>.
 */
export interface ChildSpec {
  collection: string
  /** Name of the counter document under events/{id}/state, if the domain keeps one. */
  counter?: string
}

const events = () => firestore().collection('events')

export async function eventRefByLegacySession(sessionId: string) {
  const q = await events().where('legacySupabaseId', '==', sessionId).limit(1).get()
  return q.empty ? null : q.docs[0].ref
}
async function childByLegacyId(eventRef: FirebaseFirestore.DocumentReference, spec: ChildSpec, legacyId: string) {
  const q = await eventRef.collection(spec.collection).where('legacySupabaseId', '==', legacyId).limit(1).get()
  return q.empty ? null : q.docs[0]
}

/** Idempotent. Returns false when the event is not projected or the row already is. */
export async function projectChildCreated(
  spec: ChildSpec, sessionId: string, legacyId: string, fields: Record<string, unknown>, createdAt?: string,
): Promise<boolean> {
  const eventRef = await eventRefByLegacySession(sessionId)
  if (!eventRef || (await childByLegacyId(eventRef, spec, legacyId))) return false

  const counter = spec.counter ? eventRef.collection('state').doc(spec.counter) : null
  const ref = eventRef.collection(spec.collection).doc()
  await firestore().runTransaction(async (tx) => {
    const c = counter ? await tx.get(counter) : null
    tx.set(ref, {
      ...fields,
      legacySupabaseId: legacyId,
      createdAt: createdAt ? Timestamp.fromDate(new Date(createdAt)) : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    // Only bump an existing counter: a missing one is seeded from Supabase by the Function on first use.
    if (counter && c?.exists) tx.update(counter, { total: (c.data()!.total as number) + 1, updatedAt: FieldValue.serverTimestamp() })
  })
  return true
}

export async function projectChildStatus(spec: ChildSpec, sessionId: string, legacyId: string, status: string): Promise<boolean> {
  const eventRef = await eventRefByLegacySession(sessionId)
  const doc = eventRef && (await childByLegacyId(eventRef, spec, legacyId))
  if (!doc) return false
  await doc.ref.update({ status, updatedAt: FieldValue.serverTimestamp() })
  return true
}

export async function projectChildDeleted(spec: ChildSpec, sessionId: string, legacyId: string): Promise<boolean> {
  const eventRef = await eventRefByLegacySession(sessionId)
  const doc = eventRef && (await childByLegacyId(eventRef, spec, legacyId))
  if (!doc || !eventRef) return false
  const counter = spec.counter ? eventRef.collection('state').doc(spec.counter) : null
  await firestore().runTransaction(async (tx) => {
    const c = counter ? await tx.get(counter) : null
    tx.delete(doc.ref)
    if (counter && c?.exists) tx.update(counter, { total: Math.max(0, (c.data()!.total as number) - 1), updatedAt: FieldValue.serverTimestamp() })
  })
  return true
}
