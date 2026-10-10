import { HttpsError } from 'firebase-functions/v2/https'
import { str, LIMITS as BASE } from '../requests/validation'

export const DEDICATION_LIMITS = { senderName: 80, message: 500 } as const

export interface DedicationInput { eventId: string; senderName: string | null; message: string }

/** Only eventId, senderName and message are read from the client; everything else is ignored. */
export function parseDedicationInput(data: unknown): DedicationInput {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const eventId = str(d.eventId, 'eventId', BASE.eventId, true)!
  if (eventId.includes('/')) throw new HttpsError('invalid-argument', 'invalid eventId', { reason: 'invalid_payload', field: 'eventId' })
  return {
    eventId,
    senderName: str(d.senderName, 'senderName', DEDICATION_LIMITS.senderName, false),
    message:    str(d.message,    'message',    DEDICATION_LIMITS.message, true)!,
  }
}
