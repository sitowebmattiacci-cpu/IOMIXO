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

export async function fetchPublicEvent(slug: string): Promise<PublicEventResult> {
  await ensureAnonymousSession()
  try {
    return (await httpsCallable<{ slug: string }, PublicEventResult>(getFirebaseFunctions(), 'getPublicEvent')({ slug })).data
  } catch (e) {
    const err = e as { code?: string; details?: { reason?: string } }
    if (err.details?.reason === 'event_not_found') throw new Error('Sessione non trovata')
    throw e
  }
}

export async function fetchPublicLive(slug: string): Promise<PublicLivePayload> {
  const { eventId: _eventId, ...payload } = await fetchPublicEvent(slug)
  void _eventId
  return payload
}
