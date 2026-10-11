import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { firestore } from '../lib/firebaseAdmin'
import { normalizePlan } from '../config/plans'
import { parseSourceTimestamp } from './gameRoundRepository'

/**
 * One-way projection of the legacy entitlement sources (Supabase stays authoritative):
 *   users.plan          → users/{uid}.plan = { tier, source: 'legacy' }          (+ planSourceUpdatedAt)
 *   event_passes row    → users/{uid}/eventPasses/{key}                          (+ sourceUpdatedAt)
 * The Firestore uid is found through users.legacySupabaseId. Both writes are versioned with the DB `updated_at`
 * (microsecond precision) inside a transaction — same rules as the games projection:
 *   incoming > stored → apply · == → no-op · < → stale_ignored (structured log, no payload).
 * `key` of a pass = stripe_payment_intent_id (UNIQUE in legacy; for 0€ checkouts the checkout session id), so a replayed
 * webhook maps onto the same document; rows without it use `legacy-<row id>`.
 * A plan whose source is already 'stripe' (Firestore authoritative, future) is never overwritten by the legacy projection.
 */
export type EntitlementResult = 'created' | 'applied' | 'duplicate' | 'stale_ignored' | 'no_user' | 'authority_firestore' | 'invalid'

export interface LegacyEventPassRow {
  id: string
  user_id: string
  session_id?: string | null
  stripe_payment_intent_id?: string | null
  amount_cents?: number | null
  currency?: string | null
  valid_until: string
  status: 'active' | 'expired' | 'refunded'
  created_at: string
  updated_at: string
}
export interface LegacyPlanRow { id: string; plan: string | null; updated_at: string }

const users = () => firestore().collection('users')
const cmp = (a: Timestamp, b: Timestamp) => (a.seconds - b.seconds) || (a.nanoseconds - b.nanoseconds)
const PASS_STATUSES = ['active', 'expired', 'refunded']

async function uidByLegacyId(legacyUserId: string): Promise<string | null> {
  const q = await users().where('legacySupabaseId', '==', legacyUserId).limit(1).get()
  return q.empty ? null : q.docs[0].id
}
const stale = (scope: string, uid: string, key: string) =>
  console.warn(JSON.stringify({ projection: scope, result: 'stale_ignored', uid, key }))

export const passKey = (row: Pick<LegacyEventPassRow, 'id' | 'stripe_payment_intent_id'>) => row.stripe_payment_intent_id || `legacy-${row.id}`

export async function projectEventPass(row: LegacyEventPassRow): Promise<EntitlementResult> {
  const created = parseSourceTimestamp(row.created_at), version = parseSourceTimestamp(row.updated_at), until = parseSourceTimestamp(row.valid_until)
  if (!created || !version || !until || !PASS_STATUSES.includes(row.status) || !row.user_id) return 'invalid'
  const uid = await uidByLegacyId(row.user_id)
  if (!uid) return 'no_user'
  const key = passKey(row)
  const ref = users().doc(uid).collection('eventPasses').doc(key)
  const result = await firestore().runTransaction(async (tx): Promise<EntitlementResult> => {
    const snap = await tx.get(ref)
    const stored = snap.exists ? (snap.data()!.sourceUpdatedAt as Timestamp | undefined) : undefined
    if (stored) { const c = cmp(version, stored); if (c < 0) return 'stale_ignored'; if (c === 0) return 'duplicate' }
    tx.set(ref, {
      status: row.status,
      validUntil: until,
      legacySessionId: row.session_id ?? null,
      eventId: null,
      source: 'legacy',
      legacySupabaseId: row.id,
      stripePaymentIntentId: row.stripe_payment_intent_id ?? null,
      amountCents: row.amount_cents ?? 0,
      currency: row.currency ?? 'eur',
      sourceUpdatedAt: version,
      createdAt: created,
      updatedAt: FieldValue.serverTimestamp(),
    })
    return snap.exists ? 'applied' : 'created'
  })
  if (result === 'stale_ignored') stale('eventPasses', uid, key)
  return result
}

export async function projectLegacyPlan(row: LegacyPlanRow): Promise<EntitlementResult> {
  const version = parseSourceTimestamp(row.updated_at)
  if (!version || !row.id) return 'invalid'
  const uid = await uidByLegacyId(row.id)
  if (!uid) return 'no_user'
  const ref = users().doc(uid)
  const tier = normalizePlan(row.plan)
  const result = await firestore().runTransaction(async (tx): Promise<EntitlementResult> => {
    const snap = await tx.get(ref)
    if (!snap.exists) return 'no_user'
    const d = snap.data()!
    if (d.plan?.source === 'stripe') return 'authority_firestore'
    const stored = d.planSourceUpdatedAt as Timestamp | undefined
    if (stored) { const c = cmp(version, stored); if (c < 0) return 'stale_ignored'; if (c === 0) return 'duplicate' }
    tx.update(ref, { plan: { tier, source: 'legacy' }, planSourceUpdatedAt: version, updatedAt: FieldValue.serverTimestamp() })
    return 'applied'
  })
  if (result === 'stale_ignored') stale('plan', uid, 'plan')
  return result
}
