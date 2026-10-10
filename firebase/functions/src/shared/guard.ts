import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https'
import { FieldValue, Timestamp, type Firestore, type DocumentReference, type DocumentData } from 'firebase-admin/firestore'

/**
 * Building blocks shared by the guest-facing callables (music requests, dedications):
 * error format, "event is live" check, atomic anti-spam reservation, rollback, projection write.
 */

/** Every business error carries `details.reason`, which the client maps to a message / fallback decision. */
export const fail = (code: FunctionsErrorCode, message: string, reason: string, extra: Record<string, unknown> = {}) =>
  new HttpsError(code, message, { reason, ...extra })

export interface LiveEvent { ref: DocumentReference; data: DocumentData }

/** The event must exist and be live. Type/feature checks stay with each callable. */
export async function loadLiveEvent(db: Firestore, eventId: string): Promise<LiveEvent> {
  const ref = db.collection('events').doc(eventId)
  const snap = await ref.get()
  if (!snap.exists) throw fail('not-found', 'Event not found', 'event_not_found')
  const data = snap.data()!
  if (data.status !== 'live') throw fail('failed-precondition', 'This live session has ended', 'event_ended')
  return { ref, data }
}

export interface Reservation {
  /** events/{id}/<guests>/{uid}: { count, lastAt } — per-guest anti-spam state. */
  guestRef: DocumentReference
  /** Optional event-wide counter { total } and its cap (null = unlimited). */
  counterRef?: DocumentReference
  limit?: number | null
  /** Initial value of the counter when its document does not exist yet. */
  seed?: number
  cooldownMs: number
  maxPerGuest: number
  /** Business-error reasons, so each domain keeps its own vocabulary. */
  reasons?: { cooldown?: string; guest?: string; event?: string }
  now: number
}

/**
 * Atomic reservation of one submission slot (cooldown + per-guest cap + optional event cap).
 * Runs in a Firestore transaction, so concurrent calls cannot bypass the limits.
 * Returns the previous `lastAt` for rollback.
 */
export async function reserveSlot(db: Firestore, r: Reservation): Promise<Timestamp | null> {
  const reasons = { cooldown: 'cooldown', guest: 'guest_limit', event: 'event_limit', ...r.reasons }
  let previousLastAt: Timestamp | null = null
  await db.runTransaction(async (tx) => {
    const [guest, counter] = await Promise.all([tx.get(r.guestRef), r.counterRef ? tx.get(r.counterRef) : Promise.resolve(null)])
    const g = guest.exists ? guest.data()! : { count: 0, lastAt: null as Timestamp | null }
    previousLastAt = g.lastAt
    const total = counter ? (counter.exists ? (counter.data()!.total as number) : r.seed ?? 0) : 0

    if (g.lastAt && r.now - g.lastAt.toMillis() < r.cooldownMs) {
      throw fail('resource-exhausted', 'Please wait before sending again', reasons.cooldown,
        { retryAfterMs: r.cooldownMs - (r.now - g.lastAt.toMillis()) })
    }
    if (g.count >= r.maxPerGuest) throw fail('resource-exhausted', 'Limit per guest reached', reasons.guest)
    if (r.counterRef && r.limit != null && total >= r.limit) throw fail('resource-exhausted', 'Event limit reached', reasons.event)

    if (r.counterRef) tx.set(r.counterRef, { total: total + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    tx.set(r.guestRef, { count: g.count + 1, lastAt: Timestamp.fromMillis(r.now) }, { merge: true })
  })
  return previousLastAt
}

/** Undo a reservation after a downstream failure (best effort, logged). */
export async function releaseSlot(db: Firestore, r: Pick<Reservation, 'guestRef' | 'counterRef'>, previousLastAt: Timestamp | null, tag: string) {
  await db.runTransaction(async (tx) => {
    const [guest, counter] = await Promise.all([tx.get(r.guestRef), r.counterRef ? tx.get(r.counterRef) : Promise.resolve(null)])
    if (counter?.exists) tx.update(r.counterRef!, { total: Math.max(0, (counter.data()!.total as number) - 1) })
    if (guest.exists) tx.update(r.guestRef, { count: Math.max(0, (guest.data()!.count as number) - 1), lastAt: previousLastAt })
  }).catch((err) => console.error(`[${tag}] rollback failed`, err))
}

/** Writes the Firestore projection with retries. false = not projected (the legacy row still exists). */
export async function createWithRetry(ref: DocumentReference, doc: DocumentData, tag: string, retries = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try { await ref.create(doc); return true }
    catch (e) { console.error(`[${tag}] projection write failed (attempt ${attempt})`, (e as Error).message) }
  }
  return false
}
