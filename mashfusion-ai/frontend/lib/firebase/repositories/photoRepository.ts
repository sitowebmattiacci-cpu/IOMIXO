import {
  collection, getDocs, onSnapshot, query, where, orderBy, limit, Timestamp,
  type Firestore, type DocumentData, type Unsubscribe,
} from 'firebase/firestore'
import { getDownloadURL, ref, type FirebaseStorage } from 'firebase/storage'
import type { PhotoDoc, PhotoStatus, PhotoSource } from '../models'

// Read-side repository for events/{eventId}/photos and their Storage files. There are NO client writes: Functions own them (see firestore.rules).

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null)
const STATUSES: readonly PhotoStatus[] = ['uploading', 'pending', 'approved', 'rejected']

export function fromPhotoDoc(id: string, d: DocumentData): PhotoDoc {
  return {
    id,
    guestUid:    d.guestUid ?? null,
    guestName:   d.guestName ?? null,
    caption:     d.caption ?? null,
    source:      (d.source === 'live_booth' ? 'live_booth' : 'guest_upload') as PhotoSource,
    status:      STATUSES.includes(d.status) ? d.status : 'pending',
    isFeatured:  d.isFeatured === true,
    storagePath: String(d.storagePath ?? ''),
    ...(d.legacySupabaseId ? { legacySupabaseId: String(d.legacySupabaseId) } : {}),
    ...(d.legacyStoragePath ? { legacyStoragePath: String(d.legacyStoragePath) } : {}),
    createdAt:   toDate(d.createdAt),
    updatedAt:   toDate(d.updatedAt),
  }
}

const col = (db: Firestore, eventId: string) => collection(db, 'events', eventId, 'photos')

/** Approved photos, newest first (what guests and the TV may read). Realtime. */
export function subscribeApprovedPhotos(
  db: Firestore, eventId: string, max: number,
  onChange: (photos: PhotoDoc[]) => void, onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(query(col(db, eventId), where('status', '==', 'approved'), orderBy('createdAt', 'desc'), limit(max)),
    (snap) => onChange(snap.docs.map((d) => fromPhotoDoc(d.id, d.data()))), (e) => onError?.(e))
}

/** One-shot read of the approved photos (guest page lists, polled by SWR). */
export async function listApprovedPhotos(db: Firestore, eventId: string, max: number): Promise<PhotoDoc[]> {
  const snap = await getDocs(query(col(db, eventId), where('status', '==', 'approved'), orderBy('createdAt', 'desc'), limit(max)))
  return snap.docs.map((d) => fromPhotoDoc(d.id, d.data()))
}

/** Owner: every photo of the event (pending / approved / rejected), newest first; unfinished uploads are not shown. */
export async function listOwnerPhotos(db: Firestore, eventId: string, max = 300): Promise<PhotoDoc[]> {
  const snap = await getDocs(query(col(db, eventId), orderBy('createdAt', 'desc'), limit(max)))
  return snap.docs.map((d) => fromPhotoDoc(d.id, d.data())).filter((p) => p.status !== 'uploading')
}

// ── Storage URLs ──
// getDownloadURL is allowed by storage.rules only for what the caller may read (approved for guests / TV, everything for the owner). The URL is cached per
// path for the page lifetime: a photo that stops being approved has its token rotated server-side, so a stale cached URL stops working by itself.
const urlCache = new Map<string, Promise<string | null>>()
export function photoUrl(storage: FirebaseStorage, path: string): Promise<string | null> {
  if (!path) return Promise.resolve(null)
  let p = urlCache.get(path)
  if (!p) {
    p = getDownloadURL(ref(storage, path)).catch(() => null)
    urlCache.set(path, p)
    p.then((u) => { if (!u) urlCache.delete(path) })           // do not cache failures (e.g. approved a moment later)
  }
  return p
}
/** Forget cached URLs (after a status change the owner made). */
export const forgetPhotoUrl = (path: string) => { urlCache.delete(path) }
