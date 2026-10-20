import {
  collection, doc, getDocs, onSnapshot, query, where, orderBy, limit, Timestamp,
  type Firestore, type DocumentData, type Unsubscribe,
} from 'firebase/firestore'
import { getDownloadURL, ref, type FirebaseStorage } from 'firebase/storage'
import type { PhotoDoc, PhotoStatus, PhotoSource } from '../models'
import type { LivePhoto } from '../../api'

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
    ...(d.mediaType === 'video' || d.mediaType === 'photo' ? { mediaType: d.mediaType as 'photo' | 'video' } : {}),
    ...(typeof d.optimizedPath === 'string' ? { optimizedPath: d.optimizedPath } : {}),
    ...(typeof d.thumbPath === 'string' ? { thumbPath: d.thumbPath } : {}),
    ...(typeof d.contentType === 'string' ? { contentType: d.contentType } : {}),
    ...(typeof d.size === 'number' ? { size: d.size } : {}),
    ...(typeof d.originalFilename === 'string' ? { originalFilename: d.originalFilename } : {}),
    ...(typeof d.width === 'number' ? { width: d.width } : {}),
    ...(typeof d.height === 'number' ? { height: d.height } : {}),
    ...(typeof d.durationSec === 'number' ? { durationSec: d.durationSec } : {}),
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

/** Owner: realtime change signal for the event's newest photos (the caller re-reads the list on every snapshot). */
export function subscribeOwnerPhotos(
  db: Firestore, eventId: string, onChange: () => void, onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(query(col(db, eventId), orderBy('createdAt', 'desc'), limit(30)), () => onChange(), (e) => onError?.(e))
}

// ── Storage URLs ──
// getDownloadURL is allowed by storage.rules only for what the caller may read (approved for guests / TV, everything for the owner). The URL is cached per
// path for the page lifetime: a photo that stops being approved has its token rotated server-side, so a stale cached URL stops working by itself.
const urlCache = new Map<string, Promise<string | null>>()
// Resolving URLs is one Storage round trip each, every one checked against storage.rules (which read Firestore): a gallery of hundreds must not fire them all at once.
// A few at a time keeps the Storage service responsive for everything else the page does (uploads, other tabs) and is invisible to the person.
const URL_CONCURRENCY = 3
let urlActive = 0
const urlWaiting: Array<() => void> = []
const urlSlot = async () => { if (urlActive >= URL_CONCURRENCY) await new Promise<void>((r) => urlWaiting.push(r)); urlActive++ }
const urlRelease = () => { urlActive--; urlWaiting.shift()?.() }
export function photoUrl(storage: FirebaseStorage, path: string): Promise<string | null> {
  if (!path) return Promise.resolve(null)
  let p = urlCache.get(path)
  if (!p) {
    p = urlSlot().then(() => getDownloadURL(ref(storage, path)).catch(() => null).finally(urlRelease))
    urlCache.set(path, p)
    p.then((u) => { if (!u) urlCache.delete(path) })           // do not cache failures (e.g. approved a moment later)
  }
  return p
}
/**
 * PhotoDoc → the `LivePhoto` the pages render. `url` is what is SHOWN: the optimized image of a photo, the video file itself of a video, the single
 * file of a legacy photo. The ORIGINAL is never resolved here (guests cannot read it): the owner's download asks Storage for it separately.
 */
export async function docToLivePhoto(storage: FirebaseStorage, p: PhotoDoc, opts: { owner?: boolean } = {}): Promise<LivePhoto> {
  const isVideo = p.mediaType === 'video'
  const shownPath = isVideo ? p.storagePath : (p.optimizedPath ?? p.storagePath)
  // Owner gallery: the grid needs only the thumbnail; the big file (optimized image / the video itself) is resolved when the media is OPENED (`url_path`).
  // A media without a thumbnail (legacy photo) has nothing smaller to show, so its single file is resolved at once. Guests / TV need the shown file now
  // (and the poster of a video); a photo's thumbnail is of no use to them.
  const lazy = opts.owner === true && !!p.thumbPath
  const wantThumb = !!p.thumbPath && (opts.owner === true || isVideo)
  const [url, thumb] = await Promise.all([lazy ? Promise.resolve(null) : photoUrl(storage, shownPath), wantThumb ? photoUrl(storage, p.thumbPath!) : Promise.resolve(null)])
  return {
    id: p.id, guest_name: p.guestName, caption: p.caption, status: p.status === 'uploading' ? 'pending' : p.status, url,
    is_featured: p.isFeatured, source: p.source, created_at: (p.createdAt ?? new Date()).toISOString(),
    media_type: p.mediaType ?? 'photo', thumb_url: thumb ?? (isVideo ? null : url), url_path: lazy ? shownPath : null,
    filename: p.originalFilename ?? null, content_type: p.contentType ?? null, size: p.size ?? null, duration_sec: p.durationSec ?? null, width: p.width ?? null, height: p.height ?? null,
    ...(opts.owner ? { original_path: p.storagePath, has_original: isVideo || !!p.optimizedPath } : {}),
  }
}

/** Forget cached URLs (after a status change the owner made). */
export const forgetPhotoUrl = (path: string) => { urlCache.delete(path) }

// ── Album export ("download everything") ──
export type ExportStatus = 'queued' | 'preparing' | 'ready' | 'failed'
export interface ExportDoc { id: string; status: ExportStatus; total: number; processed: number; bytes: number | null; expiresAt: Date | null; updatedAt: Date | null }
const EXPORT_STATUSES: readonly ExportStatus[] = ['queued', 'preparing', 'ready', 'failed']

/** Owner: realtime progress of one export (rules: owner read only). */
export function subscribeExport(db: Firestore, eventId: string, exportId: string, onChange: (x: ExportDoc | null) => void, onError?: (e: Error) => void): Unsubscribe {
  return onSnapshot(doc(db, 'events', eventId, 'exports', exportId), (snap) => {
    if (!snap.exists()) return onChange(null)
    const d = snap.data()
    onChange({
      id: snap.id, status: EXPORT_STATUSES.includes(d.status) ? d.status : 'failed', total: Number(d.total ?? 0), processed: Number(d.processed ?? 0),
      bytes: typeof d.bytes === 'number' ? d.bytes : null, expiresAt: toDate(d.expiresAt), updatedAt: toDate(d.updatedAt),
    })
  }, (e) => onError?.(e))
}
