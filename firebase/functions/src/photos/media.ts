/**
 * Media model of an event album (photos + videos). Pure module: shared by createPhotoUpload / finalizePhoto / moderatePhoto / the export and
 * mirrored (numbers only) in storage.rules and in the web client.
 *
 *   original   events/{e}/photos/{p}/original.{jpg|jpeg|png|webp|mp4|mov|webm}   EXACTLY what the guest sent. Never transcoded, never replaced.
 *   optimized  events/{e}/photos/{p}/optimized.jpg                               photos only: 1920 px JPEG that the gallery / slideshow show
 *   thumb      events/{e}/photos/{p}/thumb.jpg                                   photo thumbnail, or the poster frame of a video
 *
 * A "legacy" photo (everything uploaded before this model) has only the original object (a client-compressed JPEG) and no optimizedPath /
 * thumbPath / mediaType: it keeps being shown and downloaded from that single file.
 */
export type MediaKind = 'photo' | 'video'

export const PHOTO_MIME_BY_EXT: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
export const VIDEO_MIME_BY_EXT: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }
export const MIME_BY_EXT: Record<string, string> = { ...PHOTO_MIME_BY_EXT, ...VIDEO_MIME_BY_EXT }

const MiB = 1024 * 1024
/** Technical per-file limits (NOT commercial limits: an activated album has no cap on the number of photos or videos). Keep in sync with storage.rules. */
export const MEDIA_LIMITS = {
  /** Single-file flow (no derivatives): what a client-compressed JPEG may weigh. */
  legacyPhotoBytes: 8 * MiB,
  /** Original photo when the client also sends the optimized + thumbnail derivatives. */
  photoOriginalBytes: 50 * MiB,
  /** One video, original quality. */
  videoBytes: 150 * MiB,
  optimizedBytes: 4 * MiB,
  thumbBytes: 1 * MiB,
} as const

export const kindOfExt = (ext: string): MediaKind | null => (ext in PHOTO_MIME_BY_EXT ? 'photo' : ext in VIDEO_MIME_BY_EXT ? 'video' : null)

export interface MediaPaths { original: string; optimized: string; thumb: string }
export const mediaPaths = (eventId: string, photoId: string, ext: string): MediaPaths => {
  const dir = `events/${eventId}/photos/${photoId}`
  return { original: `${dir}/original.${ext}`, optimized: `${dir}/optimized.jpg`, thumb: `${dir}/thumb.jpg` }
}

/** Every Storage object a photo doc owns (original first). Used by delete / failed finalize / export. */
export const ownedPaths = (p: Record<string, unknown>): string[] =>
  [p.storagePath, p.optimizedPath, p.thumbPath].filter((x): x is string => typeof x === 'string' && x.length > 0)

/** The object holding the file the owner downloads: the original, whatever the doc generation. */
export const originalPathOf = (p: Record<string, unknown>): string => String(p.originalPath ?? p.storagePath ?? '')

export const isVideoDoc = (p: Record<string, unknown>): boolean => p.mediaType === 'video'

/** Anything but letters, digits and . _ - space (Unicode-aware; built from a string so older compile targets of the web app's type-check accept it). */
const UNSAFE_NAME_CHARS = new RegExp('[^\\p{L}\\p{N}._ -]+', 'gu')

/** Name inside the export archive: the guest's file name when known (made safe), else the photo id; always unique thanks to the numeric prefix. */
export function archiveEntryName(index: number, p: Record<string, unknown>): string {
  const path = originalPathOf(p), ext = (path.split('.').pop() ?? 'jpg').toLowerCase()
  const raw = typeof p.originalFilename === 'string' ? p.originalFilename : ''
  const base = raw.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(UNSAFE_NAME_CHARS, '_').replace(/^[._ -]+|[._ -]+$/g, '').slice(0, 80)
  return `${String(index).padStart(4, '0')}-${base || String(p.id ?? 'media')}.${ext}`
}
