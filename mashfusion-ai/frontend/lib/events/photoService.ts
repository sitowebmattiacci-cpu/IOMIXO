import { httpsCallable } from 'firebase/functions'
import { ref, uploadBytesResumable } from 'firebase/storage'
import { getFirebaseDb, getFirebaseFunctions, getFirebaseStorage } from '../firebase/client'
import { ensureAnonymousSession } from '../firebase/auth'
import { authProvider } from '../auth'
import { publicReadFlag } from './flags'
import { getEventIdBySlug } from '../firebase/repositories/eventRepository'
import { listApprovedPhotos, docToLivePhoto } from '../firebase/repositories/photoRepository'
import { callGuestFunction, GuestCallError } from './guestCallable'
import { classifyFile, refusalReason, attachmentDisposition } from '../media/mediaTypes'
import { preparePhoto, prepareVideo } from '../media/prepare'
import type { PhotoDoc } from '../firebase/models'
import type { LivePhoto } from '../api'

/**
 * Guest side of the photos domain on Firebase (album, Live Booth, listing). Bytes go from the browser straight to Storage; the three steps and the
 * rules are described in functions/src/photos/photos.ts. Used only with NEXT_PUBLIC_FIRESTORE_PUBLIC_READ=on|true and a Firebase session; every
 * function resolves to `null` when it does not apply (flag off / event not in Firestore) so lib/api.ts keeps the legacy route.
 */
export const guestPhotosEnabled = () => publicReadFlag() && authProvider() === 'firebase'

const MESSAGES: Record<string, string> = {
  unsupported_format: 'Formato non supportato (foto jpg/png/webp, video mp4/mov/webm).',
  file_too_large:     'File troppo grande.',
  video_too_large:    'Il video supera il limite massimo di 150 MB.',
  event_ended:        'Questa sessione live è terminata.',
  event_not_found:    'Sessione non trovata',
  photos_unavailable: 'Funzione disponibile con il piano Advance o un Event Pass 24H.',
  cooldown:           'Riprova tra qualche secondo.',
  guest_limit:        'Hai inviato troppe foto per questa serata.',
  upload_missing:     'Caricamento non riuscito, riprova.',
  invalid_upload:     'File non valido.',
  photo_not_found:    'Foto non trovata',
  miolove_trial_photo_limit_reached: 'Questo album ha raggiunto il limite della prova gratuita (50 contenuti).',
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

/**
 * Uploads ONE file (guest album / Live Booth / owner upload).
 *
 *   `album: true`  MIOLOVE album pipeline: photo or video, the ORIGINAL is stored exactly as sent; the album shows small derived copies (a 1920 px
 *                  JPEG + thumbnail for a photo, a poster frame for a video) that are uploaded beside it. Video limit 150 MB per file.
 *   default        legacy single-file flow (what IOMIXO events use): one already-compressed image, max 8 MB.
 *
 * `onProgress` is 0-100 over every byte of the upload. Throws a GuestCallError whose `reason` the UI localizes.
 */
export async function uploadGuestPhoto(
  slug: string, file: File, meta: { guest_name?: string; caption?: string }, source: 'guest_upload' | 'live_booth',
  onProgress?: (pct: number) => void, opts: { album?: boolean } = {},
): Promise<{ id: string } | null> {
  if (!guestPhotosEnabled()) return null
  const eventId = await eventIdForSlug(slug); if (!eventId) return null
  const refuse = (reason: string) => new GuestCallError(MESSAGES[reason] ?? 'Request failed', reason, false)

  if (!opts.album) {
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

  // ── MIOLOVE album pipeline ──
  const media = classifyFile(file), early = refusalReason(file)
  if (!media || early) throw refuse(early ?? 'unsupported_format')                              // told before any byte moves
  const isVideo = media.kind === 'video'
  const photo = isVideo ? null : await preparePhoto(file)
  if (!isVideo && !photo) throw refuse('unsupported_format')                                    // a photo this browser cannot decode (e.g. HEIC) is not half-handled
  const video = isVideo ? await prepareVideo(file) : null
  const poster = photo?.thumb ?? video?.poster ?? null

  const create = () => callGuestFunction<{ photoId: string; storagePath: string; contentType: string; optimizedPath: string | null; thumbPath: string | null }>('createPhotoUpload', {
    eventId, ext: media.ext, size: file.size, source, guestName: meta.guest_name, caption: meta.caption,
    withOptimized: !isVideo, withThumb: !!poster, originalFilename: file.name,
    width: photo?.width ?? video?.width ?? undefined, height: photo?.height ?? video?.height ?? undefined, durationSec: video?.durationSec ?? undefined,
  }, MESSAGES)
  let slot: Awaited<ReturnType<typeof create>> | null = null
  // A queue of photos asks faster than the per-guest cooldown: wait it out instead of failing the file.
  for (let attempt = 0; !slot; attempt++) {
    try { slot = await create() } catch (e) {
      if (!(e instanceof GuestCallError) || e.reason !== 'cooldown' || attempt >= 4) throw e
      await new Promise((r) => setTimeout(r, 700))
    }
  }

  const storage = getFirebaseStorage()
  const parts: Array<{ path: string; blob: Blob; contentType: string; disposition?: string }> = []
  if (slot.optimizedPath && photo) parts.push({ path: slot.optimizedPath, blob: photo.optimized, contentType: 'image/jpeg' })
  if (slot.thumbPath && poster) parts.push({ path: slot.thumbPath, blob: poster, contentType: 'image/jpeg' })
  // The original goes LAST: when it is there, the rest is too. Its disposition makes the owner's link a download with the real file name.
  parts.push({ path: slot.storagePath, blob: file, contentType: slot.contentType, disposition: attachmentDisposition(file.name, `${media.kind}.${media.ext}`) })
  const total = parts.reduce((n, x) => n + x.blob.size, 0) || 1
  let done = 0
  try {
    for (const part of parts) {
      const task = uploadBytesResumable(ref(storage, part.path), part.blob, {
        contentType: part.contentType, cacheControl: 'public,max-age=31536000,immutable', ...(part.disposition ? { contentDisposition: part.disposition } : {}),
      })
      if (onProgress) task.on('state_changed', (s) => onProgress(Math.min(99, Math.round(((done + s.bytesTransferred) / total) * 100))))
      await task
      done += part.blob.size
    }
  } catch { throw new GuestCallError('Caricamento non riuscito, riprova.', 'upload_missing', false) }
  await callGuestFunction('finalizePhoto', { eventId, photoId: slot.photoId }, MESSAGES)
  onProgress?.(100)
  return { id: slot.photoId }
}

/** Booth page warm-up: anonymous session + slug → event id, so the first upload does not pay for them. Never throws. */
export async function warmGuestPhotoUpload(slug: string): Promise<void> {
  if (!guestPhotosEnabled()) return
  await eventIdForSlug(slug)
}

/** PhotoDoc → the legacy `LivePhoto` the pages already render (url resolved from Storage). Photos without a served binary are dropped. */
export async function toLegacyPhotos(docs: PhotoDoc[], opts: { owner?: boolean } = {}): Promise<LivePhoto[]> {
  const owner = opts.owner === true
  const storage = getFirebaseStorage()
  const rows = await Promise.all(docs.filter((p) => p.storagePath).map((p) => docToLivePhoto(storage, p, { owner })))
  return rows.filter((p) => p.url || p.url_path)
}

/** Approved photos of an event, for the guest page. null = not applicable (legacy route). */
export async function listApprovedForGuest(slug: string): Promise<LivePhoto[] | null> {
  if (!guestPhotosEnabled()) return null
  const eventId = await eventIdForSlug(slug); if (!eventId) return null
  return toLegacyPhotos(await listApprovedPhotos(getFirebaseDb(), eventId, 50))
}

/** For tests / diagnostics: the raw callable (guest). */
export const rawCreatePhotoUpload = (payload: object) => httpsCallable(getFirebaseFunctions(), 'createPhotoUpload')(payload)
