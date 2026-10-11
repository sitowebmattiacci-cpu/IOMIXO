import type { Firestore, DocumentData } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'
import { readAccount } from './load'
import { resolveEntitlements, type Entitlements } from './resolve'

/**
 * Which source decides the premium gates of an event during the Supabase → Firebase transition.
 *
 *  'firestore'                 users/{ownerUid}.plan + users/{ownerUid}/eventPasses decide (this module's resolver). Used when
 *                              - the event is fully Firebase (no legacySupabaseId: nothing legacy to fall back to), or
 *                              - the owner's plan was written by a SERVER (plan.source 'legacy' = projection, 'stripe' = webhook),
 *                                i.e. entitlement data exists for this account. Then it is FINAL: it may also deny.
 *  'legacy_projected_fallback' the legacy-backed event whose owner has NO server-written plan yet (projection still off, the
 *                              users doc only carries the client-created plan.source 'default'): the old projected event fields
 *                              (requestLimit / dedicationsEnabled) keep deciding, exactly as before. Absence of Firestore passes
 *                              proves nothing for such accounts, so Firestore is NOT allowed to remove an access that exists.
 *
 * The choice is made from server data only; nothing in the callable payload takes part. Remove with the legacy fields.
 */
export type EntitlementSource = 'firestore' | 'legacy_projected_fallback'
export const SERVER_PLAN_SOURCES: readonly string[] = ['legacy', 'stripe']

export interface EventEntitlementDecision { source: EntitlementSource; ent: Entitlements | null; ownerUid: string }

export async function selectEventEntitlements(
  db: Firestore, eventId: string, ev: DocumentData, now: Date = new Date(),
): Promise<EventEntitlementDecision> {
  const ownerUid = String(ev.ownerUid ?? '')
  const legacyBacked = Boolean(ev.legacySupabaseId)
  const acc = await readAccount(db, { uid: ownerUid }, now)
  const hasServerPlan = acc.planSource !== null && SERVER_PLAN_SOURCES.includes(acc.planSource)
  if (legacyBacked && !hasServerPlan) return { source: 'legacy_projected_fallback', ent: null, ownerUid }
  const ent = resolveEntitlements({ plan: acc.plan, passes: acc.passes, event: { id: eventId, legacySessionId: ev.legacySupabaseId ?? null }, now })
  return { source: 'firestore', ent, ownerUid }
}

/** Structured log: which source decided and what. No uid, pass id, payment data, email or token. */
export function logEntitlementDecision(fn: string, d: EventEntitlementDecision, outcome: 'allow' | 'deny', gate: string) {
  logger.info('entitlement', { fn, entitlementSource: d.source, gate, outcome })
}
