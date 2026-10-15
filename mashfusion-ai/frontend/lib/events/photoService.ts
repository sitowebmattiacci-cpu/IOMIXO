import { httpsCallable } from 'firebase/functions'
import { ref, uploadBytesResumable } from 'firebase/storage'
import { getFirebaseDb, getFirebaseFunctions, getFirebaseStorage } from '../firebase/client'
import { ensureAnonymousSession } from '../firebase/auth'
import { authProvider } from '../auth'
import { publicReadFlag } from './flags'
import { getEventIdBySlug } from '../firebase/repositories/eventRepository'
import { listApprovedPhotos, photoUrl } from '../firebase/repositories/photoRepository'
import { callGuestFunction } from './guestCallable'
import type { PhotoDoc } from '../firebase/models'
import type { LivePhoto } from '../api'

/**
 * Guest side of the photos domain on Firebase (album, Live Booth, listing). Bytes go from the browser straight to Storage; the three steps and the
 * rules are described in functions/src/photos/photos.ts. Used only with NEXT_PUBLIC_FIRESTORE_PUBLIC_READ=on|true and a Firebase session; every
 * function resolves to `null` when it does not apply (flag off / event not in Firestore) so lib/api.ts keeps the legacy route.
 */
export const guestPhotosEnabled = () => publicReadFlag() && authProvider() === 'firebase'

const MESSAGES: Record<string, string> = {
  unsupported_format: 'Formato non supportato (jpg/png/webp).',
  file_too_large:     'File troppo grande (max 8 MB).',
  event_ended:        'Questa sessione live è terminata.',
  event_not_found:    'Sessione non trovata',
  photos_unavailable: 'Funzione disponibile con il piano Advance o un Event Pass 24H.',
  cooldown:           'Riprova tra qualche secondo.',
  guest_limit:        'Hai inviato troppe foto per questa serata.',
  upload_missing:     'Caricamento non riuscito, riprova.',
  invalid_upload:     'File non valido.',
  photo_not_found:    'Foto non trovata',
}

/** slug → event id, memoized per page (a negative answer is not kept). */
const ids = new Map<string, Promise<string | null>>()
export function eventIdForSlug(slug: string): Promise<string | null> {
  let p = ids.get(slug)
  if (!p) {
    p = ensureAnonymousSession().then(() => getEventIdBySlug(getFirebaseDb(), slug)).catch(() => null)
    ids.set(slug, p)
    p.then((id) => { if (!id) ids.delete(slug) })
  }
  return p
}

const EXT_BY_TYPE: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
/** The extension the server will accept: from the real MIME type first (a renamed file must not fool the Storage rule), else from the name. */
export function extensionOf(file: Pick<File, 'type' | 'name'>): string {
  return EXT_BY_TYPE[file.type] ?? (file.name.split('.').pop() ?? 'jpg').toLowerCase()
}

export async function uploadGuestPhoto(
  slug: string, file: File, meta: { guest_name?: string; caption?: string }, source: 'guest_upload' | 'live_booth',
  onProgress?: (pct: number) => void,
): Promise<{ id: string } | null> {
  if (!guestPhotosEnabled()) return null
  const eventId = await eventIdForSlug(slug); if (!eventId) return null
  const slot = await callGuestFunction<{ photoId: string; storagePath: string; contentType: string }>('createPhotoUpload', {
    eventId, ext: extensionOf(file), size: file.size, source, guestName: meta.guest_name, caption: meta.caption,
  }, MESSAGES)
  try {
    // Unique path per photo: the object never changes, so browsers / the CDN may cache it for good.
    const task = uploadBytesResumable(ref(getFirebaseStorage(), slot.storagePath), file, { contentType: slot.contentType, cacheControl: 'public,max-age=31536000,immutable' })
    if (onProgress) task.on('state_changed', (s) => onProgress(s.totalBytes ? Math.round((s.bytesTransferred / s.totalBytes) * 100) : 0))
    await task
  } catch { throw new Error('Caricamento non riuscito, riprova.') }
  await callGuestFunction('finalizePhoto', { eventId, photoId: slot.photoId }, MESSAGES)
  return { id: slot.photoId }
}

/** Booth page warm-up: anonymous session + slug → event id, so the first upload does not pay for them. Never throws. */
export async function warmGuestPhotoUpload(slug: string): Promise<void> {
  if (!guestPhotosEnabled()) return
  await eventIdForSlug(slug)
}

/** PhotoDoc → the legacy `LivePhoto` the pages already render (url resolved from Storage). Photos without a served binary are dropped. */
export async function toLegacyPhotos(docs: PhotoDoc[]): Promise<LivePhoto[]> {
  const storage = getFirebaseStorage()
  const rows = await Promise.all(docs.filter((p) => p.storagePath).map(async (p): Promise<LivePhoto> => ({
    id: p.id, guest_name: p.guestName, caption: p.caption, status: p.status === 'uploading' ? 'pending' : p.status, url: await photoUrl(storage, p.storagePath),
    is_featured: p.isFeatured, source: p.source, created_at: (p.createdAt ?? new Date()).toISOString(),
  })))
  return rows.filter((p) => p.url)
}

/** Approved photos of an event, for the guest page. null = not applicable (legacy route). */
export async function listApprovedForGuest(slug: string): Promise<LivePhoto[] | null> {
  if (!guestPhotosEnabled()) return null
  const eventId = await eventIdForSlug(slug); if (!eventId) return null
  return toLegacyPhotos(await listApprovedPhotos(getFirebaseDb(), eventId, 50))
}

/** For tests / diagnostics: the raw callable (guest). */
export const rawCreatePhotoUpload = (payload: object) => httpsCallable(getFirebaseFunctions(), 'createPhotoUpload')(payload)
