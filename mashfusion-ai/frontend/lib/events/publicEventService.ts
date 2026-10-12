import { httpsCallable } from 'firebase/functions'
import { getFirebaseFunctions } from '../firebase/client'
import { ensureAnonymousSession } from '../firebase/auth'
import { authProvider } from '../auth'
import { publicReadFlag } from './flags'
import { publicLive, type PublicLivePayload } from '../api'

/**
 * Public event lookup by slug (guest page). With NEXT_PUBLIC_FIRESTORE_PUBLIC_READ=on|true the payload comes from the getPublicEvent
 * callable (Firestore + entitlements, no Express/Supabase); a definitive "not found" is reported as such, any other failure
 * (network, function unavailable, event not in Firestore yet) falls back to the legacy endpoint. Default off → legacy only.
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
  if (!publicReadEnabled()) return publicLive.get(slug)
  try {
    const { eventId: _eventId, ...payload } = await fetchPublicEvent(slug)
    void _eventId
    return payload
  } catch {
    // Not in Firestore yet (event not migrated) or infrastructure failure → the legacy endpoint decides.
    return publicLive.get(slug)
  }
}
