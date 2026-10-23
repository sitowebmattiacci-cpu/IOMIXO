import type { Unsubscribe } from 'firebase/firestore'
import { getFirebaseDb } from '../firebase/client'
import { ensureAnonymousSession } from '../firebase/auth'
import { getEventIdBySlug, subscribeEvent } from '../firebase/repositories/eventRepository'
import type { EventDoc } from '../firebase/models'

/**
 * Guest entry point: make sure the visitor has a Firebase identity (anonymous if
 * nobody is signed in; an existing session is reused), then resolve the event id.
 */
export async function resolveEventIdForGuest(slug: string): Promise<string | null> {
  await ensureAnonymousSession()
  return getEventIdBySlug(getFirebaseDb(), slug)
}

export function watchEvent(
  eventId: string,
  onChange: (event: EventDoc | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return subscribeEvent(getFirebaseDb(), eventId, onChange, onError)
}

/**
 * Event fields in the shape the legacy public-live payload uses, so the page can
 * overlay realtime data on the backend response without changing its markup.
 */
export function eventToPublicSession(e: EventDoc) {
  return {
    event_name:          e.title,
    dj_name:             e.djName,
    description:         e.description,
    is_active:           e.status === 'live',
    session_type:        e.type,
    couple_names:        e.coupleNames,
    wedding_date:        e.weddingDate,
    venue_name:          e.venueName,
    screen_mode_enabled: e.screenModeEnabled,
    guest_config:        e.guestConfig as any,
    occasion_type:       e.occasionType ?? null,
    ...(e.accessMode === 'trial' && e.trialExpiresAt ? { trial_expires_at: e.trialExpiresAt.toISOString() } : {}),
    ...(e.accessMode === 'activated' && e.expiresAt ? { expires_at: e.expiresAt.toISOString() } : {}),
  }
}
