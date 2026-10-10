import { FieldValue } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import type { LegacyBridge } from './legacyBridge'
import type { RequestInput } from './validation'
import { fail, loadLiveEvent, reserveSlot, releaseSlot, createWithRetry } from '../shared/guard'

/** Anti-spam policy (per guest and event). Cooldown mirrors the legacy 20 s limit; the per-guest cap is new. */
export const POLICY = { cooldownMs: 20_000, maxPerGuest: 10, writeRetries: 3 } as const

export interface CreateResult { requestId: string; projected: boolean }

/**
 * Creates a music request on behalf of an authenticated (possibly anonymous) guest.
 *
 * Authority: Supabase `live_requests` stays the source of truth (legacy DJ/remote routes read it).
 * Order: 1) atomically RESERVE a slot (cooldown + per-guest cap + event cap) in a Firestore
 * transaction → 2) insert into Supabase through the bridge → 3) write the Firestore projection.
 * If step 2 fails the reservation is rolled back.
 */
export async function createRequest(
  db: Firestore,
  bridge: LegacyBridge | null,
  uid: string,
  input: RequestInput,
  now: () => number = Date.now,
): Promise<CreateResult> {
  const { ref: eventRef, data: ev } = await loadLiveEvent(db, input.eventId)

  if (ev.type !== 'standard' && ev.guestConfig?.requests === false) {
    throw fail('failed-precondition', 'Song requests are disabled for this event', 'requests_disabled')
  }
  // `requestLimit` (number | null = unlimited) is projected server-side from the DJ's effective plan.
  // Missing means the event was projected before this feature: let the caller use the legacy path.
  if (ev.requestLimit === undefined || (bridge && !ev.legacySupabaseId)) {
    throw fail('failed-precondition', 'Event not ready for Firestore requests', 'event_not_ready')
  }

  const counterRef = eventRef.collection('state').doc('requests')
  const guestRef   = eventRef.collection('requestGuests').doc(uid)
  const requestRef = eventRef.collection('requests').doc()

  // Seed the counter from the authoritative count when it does not exist yet (outside the txn: network call).
  const seed = bridge && !(await counterRef.get()).exists ? await bridge.count(ev.legacySupabaseId) : 0

  const slot = { guestRef, counterRef, limit: ev.requestLimit as number | null, seed, ...POLICY, now: now() }
  const previousLastAt = await reserveSlot(db, slot)

  let legacyId: string | undefined
  try {
    if (bridge) {
      legacyId = await bridge.insert({
        sessionId: ev.legacySupabaseId, songTitle: input.songTitle, artist: input.artist, message: input.message,
      })
    }
  } catch (e) {
    // Roll the reservation back so the guest can retry and the cap is not consumed.
    await releaseSlot(db, slot, previousLastAt, 'createMusicRequest')
    console.error('[createMusicRequest] legacy insert failed', (e as Error).message)
    throw fail('unavailable', 'Could not save the request, please retry', 'bridge_failed')
  }

  const projected = await createWithRetry(requestRef, {
    guestUid: uid,                       // from the verified token, never from the payload
    songTitle: input.songTitle,
    artist: input.artist,
    message: input.message,
    status: 'pending',
    ...(legacyId ? { legacySupabaseId: legacyId } : {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, 'createMusicRequest', POLICY.writeRetries)
  // If only the projection fails the request IS saved (Supabase): do not fail the guest.
  return { requestId: requestRef.id, projected }
}
