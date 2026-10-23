import { createHash, randomInt } from 'node:crypto'
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { str } from '../requests/validation'
import { fail } from '../shared/guard'
import { loadEntitlements } from '../entitlements/load'
import { MIOLOVE_TRIAL_PHOTO_LIMIT, trialExpiryFrom } from '../photos/trialQuota'
import { trialPurgeAt } from '../photos/albumLifecycle'
import { idField, requireAccount, requireEventOwner, loadAccountType, type AccountType, type CallerAuth } from './guard'
import { brandFromEvent, parseBrand, type EventBrand } from './brand'

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
 * How a MIOLOVE album got its access. Written ONLY by createEvent (and, for 'activated', by the Stripe webhook); every other event (DJ, Party, legacy,
 * events created before this field) has no value, and a missing value NEVER means trial.
 *   'trial'    the account's ONE free trial album (the one-time reservation trialAlbums/{uid} points at it)
 *   'pending'  any later album: created, but "da attivare" until its own €19.99 payment (no second trial, no uploads, no premium features)
 * ('activated' / 'purged' are written by the webhook / the purge job only: photos/albumLifecycle.ts.)
 */
export type AccessMode = 'trial' | 'pending'

export interface CreateEventInput {
  requestId: string; title: string; djName: string | null; description: string | null; type: EventType
  coupleNames: string | null; weddingDate: string | null; venueName: string | null; screenModeEnabled: boolean
  occasionType: OccasionType | null
  /** Portal the owner is creating from. null = a client that does not send it: the owner's legacy account type decides (couple → MIOLOVE, otherwise IOMIXO). */
  brand: EventBrand | null
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
    brand: parseBrand(d.brand),
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

/** Brand of an event of this owner (legacy events without a brand fall back to the owner's legacy account type). */
const brandFor = (ev: Record<string, unknown>, ownerType: AccountType): EventBrand => {
  const b = brandFromEvent(ev)
  return b === 'owner' ? (ownerType === 'couple' ? 'miolove' : 'iomixo') : b
}

/** Live (not ended, not deleted) events of an owner IN ONE PRODUCT: what the plan's maxActiveSessions counts (a MIOLOVE album never uses an IOMIXO slot). */
async function countActiveEvents(db: Firestore, uid: string, brand: EventBrand, ownerType: AccountType): Promise<number> {
  const snap = await db.collection('events').where('ownerUid', '==', uid).where('status', '==', 'live').limit(500).get()
  return snap.docs.filter((d) => !d.data().deletedAt && brandFor(d.data(), ownerType) === brand).length
}

/**
 * ONE free MIOLOVE trial per ACCOUNT (not one album per account: an account owns as many albums as it wants). trialAlbums/{uid} is the reservation: created in the SAME
 * transaction as the trial album, never deleted (not by deleteEvent either, so deleting the trial album does not hand out another), denied to every client by the rules' default.
 * Every album created after it is 'pending' until it is paid.
 */
const trialReservation = (db: Firestore, uid: string) => db.collection('trialAlbums').doc(uid)

/** Abuse ceiling on live (not deleted) MIOLOVE albums per account. Not a commercial limit: each one is paid for separately. */
export const MIOLOVE_MAX_ALBUMS = 100

/** An account that already owns a (not deleted) MIOLOVE album is past its first album: any further one is pending. IOMIXO events do not count. */
async function ownedAlbumCount(db: Firestore, uid: string, ownerType: AccountType): Promise<number> {
  const owned = await db.collection('events').where('ownerUid', '==', uid).limit(1000).get()
  return owned.docs.filter((d) => !d.data().deletedAt && brandFor(d.data(), ownerType) === 'miolove').length
}

/** Replacement of POST /api/live/sessions. Plan gates are decided here from users/{uid}.plan + eventPasses (clients never decide). */
export async function createEvent(db: Firestore, request: CallerAuth, input: CreateEventInput): Promise<{ eventId: string; slug: string; created: boolean }> {
  const uid = requireAccount(request)
  const accountType = await loadAccountType(db, uid)
  // The product comes from the portal the owner creates from; the account type is only the fallback for a client that sends none.
  const brand: EventBrand = input.brand ?? (accountType === 'couple' ? 'miolove' : 'iomixo')
  // MIOLOVE only has albums, and an album is a Wedding event.
  if (brand === 'miolove' && input.type !== 'wedding') {
    throw fail('permission-denied', 'MIOLOVE accounts can only create Wedding events', 'wedding_only')
  }
  const eventId = eventIdFor(uid, input.requestId)
  const ref = db.collection('events').doc(eventId)

  const existing = await ref.get()
  if (existing.exists) {
    const e = existing.data()!
    if (e.ownerUid !== uid) throw fail('already-exists', 'Request id already used', 'request_id_conflict')
    return { eventId, slug: String(e.slug), created: false }                       // idempotent replay
  }

  // MIOLOVE: no account-level access exists. The FIRST album of the account may take the one free trial; every other album is 'pending' (paid per album).
  // An IOMIXO plan / Event Pass never counts here (and nothing MIOLOVE is read from the account: the album carries its own state).
  let wantsTrial = false
  if (brand === 'miolove') {
    const owned = await ownedAlbumCount(db, uid, accountType)
    if (owned >= MIOLOVE_MAX_ALBUMS) throw fail('resource-exhausted', 'Too many albums', 'album_limit', { max: MIOLOVE_MAX_ALBUMS })
    wantsTrial = owned === 0
  } else {
    const ent = await loadEntitlements(db, { uid }, null, new Date(), brand)
    if ((input.type === 'party' || input.type === 'wedding') && !ent.eventAccess) {
      throw fail('permission-denied', 'Advance plan or an Event Pass is required', 'event_access_required')
    }
    const max = ent.limits.maxActiveSessions
    if (Number.isFinite(max) && (await countActiveEvents(db, uid, brand, accountType)) >= max) {
      throw fail('resource-exhausted', `Plan allows ${max} active session`, 'session_limit', { max })
    }
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = randomSlug(10 + attempt)                                            // grows on collision, like the legacy uniqueSlug
    const slugRef = db.collection('eventSlugs').doc(slug)
    const trialRef = trialReservation(db, uid)
    const startedAt = new Date()                                                     // server clock: the 7 days are measured from here, never from the client
    const outcome = await db.runTransaction(async (tx) => {
      const [again, s] = [await tx.get(ref), await tx.get(slugRef)]
      if (again.exists) return { slug: String(again.data()!.slug), created: false, accessMode: null }
      if (s.exists) return null                                                       // slug taken: try another
      // The trial is a one-time reservation per account: two concurrent creates both read it absent, only one commits (the other retries, sees it and becomes 'pending').
      let accessMode: AccessMode | null = null
      if (brand === 'miolove') {
        accessMode = 'pending'
        if (wantsTrial && !(await tx.get(trialRef)).exists) {
          tx.create(trialRef, { eventId, createdAt: FieldValue.serverTimestamp() })
          accessMode = 'trial'
        }
      }
      const trialEnd = trialExpiryFrom(startedAt)
      tx.create(slugRef, { eventId })
      tx.create(ref, {
        ownerUid: uid, slug, origin: 'firebase', brand,
        title: input.title, djName: input.djName, description: input.description, type: input.type, status: 'live',
        coupleNames: input.coupleNames, weddingDate: input.weddingDate, venueName: input.venueName,
        occasionType: input.occasionType,
        ...(accessMode ? { accessMode } : {}),
        ...(accessMode === 'trial' ? {
          trialPhotoCount: 0, trialPhotoLimit: MIOLOVE_TRIAL_PHOTO_LIMIT, trialStartsAt: Timestamp.fromDate(startedAt),
          trialExpiresAt: Timestamp.fromDate(trialEnd), purgeAfter: Timestamp.fromDate(trialPurgeAt(trialEnd)),     // 7 days + the 30-day recovery window
        } : {}),
        screenModeEnabled: brand === 'miolove' ? true : input.screenModeEnabled,        guestConfig: null, screenConfig: null,         // (a MIOLOVE album always has the monitor / slideshow)
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      })
      return { slug, created: true, accessMode }
    })
    if (outcome) return { eventId, slug: outcome.slug, created: outcome.created }
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
    if (e.purgedAt) throw fail('not-found', 'Event not found', 'event_not_found')          // its content was deleted for good (retention): nothing to restore
    const slugRef = db.collection('eventSlugs').doc(String(e.slug))
    const s = await tx.get(slugRef)
    if (!e.deletedAt) return { restored: false, slug: String(e.slug) }
    if (s.exists && s.data()!.eventId !== input.eventId) throw fail('already-exists', 'The slug is now used by another event', 'slug_taken')
    if (!s.exists) tx.create(slugRef, { eventId: input.eventId })
    tx.update(ref, { deletedAt: FieldValue.delete(), deletedBy: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() })
    return { restored: true, slug: String(e.slug) }
  })
}
