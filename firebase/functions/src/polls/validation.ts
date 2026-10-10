import { HttpsError } from 'firebase-functions/v2/https'
import { str, LIMITS as BASE } from '../requests/validation'

export const MAX_OPTIONS = 4 // legacy: 2–4 options per poll

export interface VoteInput { eventId: string; pollId: string; optionIndex: number }

/** Only eventId, pollId and optionIndex are read from the client. */
export function parseVoteInput(data: unknown): VoteInput {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const eventId = str(d.eventId, 'eventId', BASE.eventId, true)!
  const pollId  = str(d.pollId,  'pollId',  BASE.eventId, true)!
  for (const [field, v] of [['eventId', eventId], ['pollId', pollId]] as const) {
    if (v.includes('/')) throw new HttpsError('invalid-argument', `invalid ${field}`, { reason: 'invalid_payload', field })
  }
  const n = d.optionIndex
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n >= MAX_OPTIONS) {
    throw new HttpsError('invalid-argument', 'invalid optionIndex', { reason: 'invalid_option', field: 'optionIndex' })
  }
  return { eventId, pollId, optionIndex: n }
}
