import { HttpsError } from 'firebase-functions/v2/https'

export const LIMITS = { title: 200, artist: 200, message: 500, eventId: 128 } as const

export interface RequestInput { eventId: string; songTitle: string; artist: string | null; message: string | null }

const clean = (v: string) => v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()

export function str(raw: unknown, field: string, max: number, required: boolean): string | null {
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new HttpsError('invalid-argument', `${field} required`, { reason: 'invalid_payload', field })
    return null
  }
  if (typeof raw !== 'string') throw new HttpsError('invalid-argument', `${field} must be a string`, { reason: 'invalid_payload', field })
  const v = clean(raw)
  if (!v) {
    if (required) throw new HttpsError('invalid-argument', `${field} required`, { reason: 'invalid_payload', field })
    return null
  }
  if (v.length > max) throw new HttpsError('invalid-argument', `${field} too long (max ${max})`, { reason: 'invalid_payload', field })
  return v
}

/**
 * Only these four fields are ever read from the client. Anything else
 * (guestUid, status, createdAt, ownerUid, ...) is ignored by construction.
 */
export function parseRequestInput(data: unknown): RequestInput {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const eventId = str(d.eventId, 'eventId', LIMITS.eventId, true)!
  if (eventId.includes('/')) throw new HttpsError('invalid-argument', 'invalid eventId', { reason: 'invalid_payload', field: 'eventId' })
  return {
    eventId,
    songTitle: str(d.songTitle, 'songTitle', LIMITS.title, true)!,
    artist:    str(d.artist,    'artist',    LIMITS.artist, false),
    message:   str(d.message,   'message',   LIMITS.message, false),
  }
}
