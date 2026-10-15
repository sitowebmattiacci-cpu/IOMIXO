import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { str, LIMITS as BASE } from '../requests/validation'
import { fail, loadLiveEvent, reserveSlot, releaseSlot } from '../shared/guard'
import { selectEventEntitlements, logEntitlementDecision } from '../entitlements/source'
import { idField, requireEventOwner, requireOwnerEventAccess, type CallerAuth } from '../owner/guard'
import { deleteObjects, objectInfo, rotateDownloadToken } from './storage'

/**
 * Event photos (guest album + Live Booth) on Firestore + Storage, replacing routes/livePhotos.ts.
 *
 *   events/{eventId}/photos/{photoId}  { guestUid, guestName, caption, source, status, isFeatured, storagePath, contentType, size, createdAt, updatedAt }
 *   Storage: events/{eventId}/photos/{photoId}/original.{jpg|jpeg|png|webp}
 *
 * Upload is a 3-step protocol where the CLIENT writes the bytes straight to Storage (no byte passes through a Function):
 *   1. createPhotoUpload (guest)  validates event live + plan + anti-spam, creates the photo doc as `uploading` and returns the one allowed path
 *   2. client uploads to that path; storage.rules only accept it for an `uploading` doc owned by the caller, typed image/*, <= 8 MB, never overwriting
 * 3. finalizePhoto (guest)      checks the object really exists with the declared type / size, flips the doc to `approved` (Wedding) or `pending` (Party)
 * Owners moderate with moderatePhoto (approve / reject / feature / delete). Only `approved` photos are readable by guests / TV.
 */
export const PHOTO_LIMITS = { guestName: 80, caption: 200, maxBytes: 8 * 1024 * 1024 } as const
/** Anti-spam: legacy allowed 20 uploads per minute per client; here a short cooldown plus a per-guest cap for the whole event. */
export const PHOTO_POLICY = { cooldownMs: 2_000, maxPerGuest: 60 } as const
export const MIME_BY_EXT: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
export type PhotoSource = 'guest_upload' | 'live_booth'
export type PhotoStatus = 'uploading' | 'pending' | 'approved' | 'rejected'

const bad = (field: string, msg = 'invalid') => new HttpsError('invalid-argument', `${field} ${msg}`, { reason: 'invalid_payload', field })
const photoPath = (eventId: string, photoId: string, ext: string) => `events/${eventId}/photos/${photoId}/original.${ext}`

export interface CreatePhotoUploadInput { eventId: string; ext: string; source: PhotoSource; guestName: string | null; caption: string | null; size: number | null }
export function parseCreatePhotoUploadInput(data: unknown): CreatePhotoUploadInput {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const ext = String(d.ext ?? 'jpg').toLowerCase().replace(/^\./, '')
  if (!(ext in MIME_BY_EXT)) throw new HttpsError('invalid-argument', 'Unsupported format (jpg/png/webp)', { reason: 'unsupported_format', field: 'ext' })
  const size = d.size === undefined || d.size === null ? null : Number(d.size)
  if (size !== null && (!Number.isFinite(size) || size < 0)) throw bad('size')
  if (size !== null && size > PHOTO_LIMITS.maxBytes) throw new HttpsError('invalid-argument', 'File too large (max 8 MB)', { reason: 'file_too_large', field: 'size' })
  return {
    eventId: idField(d.eventId, 'eventId'), ext,
    source: d.source === 'live_booth' ? 'live_booth' : 'guest_upload',
    guestName: str(d.guestName, 'guestName', PHOTO_LIMITS.guestName, false), caption: str(d.caption, 'caption', PHOTO_LIMITS.caption, false), size,
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

/** Guest step 1. Photos exist only for Party / Wedding events whose owner has Advance or an Event Pass (legacy: isEventSession + hasEventAccess). */
export async function createPhotoUpload(db: Firestore, uid: string, input: CreatePhotoUploadInput, now: () => number = Date.now): Promise<{ photoId: string; storagePath: string; contentType: string }> {
  const { ref: eventRef, data: ev } = await loadLiveEvent(db, input.eventId)
  if (ev.type !== 'party' && ev.type !== 'wedding') throw fail('failed-precondition', 'Photos are for Party / Wedding events', 'photos_unavailable')
  const decision = await selectEventEntitlements(db, input.eventId, ev, new Date(now()))
  const allowed = decision.ent ? decision.ent.gates.photos : ev.dedicationsEnabled === true
  logEntitlementDecision('createPhotoUpload', decision, allowed ? 'allow' : 'deny', 'photos')
  if (!allowed) throw fail('permission-denied', 'Photos require the Advance plan or an Event Pass', 'photos_unavailable')

  const slot = { guestRef: eventRef.collection('photoGuests').doc(uid), reasons: { cooldown: 'cooldown', guest: 'guest_limit' }, ...PHOTO_POLICY, now: now() }
  const previousLastAt = await reserveSlot(db, slot)
  const photoRef = eventRef.collection('photos').doc()
  const storagePath = photoPath(input.eventId, photoRef.id, input.ext), contentType = MIME_BY_EXT[input.ext]
  try {
    await photoRef.create({
      guestUid: uid, guestName: input.guestName, caption: input.caption, source: input.source, status: 'uploading', isFeatured: false,
      storagePath, contentType, size: input.size, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (e) {
    await releaseSlot(db, slot, previousLastAt, 'createPhotoUpload')
    console.error('[createPhotoUpload] write failed', (e as Error).message)
    throw fail('unavailable', 'Could not prepare the upload, please retry', 'write_failed')
  }
  return { photoId: photoRef.id, storagePath, contentType }
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
  const info = await objectInfo(String(p.storagePath))
  if (!info) throw fail('failed-precondition', 'The file was not uploaded', 'upload_missing')
  if (info.size <= 0 || info.size > PHOTO_LIMITS.maxBytes || info.contentType !== p.contentType) {
    await deleteObjects([String(p.storagePath)])
    await photoRef.delete()
    throw fail('failed-precondition', 'Invalid file', 'invalid_upload')
  }
  const status = finalStatus(ev.type)
  await photoRef.update({ status, size: info.size, updatedAt: FieldValue.serverTimestamp() })
  return { photoId: photoRef.id, status }
}

/** Owner: approve / reject / feature / delete. The premium gate applies to status and feature changes (legacy requireEventAccess), not to delete. */
export async function moderatePhoto(db: Firestore, request: CallerAuth, input: ModeratePhotoInput): Promise<{ changed: boolean; status?: PhotoStatus; isFeatured?: boolean; deleted?: boolean }> {
  const owner = await requireEventOwner(db, request, input.eventId)
  const photoRef = owner.ref.collection('photos').doc(input.photoId), snap = await photoRef.get()
  if (!snap.exists) throw fail('not-found', 'Photo not found', 'photo_not_found')
  const p = snap.data()!

  if (input.action === 'delete') {
    await deleteObjects([String(p.storagePath)])             // file first: a doc without a file is harmless, a file without a doc is an orphan
    await db.recursiveDelete(photoRef)
    return { changed: true, deleted: true }
  }
  if (p.status === 'uploading') throw fail('failed-precondition', 'The upload is not finished', 'photo_not_ready')
  await requireOwnerEventAccess(db, input.eventId, owner.data, 'moderatePhoto')

  if (input.action === 'set_featured') {
    if (p.isFeatured === input.isFeatured) return { changed: false, isFeatured: input.isFeatured }
    await photoRef.update({ isFeatured: input.isFeatured, updatedAt: FieldValue.serverTimestamp() })
    return { changed: true, isFeatured: input.isFeatured }
  }
  if (p.status === input.status) return { changed: false, status: input.status }
  await photoRef.update({ status: input.status, updatedAt: FieldValue.serverTimestamp() })
  if (p.status === 'approved') await rotateDownloadToken(String(p.storagePath))     // no longer public: kill the links already handed out
  return { changed: true, status: input.status }
}
