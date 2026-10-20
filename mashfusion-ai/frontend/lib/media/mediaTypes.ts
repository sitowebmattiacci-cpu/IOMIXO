// MIOLOVE album media: what a file is, what is accepted, how big it may be. Pure module (no React, no DOM): shared by the upload pipeline, the
// guest / owner UIs and the unit tests. The numbers mirror firebase/functions/src/photos/media.ts and storage.rules (the server is the authority).

export type MediaKind = 'photo' | 'video'
const MiB = 1024 * 1024
/** Technical per-file limits. They are NOT commercial limits: the number of photos / videos of a full album is unlimited. */
export const MEDIA_LIMITS = { photoOriginalBytes: 50 * MiB, videoBytes: 150 * MiB } as const
export const VIDEO_LIMIT_MB = MEDIA_LIMITS.videoBytes / MiB

export interface ClassifiedFile { kind: MediaKind; ext: string; contentType: string }

const PHOTO_BY_TYPE: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const VIDEO_BY_TYPE: Record<string, string> = { 'video/mp4': 'mp4', 'video/x-m4v': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }
const KIND_BY_EXT: Record<string, ClassifiedFile> = {
  jpg: { kind: 'photo', ext: 'jpg', contentType: 'image/jpeg' }, jpeg: { kind: 'photo', ext: 'jpg', contentType: 'image/jpeg' },
  png: { kind: 'photo', ext: 'png', contentType: 'image/png' }, webp: { kind: 'photo', ext: 'webp', contentType: 'image/webp' },
  mp4: { kind: 'video', ext: 'mp4', contentType: 'video/mp4' }, m4v: { kind: 'video', ext: 'mp4', contentType: 'video/mp4' },
  mov: { kind: 'video', ext: 'mov', contentType: 'video/quicktime' }, webm: { kind: 'video', ext: 'webm', contentType: 'video/webm' },
}

/**
 * Photo, video or neither. The real MIME type decides first (a renamed file must not fool the Storage rule); the extension is the fallback because
 * some phones hand over a video / photo with an empty type. null = a format the album does not take (HEIC, GIF, AVI…).
 */
export function classifyFile(file: Pick<File, 'type' | 'name'>): ClassifiedFile | null {
  const type = (file.type ?? '').toLowerCase()
  if (PHOTO_BY_TYPE[type]) return KIND_BY_EXT[PHOTO_BY_TYPE[type]]
  if (VIDEO_BY_TYPE[type]) return KIND_BY_EXT[VIDEO_BY_TYPE[type]]
  if (type && !type.startsWith('application/octet')) return null          // a known, unsupported type (image/heic, image/gif, video/x-msvideo…)
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  return KIND_BY_EXT[ext] ?? null
}

/** The server reason a file would be refused with, decided locally so the guest is told before any byte moves. null = acceptable. */
export function refusalReason(file: Pick<File, 'type' | 'name' | 'size'>): 'unsupported_format' | 'file_too_large' | 'video_too_large' | null {
  const c = classifyFile(file)
  if (!c) return 'unsupported_format'
  if (file.size <= 0) return 'unsupported_format'
  if (c.kind === 'video' && file.size > MEDIA_LIMITS.videoBytes) return 'video_too_large'
  if (c.kind === 'photo' && file.size > MEDIA_LIMITS.photoOriginalBytes) return 'file_too_large'
  return null
}

/** Value of the file input's `accept`: photos and videos together. */
export const MEDIA_ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm'

/** Content-Disposition of an ORIGINAL: opening its URL saves the file (with its real name) instead of playing it in the browser tab. */
export function attachmentDisposition(filename: string | null | undefined, fallback: string): string {
  const name = (filename ?? '').replace(/[\u0000-\u001f\u007f"\\/]+/g, '_').trim() || fallback
  return `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`
}

/** Seconds → "m:ss" (a video tile's duration badge). */
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return ''
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const VIDEO_URL = /\.(mp4|mov|webm|m4v|ogv)(\?|#|$)/i
/** A video: the media model says so; legacy rows (no `media_type`) fall back to the file extension of their URL. */
export const isVideoMedia = (p: { media_type?: string; url?: string | null }): boolean =>
  p.media_type === 'video' || (p.media_type === undefined && !!p.url && VIDEO_URL.test(p.url))
