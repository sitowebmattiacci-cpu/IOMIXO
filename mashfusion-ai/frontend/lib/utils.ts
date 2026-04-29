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

/** Validate audio file type */
export function isValidAudioFile(file: File): boolean {
  const valid = ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/aiff', 'audio/ogg', 'audio/mp4']
  return valid.includes(file.type) || /\.(mp3|wav|flac|aiff|ogg|m4a)$/i.test(file.name)
}

/** Max upload size (100 MB) */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
