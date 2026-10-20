import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { str, LIMITS as BASE } from '../requests/validation'
import { fail, loadLiveEvent, reserveSlot, releaseSlot } from '../shared/guard'
import { selectEventEntitlements, logEntitlementDecision } from '../entitlements/source'
import { idField, requireEventOwner, requireOwnerEventAccess, type CallerAuth } from '../owner/guard'
import { deleteObjects, objectInfo, rotateDownloadToken } from './storage'
import { MIME_BY_EXT, MEDIA_LIMITS, kindOfExt, mediaPaths, ownedPaths, type MediaKind } from './media'
import { MIOLOVE_TRIAL_PHOTO_LIMIT, TRIAL_PHOTO_LIMIT_REASON, TRIAL_EXPIRED_REASON, isTrialAlbum, isTrialExpired, hasMiolovePhotoAccess, trialPhotoCount } from './trialQuota'

/**
 * Event photos (guest album + Live Booth) on Firestore + Storage, replacing routes/livePhotos.ts.
 *
 *   events/{eventId}/photos/{photoId}  { guestUid, guestName, caption, source, status, isFeatured, storagePath, contentType, size, createdAt, updatedAt,
 *                                         + media model (see media.ts; absent on legacy photos): mediaType, originalPath, optimizedPath, thumbPath,
 *                                           originalFilename, maxBytes, width, height, durationSec }
 *   Storage: events/{eventId}/photos/{photoId}/{original.<ext> | optimized.jpg | thumb.jpg}   (media.ts: the ORIGINAL is always kept as sent)
 *
 * Upload is a 3-step protocol where the CLIENT writes the bytes straight to Storage (no byte passes through a Function):
 *   1. createPhotoUpload (guest)  validates event live + plan + anti-spam, creates the photo doc as `uploading` and returns the one allowed path
 *   2. client uploads to that path; storage.rules only accept it for an `uploading` doc owned by the caller, typed image/*, <= 8 MB, never overwriting
 * 3. finalizePhoto (guest)      checks the object(s) really exist with the declared type / size, flips the doc to `approved` (Wedding) or `pending` (Party)
 * Owners moderate with moderatePhoto (approve / reject / feature / delete). Only `approved` photos are readable by guests / TV.
 */
export const PHOTO_LIMITS = { guestName: 80, caption: 200, filename: 120, maxBytes: MEDIA_LIMITS.legacyPhotoBytes } as const
/** Anti-spam: legacy allowed 20 uploads per minute per client; here a short cooldown plus a per-guest cap for the whole event. */
export const PHOTO_POLICY = { cooldownMs: 2_000, maxPerGuest: 60 } as const
/** A MIOLOVE album takes photos AND videos from guests who may send many at once: technical anti-abuse cap per guest, not a commercial limit. */
export const MIOLOVE_PHOTO_POLICY = { cooldownMs: 500, maxPerGuest: 500 } as const
export { MIME_BY_EXT }
export type PhotoSource = 'guest_upload' | 'live_booth'
export type PhotoStatus = 'uploading' | 'pending' | 'approved' | 'rejected'

const bad = (field: string, msg = 'invalid') => new HttpsError('invalid-argument', `${field} ${msg}`, { reason: 'invalid_payload', field })
const photoPath = (eventId: string, photoId: string, ext: string) => `events/${eventId}/photos/${photoId}/original.${ext}`

export interface CreatePhotoUploadInput {
  eventId: string; ext: string; source: PhotoSource; guestName: string | null; caption: string | null; size: number | null
  /** The client also uploads the 1920 px `optimized.jpg` (photos) — and the original may then weigh up to MEDIA_LIMITS.photoOriginalBytes. */
  withOptimized: boolean
  /** The client also uploads `thumb.jpg` (photo thumbnail or video poster). */
  withThumb: boolean
  originalFilename: string | null
  width: number | null; height: number | null; durationSec: number | null
}
const optNum = (v: unknown, field: string, max: number): number | null => {
  if (v === undefined || v === null) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > max) throw bad(field)
  return Math.round(n * 100) / 100
}
/** The file name only (no path, no control characters): it is shown to the owner and used inside the export archive. */
const cleanFilename = (raw: string | null): string | null => {
  const v = (raw ?? '').replace(/[\u0000-\u001f\u007f/\\]+/g, '_').trim()
  return v ? v.slice(0, PHOTO_LIMITS.filename) : null
}
/** Largest original the server accepts for this upload; the one number storage.rules enforces through `maxBytes` in the photo doc. */
export const maxOriginalBytes = (kind: MediaKind, withOptimized: boolean): number =>
  kind === 'video' ? MEDIA_LIMITS.videoBytes : withOptimized ? MEDIA_LIMITS.photoOriginalBytes : MEDIA_LIMITS.legacyPhotoBytes
export function parseCreatePhotoUploadInput(data: unknown): CreatePhotoUploadInput {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const ext = String(d.ext ?? 'jpg').toLowerCase().replace(/^\./, '')
  const kind = kindOfExt(ext)
  if (!kind) throw new HttpsError('invalid-argument', 'Unsupported format (jpg/png/webp, mp4/mov/webm)', { reason: 'unsupported_format', field: 'ext' })
  const size = d.size === undefined || d.size === null ? null : Number(d.size)
  if (size !== null && (!Number.isFinite(size) || size < 0)) throw bad('size')
  const withOptimized = kind === 'photo' && d.withOptimized === true
  if (kind === 'video' && d.withOptimized === true) throw bad('withOptimized')
  const limit = maxOriginalBytes(kind, withOptimized)
  if (size !== null && size > limit) {
    throw kind === 'video'
      ? new HttpsError('invalid-argument', 'Video too large (max 150 MB)', { reason: 'video_too_large', field: 'size' })
      : new HttpsError('invalid-argument', `File too large (max ${limit / 1048576} MB)`, { reason: 'file_too_large', field: 'size' })
  }
  return {
    eventId: idField(d.eventId, 'eventId'), ext,
    source: d.source === 'live_booth' ? 'live_booth' : 'guest_upload',
    guestName: str(d.guestName, 'guestName', PHOTO_LIMITS.guestName, false), caption: str(d.caption, 'caption', PHOTO_LIMITS.caption, false), size,
    withOptimized, withThumb: d.withThumb === true,
    originalFilename: cleanFilename(str(d.originalFilename, 'originalFilename', PHOTO_LIMITS.filename * 2, false)),
    width: optNum(d.width, 'width', 100_000), height: optNum(d.height, 'height', 100_000), durationSec: optNum(d.durationSec, 'durationSec', 86_400),
  }
}
export interface PhotoRefInput { eventId: string; photoId: string }
export function parsePhotoRefInput(data: unknown): PhotoRefInput {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  return { eventId: idField(d.eventId, 'eventId'), photoId: idField(d.photoId, 'photoId') }
}
export type ModeratePhotoInput = PhotoRefInput & ({ action: 'set_status'; status: 'pending' | 'approved' | 'rejected' } | { action: 'set_featured'; isFeatured: boolean } | { action: 'delete' })
export function parseModeratePhotoInput(data: unknown): ModeratePhotoInput {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const ref = parsePhotoRefInput(d)
  if (d.action === 'delete') return { ...ref, action: 'delete' }
  if (d.action === 'set_featured') { if (typeof d.isFeatured !== 'boolean') throw bad('isFeatured'); return { ...ref, action: 'set_featured', isFeatured: d.isFeatured } }
  if (d.action === 'set_status') {
    if (d.status !== 'pending' && d.status !== 'approved' && d.status !== 'rejected') throw bad('status')
    return { ...ref, action: 'set_status', status: d.status }
  }
  throw bad('action')
}

export interface PhotoUploadSlot { photoId: string; storagePath: string; contentType: string; mediaType: MediaKind; optimizedPath: string | null; thumbPath: string | null; maxBytes: number }

/**
 * Guest step 1. Photos exist only for Party / Wedding events whose owner has Advance or an Event Pass (legacy: isEventSession + hasEventAccess).
 * Videos, and the optimized / thumbnail derivatives that let the ORIGINAL be kept as sent, belong to MIOLOVE albums only.
 */
export async function createPhotoUpload(db: Firestore, uid: string, input: CreatePhotoUploadInput, now: () => number = Date.now): Promise<PhotoUploadSlot> {
  const { ref: eventRef, data: ev } = await loadLiveEvent(db, input.eventId)
  if (ev.type !== 'party' && ev.type !== 'wedding') throw fail('failed-precondition', 'Photos are for Party / Wedding events', 'photos_unavailable')
  const kind = kindOfExt(input.ext)!
  const miolove = hasMiolovePhotoAccess(ev)
  if (!miolove && (kind === 'video' || input.withOptimized || input.withThumb)) throw fail('invalid-argument', 'Unsupported format', 'unsupported_format')
  if (kind === 'video' && input.withOptimized) throw fail('invalid-argument', 'invalid withOptimized', 'invalid_payload')
  const decision = await selectEventEntitlements(db, input.eventId, ev, new Date(now()))
  const allowed = (decision.ent ? decision.ent.gates.photos : ev.dedicationsEnabled === true) || miolove
  logEntitlementDecision('createPhotoUpload', decision, allowed ? 'allow' : 'deny', 'photos')
  if (!allowed) throw fail('permission-denied', 'Photos require the Advance plan or an Event Pass', 'photos_unavailable')
  // The 7-day trial ran out (server clock): reading stays open, new uploads do not.
  if (isTrialExpired(ev, new Date(now()))) throw fail('failed-precondition', 'The free trial has ended', TRIAL_EXPIRED_REASON)
  // UX only: finalizePhoto is the authoritative quota check. The quota counts CONTENTS (photos + videos together).
  if (isTrialAlbum(ev) && (trialPhotoCount(ev) ?? 0) >= MIOLOVE_TRIAL_PHOTO_LIMIT) throw fail('resource-exhausted', 'The free trial limit was reached', TRIAL_PHOTO_LIMIT_REASON)

  const slot = { guestRef: eventRef.collection('photoGuests').doc(uid), reasons: { cooldown: 'cooldown', guest: 'guest_limit' }, ...(miolove ? MIOLOVE_PHOTO_POLICY : PHOTO_POLICY), now: now() }
  const previousLastAt = await reserveSlot(db, slot)
  const photoRef = eventRef.collection('photos').doc()
  const paths = mediaPaths(input.eventId, photoRef.id, input.ext), contentType = MIME_BY_EXT[input.ext]
  const optimizedPath = input.withOptimized ? paths.optimized : null, thumbPath = input.withThumb ? paths.thumb : null
  const maxBytes = maxOriginalBytes(kind, input.withOptimized)
  try {
    await photoRef.create({
      guestUid: uid, guestName: input.guestName, caption: input.caption, source: input.source, status: 'uploading', isFeatured: false,
      storagePath: paths.original, contentType, size: input.size, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      // Media model: only written for a MIOLOVE album's new-style upload, so every other doc keeps the exact legacy shape.
      ...(miolove ? {
        mediaType: kind, originalPath: paths.original, optimizedPath, thumbPath, originalFilename: input.originalFilename, maxBytes,
        width: input.width, height: input.height, durationSec: input.durationSec,
      } : {}),
    })
  } catch (e) {
    await releaseSlot(db, slot, previousLastAt, 'createPhotoUpload')
    console.error('[createPhotoUpload] write failed', (e as Error).message)
    throw fail('unavailable', 'Could not prepare the upload, please retry', 'write_failed')
  }
  return { photoId: photoRef.id, storagePath: paths.original, contentType, mediaType: kind, optimizedPath, thumbPath, maxBytes }
}

/** Wedding photos are visible as soon as they are finalized (no moderation); Party keeps the owner approval step. */
export const finalStatus = (eventType: unknown): 'approved' | 'pending' => (eventType === 'wedding' ? 'approved' : 'pending')

/** Guest step 3. Idempotent: an already finalized photo is returned as is. */
export async function finalizePhoto(db: Firestore, uid: string, input: PhotoRefInput): Promise<{ photoId: string; status: PhotoStatus }> {
  const { ref: eventRef, data: ev } = await loadLiveEvent(db, input.eventId)
  const photoRef = eventRef.collection('photos').doc(input.photoId), snap = await photoRef.get()
  if (!snap.exists || snap.data()!.guestUid !== uid) throw fail('not-found', 'Photo not found', 'photo_not_found')
  const p = snap.data()!
  if (p.status !== 'uploading') return { photoId: photoRef.id, status: p.status }
  const owned = ownedPaths(p)
  /** Nothing of a refused upload is kept: every object it may have written goes away with the doc. */
  const discard = async () => { await deleteObjects(owned).catch((e) => console.error('[finalizePhoto] cleanup failed', (e as Error).message)); await photoRef.delete().catch(() => {}) }

  const info = await objectInfo(String(p.storagePath))
  if (!info) throw fail('failed-precondition', 'The file was not uploaded', 'upload_missing')
  const maxBytes = typeof p.maxBytes === 'number' ? p.maxBytes : PHOTO_LIMITS.maxBytes
  if (info.size <= 0 || info.size > maxBytes || info.contentType !== p.contentType) { await discard(); throw fail('failed-precondition', 'Invalid file', 'invalid_upload') }

  // Derivatives declared at step 1. The optimized image is what the album shows, so without it the upload is not complete (the client may retry);
  // a missing thumbnail / poster is only cosmetic: the media is kept without it.
  let thumbPath: string | null | undefined
  for (const [field, max] of [['optimizedPath', MEDIA_LIMITS.optimizedBytes], ['thumbPath', MEDIA_LIMITS.thumbBytes]] as const) {
    if (typeof p[field] !== 'string') continue
    const d = await objectInfo(p[field])
    if (!d) {
      if (field === 'thumbPath') { thumbPath = null; continue }
      throw fail('failed-precondition', 'The file was not uploaded', 'upload_missing')
    }
    if (d.size <= 0 || d.size > max || d.contentType !== 'image/jpeg') { await discard(); throw fail('failed-precondition', 'Invalid file', 'invalid_upload') }
  }
  const extra = { size: info.size, ...(thumbPath === null ? { thumbPath: null } : {}) }

  if (isTrialExpired(ev, new Date())) {
    // Started before the end, finished after it: the file is not kept (it never held a slot) and the trial stays closed.
    await discard()
    throw fail('failed-precondition', 'The free trial has ended', TRIAL_EXPIRED_REASON)
  }
  const status = finalStatus(ev.type)
  if (!isTrialAlbum(ev)) {
    await photoRef.update({ status, ...extra, updatedAt: FieldValue.serverTimestamp() })
    return { photoId: photoRef.id, status }
  }

  // Trial album: the content (photo OR video) takes a slot only when it becomes approved, in the same transaction that bumps the counter.
  const taken = await db.runTransaction(async (tx) => {
    const [evSnap, photoSnap] = [await tx.get(eventRef), await tx.get(photoRef)]
    if (!photoSnap.exists) return 'gone' as const
    if (photoSnap.data()!.status !== 'uploading') return 'done' as const
    const count = trialPhotoCount(evSnap.data()!) ?? (await tx.get(eventRef.collection('photos').where('status', '==', 'approved'))).size
    if (count >= MIOLOVE_TRIAL_PHOTO_LIMIT) return 'full' as const
    tx.update(photoRef, { status, ...extra, updatedAt: FieldValue.serverTimestamp() })
    tx.update(eventRef, { trialPhotoCount: count + 1, trialPhotoLimit: MIOLOVE_TRIAL_PHOTO_LIMIT })
    return 'ok' as const
  })
  if (taken === 'full') {
    // The rejected upload is not visible and holds no slot: remove its files and its doc.
    await discard()
    throw fail('resource-exhausted', 'The free trial limit was reached', TRIAL_PHOTO_LIMIT_REASON)
  }
  if (taken === 'gone') throw fail('not-found', 'Photo not found', 'photo_not_found')
  const after = (await photoRef.get()).data()!
  return { photoId: photoRef.id, status: after.status }
}

/** Owner: approve / reject / feature / delete. The premium gate applies to status and feature changes (legacy requireEventAccess), not to delete. */
export async function moderatePhoto(db: Firestore, request: CallerAuth, input: ModeratePhotoInput): Promise<{ changed: boolean; status?: PhotoStatus; isFeatured?: boolean; deleted?: boolean }> {
  const owner = await requireEventOwner(db, request, input.eventId)
  const photoRef = owner.ref.collection('photos').doc(input.photoId), snap = await photoRef.get()
  if (!snap.exists) throw fail('not-found', 'Photo not found', 'photo_not_found')
  const p = snap.data()!

  if (input.action === 'delete') {
    await deleteObjects(ownedPaths(p))                       // files first (original + optimized + thumbnail / poster): a doc without a file is harmless, a file without a doc is an orphan
    if (isTrialAlbum(owner.data)) {
      // Only an approved photo held a slot; the doc delete and the counter move together and never go below zero.
      await db.runTransaction(async (tx) => {
        const [evSnap, photoSnap] = [await tx.get(owner.ref), await tx.get(photoRef)]
        if (!photoSnap.exists) return
        const count = trialPhotoCount(evSnap.data()!)
        tx.delete(photoRef)
        if (photoSnap.data()!.status === 'approved' && count !== null) tx.update(owner.ref, { trialPhotoCount: Math.max(0, count - 1) })
      })
    }
    await db.recursiveDelete(photoRef)
    return { changed: true, deleted: true }
  }
  if (p.status === 'uploading') throw fail('failed-precondition', 'The upload is not finished', 'photo_not_ready')
  // Featuring is the only moderation a MIOLOVE album owner has; status changes keep the professional gate (they would move the trial counter).
  if (!(input.action === 'set_featured' && hasMiolovePhotoAccess(owner.data))) await requireOwnerEventAccess(db, input.eventId, owner.data, 'moderatePhoto')

  if (input.action === 'set_featured') {
    if (p.isFeatured === input.isFeatured) return { changed: false, isFeatured: input.isFeatured }
    await photoRef.update({ isFeatured: input.isFeatured, updatedAt: FieldValue.serverTimestamp() })
    return { changed: true, isFeatured: input.isFeatured }
  }
  if (p.status === input.status) return { changed: false, status: input.status }
  await photoRef.update({ status: input.status, updatedAt: FieldValue.serverTimestamp() })
  if (p.status === 'approved') await Promise.all(ownedPaths(p).map(rotateDownloadToken))     // no longer public: kill the links already handed out
  return { changed: true, status: input.status }
}
