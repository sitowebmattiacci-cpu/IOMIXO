import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours   = Math.floor(diff / 3_600_000)
  const days    = Math.floor(diff / 86_400_000)

  if (minutes < 1)  return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours   < 24) return `${hours}h ago`
  return `${days}d ago`
}

export function getKeyLabel(key: string): string {
  // Convert "C major" → "C maj", "A minor" → "Am" etc.
  return key
    .replace('major', 'maj')
    .replace('minor', 'min')
}

export function bpmToCategory(bpm: number): string {
  if (bpm < 80)  return 'Very Slow'
  if (bpm < 100) return 'Slow'
  if (bpm < 120) return 'Moderate'
  if (bpm < 140) return 'Upbeat'
  if (bpm < 160) return 'Fast'
  return 'Very Fast'
}

export function truncate(str: string, max = 30): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Strip file extension from filename */
export function stripExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, '')
}

/**
 * Extract the 11-char YouTube video id from any common URL shape
 * (watch?v=, youtu.be/, /embed/, /shorts/, /live/) or a bare id.
 * Returns null when no valid id can be found.
 */
export function youtubeVideoId(raw?: string | null): string | null {
  if (!raw) return null
  const url = raw.trim()
  if (!url) return null
  const patterns = [
    /youtube\.com\/watch\?[^#]*\bv=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/live\/([A-Za-z0-9_-]{11})/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m?.[1]) return m[1]
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url
  return null
}

/**
 * Convert any supported YouTube URL into a clean privacy-friendly embed URL.
 * Optionally requests muted autoplay (the only autoplay browsers allow without
 * a user gesture). Returns null when the input is not a valid YouTube link.
 */
export function youtubeEmbedUrl(raw?: string | null, opts?: { autoplay?: boolean }): string | null {
  const id = youtubeVideoId(raw)
  if (!id) return null
  const base = `https://www.youtube-nocookie.com/embed/${id}`
  if (opts?.autoplay) {
    return `${base}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1`
  }
  return `${base}?rel=0&modestbranding=1`
}

/** True when the URL points to a direct video file we can play in <video>. */
export function isDirectVideoUrl(raw?: string | null): boolean {
  if (!raw) return false
  const url = raw.trim()
  return /^https?:\/\//i.test(url) && /\.(mp4|webm|ogg|ogv|mov|m4v)(\?.*)?$/i.test(url)
}

export type VideoLiveSource =
  | { kind: 'youtube'; embedUrl: string; videoId: string }
  | { kind: 'file'; url: string }

/**
 * Resolve a DJ-provided link into a playable Video Live source.
 * Supports YouTube (any shape → privacy-friendly embed) and direct video
 * files (mp4, webm, ogg, mov, m4v). Returns null when the link is unusable.
 */
export function resolveVideoSource(raw?: string | null, opts?: { autoplay?: boolean }): VideoLiveSource | null {
  const videoId = youtubeVideoId(raw)
  if (videoId) {
    const embedUrl = youtubeEmbedUrl(raw, opts)!
    return { kind: 'youtube', embedUrl, videoId }
  }
  if (isDirectVideoUrl(raw)) return { kind: 'file', url: raw!.trim() }
  return null
}

/** Validate audio file type */
export function isValidAudioFile(file: File): boolean {
  const valid = ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/aiff', 'audio/ogg', 'audio/mp4']
  return valid.includes(file.type) || /\.(mp3|wav|flac|aiff|ogg|m4a)$/i.test(file.name)
}

/** Max upload size (100 MB) */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
