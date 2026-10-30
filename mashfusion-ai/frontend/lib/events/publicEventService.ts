import { httpsCallable } from 'firebase/functions'
import { getFirebaseFunctions } from '../firebase/client'
import { ensureAnonymousSession } from '../firebase/auth'
import { authProvider } from '../auth'
import { publicReadFlag } from './flags'
import type { PublicLivePayload } from '../api'

/**
 * Public event lookup by slug (guest page): the getPublicEvent callable (Firestore + entitlements).
 */
export const publicReadEnabled = () => publicReadFlag() && authProvider() === 'firebase'

export type PublicEventResult = PublicLivePayload & { eventId: string }

/** The one error fetchPublicEvent raises for a slug that does not exist; any other failure (network, App Check, server) is a retryable load error. */
export const EVENT_NOT_FOUND_MESSAGE = 'Sessione non trovata'
export const isEventNotFound = (e: unknown): boolean => (e as { message?: string } | null)?.message === EVENT_NOT_FOUND_MESSAGE

export async function fetchPublicEvent(slug: string): Promise<PublicEventResult> {
  await ensureAnonymousSession()
  try {
    return (await httpsCallable<{ slug: string }, PublicEventResult>(getFirebaseFunctions(), 'getPublicEvent')({ slug })).data
  } catch (e) {
    const err = e as { code?: string; details?: { reason?: string } }
    if (err.details?.reason === 'event_not_found') throw new Error(EVENT_NOT_FOUND_MESSAGE)
    throw e
  }
}

export async function fetchPublicLive(slug: string): Promise<PublicLivePayload> {
  const { eventId: _eventId, ...payload } = await fetchPublicEvent(slug)
  void _eventId
  return payload
}
