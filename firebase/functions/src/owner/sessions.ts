import { createHash, randomInt } from 'node:crypto'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { str } from '../requests/validation'
import { fail } from '../shared/guard'
import { loadEntitlements } from '../entitlements/load'
import { idField, requireAccount, requireEventOwner, loadAccountType, type CallerAuth } from './guard'

/**
 * Event lifecycle for the owner, Firestore-authoritative (no Supabase write): create / soft delete / restore.
 * Core field edits (title, djName, ...) stay in updateEventConfig(eventFields); the type and the slug are immutable after creation
 * (as in the legacy PATCH: it never accepted session_type or public_slug).
 */
export const SESSION_LIMITS = { title: 200, djName: 120, description: 2000, coupleNames: 200, weddingDate: 32, venueName: 200, requestId: 64 } as const
export type EventType = 'standard' | 'party' | 'wedding'
/** What an album is for. Orthogonal to `type`: every MIOLOVE album stays type 'wedding' (routing, permissions, Wedding UI). */
export type OccasionType = 'wedding' | 'birthday' | 'baptism' | 'other'
const OCCASIONS: readonly OccasionType[] = ['wedding', 'birthday', 'baptism', 'other']
/**
 * How a MIOLOVE (couple) album got its access. Written ONLY by createEvent for couple accounts; every other event (DJ, Party, legacy,
 * events created before this field) has no value, and a missing value NEVER means trial.
 *   'trial'     free first album of a couple account with no paid access (the one-time reservation trialAlbums/{uid} points at it)
 *   'activated' created while the couple already had paid access (Advance plan or Event Pass), unrelated to the trial
 */
export type AccessMode = 'trial' | 'activated'

export interface CreateEventInput {
  requestId: string; title: string; djName: string | null; description: string | null; type: EventType
  coupleNames: string | null; weddingDate: string | null; venueName: string | null; screenModeEnabled: boolean
  occasionType: OccasionType | null
}

export function parseCreateEventInput(data: unknown): CreateEventInput {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const requestId = str(d.requestId, 'requestId', SESSION_LIMITS.requestId, true)!
  if (!/^[A-Za-z0-9_-]+$/.test(requestId)) throw new HttpsError('invalid-argument', 'invalid requestId', { reason: 'invalid_payload', field: 'requestId' })
  const type: EventType = d.type === 'wedding' ? 'wedding' : d.type === 'party' ? 'party' : 'standard'
  const wedding = type === 'wedding'
  return {
    requestId,
    title: str(d.title, 'title', SESSION_LIMITS.title, true)!,
    djName: str(d.djName, 'djName', SESSION_LIMITS.djName, false),
    description: str(d.description, 'description', SESSION_LIMITS.description, false),
    type,
    // Wedding-only fields, exactly like the legacy insert.
    coupleNames: wedding ? str(d.coupleNames, 'coupleNames', SESSION_LIMITS.coupleNames, false) : null,
    weddingDate: wedding ? str(d.weddingDate, 'weddingDate', SESSION_LIMITS.weddingDate, false) : null,
    venueName: wedding ? str(d.venueName, 'venueName', SESSION_LIMITS.venueName, false) : null,
    screenModeEnabled: wedding && d.screenModeEnabled === true,
    // Only Wedding-type events carry an occasion; a missing value means "wedding" (every event created before this field).
    occasionType: wedding ? parseOccasion(d.occasionType) : null,
  }
}

function parseOccasion(raw: unknown): OccasionType {
  if (raw === undefined || raw === null || raw === '') return 'wedding'
  if (typeof raw !== 'string' || !OCCASIONS.includes(raw as OccasionType)) throw new HttpsError('invalid-argument', 'occasionType invalid', { reason: 'invalid_payload', field: 'occasionType' })
  return raw as OccasionType
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const randomSlug = (length: number) => Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')

/** Same id for the same (account, requestId): a retried / double-clicked create returns the event it already made. */
export const eventIdFor = (uid: string, requestId: string) => 'e' + createHash('sha256').update(`${uid}:${requestId}`).digest('hex').slice(0, 24)

/** Live (not ended, not deleted) events of an owner: what the plan's maxActiveSessions counts. */
async function countActiveEvents(db: Firestore, uid: string): Promise<number> {
  const snap = await db.collection('events').where('ownerUid', '==', uid).where('status', '==', 'live').limit(500).get()
  return snap.docs.filter((d) => !d.data().deletedAt).length
}

/**
 * One free MIOLOVE trial album per couple account. trialAlbums/{uid} is the reservation: created in the SAME transaction as the event, never deleted
 * (not by deleteEvent either, so deleting the trial album does not hand out another one), and denied to every client by the rules' default.
 */
const TRIAL_EXISTS = 'miolove_trial_album_exists'
const trialReservation = (db: Firestore, uid: string) => db.collection('trialAlbums').doc(uid)

/** A couple account that already owns a (not deleted) album cannot start a free trial: it is not its first album. */
async function assertNoOwnedAlbum(db: Firestore, uid: string): Promise<void> {
  const owned = await db.collection('events').where('ownerUid', '==', uid).limit(500).get()
  if (owned.docs.some((d) => !d.data().deletedAt)) throw fail('already-exists', 'This account already has an album', TRIAL_EXISTS)
}

/** Replacement of POST /api/live/sessions. Plan gates are decided here from users/{uid}.plan + eventPasses (clients never decide). */
export async function createEvent(db: Firestore, request: CallerAuth, input: CreateEventInput): Promise<{ eventId: string; slug: string; created: boolean }> {
  const uid = requireAccount(request)
  const accountType = await loadAccountType(db, uid)
  // Couple accounts can only create Wedding events (no Party / standard sessions).
  if (input.type !== 'wedding' && accountType === 'couple') {
    throw fail('permission-denied', 'Couple accounts can only create Wedding events', 'wedding_only')
  }
  const eventId = eventIdFor(uid, input.requestId)
  const ref = db.collection('events').doc(eventId)

  const existing = await ref.get()
  if (existing.exists) {
    const e = existing.data()!
    if (e.ownerUid !== uid) throw fail('already-exists', 'Request id already used', 'request_id_conflict')
    return { eventId, slug: String(e.slug), created: false }                       // idempotent replay
  }

  const ent = await loadEntitlements(db, { uid })
  // MIOLOVE: a couple account with paid access is 'activated'; one without gets exactly ONE free trial album (see trialReservation).
  let accessMode: AccessMode | null = null
  if (input.type === 'wedding' && accountType === 'couple') {
    if (ent.eventAccess) accessMode = 'activated'
    else { await assertNoOwnedAlbum(db, uid); accessMode = 'trial' }
  } else if ((input.type === 'party' || input.type === 'wedding') && !ent.eventAccess) {
    throw fail('permission-denied', 'Advance plan or an Event Pass is required', 'event_access_required')
  }
  const max = ent.limits.maxActiveSessions
  if (Number.isFinite(max) && (await countActiveEvents(db, uid)) >= max) {
    throw fail('resource-exhausted', `Plan allows ${max} active session`, 'session_limit', { max })
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = randomSlug(10 + attempt)                                            // grows on collision, like the legacy uniqueSlug
    const slugRef = db.collection('eventSlugs').doc(slug)
    const trialRef = trialReservation(db, uid)
    const outcome = await db.runTransaction(async (tx) => {
      const [again, s] = [await tx.get(ref), await tx.get(slugRef)]
      if (again.exists) return { slug: String(again.data()!.slug), created: false }
      if (s.exists) return null                                                       // slug taken: try another
      // The trial is a one-time reservation per account: two concurrent creates both read it absent, only one commits (the other retries and sees it).
      if (accessMode === 'trial') {
        const claimed = await tx.get(trialRef)
        if (claimed.exists) throw fail('already-exists', 'The free MIOLOVE trial album was already created', TRIAL_EXISTS)
        tx.create(trialRef, { eventId, createdAt: FieldValue.serverTimestamp() })
      }
      tx.create(slugRef, { eventId })
      tx.create(ref, {
        ownerUid: uid, slug, origin: 'firebase',
        title: input.title, djName: input.djName, description: input.description, type: input.type, status: 'live',
        coupleNames: input.coupleNames, weddingDate: input.weddingDate, venueName: input.venueName,
        occasionType: input.occasionType,
        ...(accessMode ? { accessMode } : {}),
        screenModeEnabled: input.screenModeEnabled, guestConfig: null, screenConfig: null,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      })
      return { slug, created: true }
    })
    if (outcome) return { eventId, ...outcome }
  }
  throw fail('aborted', 'Could not generate a unique slug', 'slug_unavailable')
}

export interface EventRefInput { eventId: string }
export const parseEventRefInput = (data: unknown): EventRefInput => {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  return { eventId: idField(d.eventId, 'eventId') }
}

/**
 * SOFT delete (the legacy route hard-deleted the row). The event document and ALL its subcollections (requests, dedications, polls, games,
 * private config...) are kept, so a mistaken delete is recoverable with restoreEvent; nothing is purged here. What changes, atomically:
 *   - events/{id}.deletedAt / deletedBy are set and status becomes 'ended' (guests can no longer write, owner ops see "not found");
 *   - eventSlugs/{slug} is removed (the public link stops resolving; the slug can be reused by another event).
 * Idempotent: deleting an already deleted event is a no-op. Hard purge of old soft-deleted events is a separate, explicit maintenance job.
 */
export async function deleteEvent(db: Firestore, request: CallerAuth, input: EventRefInput): Promise<{ deleted: boolean }> {
  const uid = requireAccount(request)
  const ref = db.collection('events').doc(input.eventId)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists || snap.data()!.ownerUid !== uid) throw fail('not-found', 'Event not found', 'event_not_found')
    const e = snap.data()!
    if (e.deletedAt) return { deleted: false }
    const slugRef = db.collection('eventSlugs').doc(String(e.slug))
    const s = await tx.get(slugRef)
    tx.update(ref, { deletedAt: FieldValue.serverTimestamp(), deletedBy: uid, status: 'ended', updatedAt: FieldValue.serverTimestamp() })
    if (s.exists && s.data()!.eventId === input.eventId) tx.delete(slugRef)         // never remove a slug that points to another event
    return { deleted: true }
  })
}

/** Undo of deleteEvent. Brings the event back as 'ended' (the owner can reopen it) and re-creates its slug, unless someone else took it meanwhile. */
export async function restoreEvent(db: Firestore, request: CallerAuth, input: EventRefInput): Promise<{ restored: boolean; slug: string }> {
  const { ref } = await requireEventOwner(db, request, input.eventId, { allowDeleted: true })
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref), e = snap.data()!
    const slugRef = db.collection('eventSlugs').doc(String(e.slug))
    const s = await tx.get(slugRef)
    if (!e.deletedAt) return { restored: false, slug: String(e.slug) }
    if (s.exists && s.data()!.eventId !== input.eventId) throw fail('already-exists', 'The slug is now used by another event', 'slug_taken')
    if (!s.exists) tx.create(slugRef, { eventId: input.eventId })
    tx.update(ref, { deletedAt: FieldValue.delete(), deletedBy: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() })
    return { restored: true, slug: String(e.slug) }
  })
}
