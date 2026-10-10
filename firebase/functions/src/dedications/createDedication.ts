import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { LegacyBridge } from '../requests/legacyBridge'
import type { DedicationInput } from './validation'
import { fail, loadLiveEvent, reserveSlot, releaseSlot, createWithRetry } from '../shared/guard'

/**
 * Legacy behaviour: one dedication per 30 s per client, no per-guest or event cap.
 * The per-guest cap is new; there is intentionally NO event-wide cap (the product has none).
 */
export const DEDICATION_POLICY = { cooldownMs: 30_000, maxPerGuest: 5, writeRetries: 3 } as const

export interface DedicationResult { dedicationId: string; projected: boolean }

/**
 * Same authority model as music requests: reserve (Firestore txn) → Supabase bridge → Firestore projection.
 * Dedications are only available for party/wedding sessions whose DJ has Advance or an active Event Pass
 * (`dedicationsEnabled`, projected server-side from the legacy access check).
 */
export async function createDedication(
  db: Firestore, bridge: LegacyBridge | null, uid: string, input: DedicationInput, now: () => number = Date.now,
): Promise<DedicationResult> {
  const { ref: eventRef, data: ev } = await loadLiveEvent(db, input.eventId)

  if (ev.type !== 'party' && ev.type !== 'wedding') {
    throw fail('failed-precondition', 'Dedications are only available for Party and Wedding sessions', 'dedications_unavailable')
  }
  if (ev.dedicationsEnabled === undefined || (bridge && !ev.legacySupabaseId)) {
    throw fail('failed-precondition', 'Event not ready for Firestore dedications', 'event_not_ready')
  }
  if (ev.dedicationsEnabled !== true) {
    throw fail('permission-denied', 'Dedications require the Advance plan or an Event Pass', 'dedications_unavailable')
  }

  const guestRef = eventRef.collection('dedicationGuests').doc(uid)
  const dedicationRef = eventRef.collection('dedications').doc()
  const slot = { guestRef, reasons: { cooldown: 'cooldown', guest: 'guest_limit' }, ...DEDICATION_POLICY, now: now() }
  const previousLastAt = await reserveSlot(db, slot)

  let legacyId: string | undefined
  try {
    if (bridge) {
      legacyId = await bridge.insertDedication({ sessionId: ev.legacySupabaseId, senderName: input.senderName, message: input.message })
    }
  } catch (e) {
    await releaseSlot(db, slot, previousLastAt, 'createDedication')
    console.error('[createDedication] legacy insert failed', (e as Error).message)
    throw fail('unavailable', 'Could not save the dedication, please retry', 'bridge_failed')
  }

  // No guestUid on the document: guests read the approved wall of everybody, so the anonymous uid would leak.
  // Anti-spam is keyed by uid in events/{id}/dedicationGuests (server-only).
  const projected = await createWithRetry(dedicationRef, {
    senderName: input.senderName,
    message: input.message,
    status: 'pending',
    ...(legacyId ? { legacySupabaseId: legacyId } : {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, 'createDedication', DEDICATION_POLICY.writeRetries)
  return { dedicationId: dedicationRef.id, projected }
}
