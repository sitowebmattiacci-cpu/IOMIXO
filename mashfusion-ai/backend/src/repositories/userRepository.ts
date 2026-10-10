import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { firestore } from '../lib/firebaseAdmin'
import { PLAN_LIMITS, type PlanTier, type PlanLimits } from '../config/plans'

/**
 * Server-side repository for users/{firebaseUid} (Admin SDK, bypasses rules).
 * This is the only place allowed to write plan / legacySupabaseId.
 */

export type PlanSource = 'default' | 'legacy' | 'stripe'

export interface UserRecord {
  uid:   string
  email: string
  displayName?: string | null
  avatarUrl?:   string | null
  plan:  { tier: PlanTier; source: PlanSource; validUntil?: Date | null }
  legacySupabaseId?: string
}

const users = () => firestore().collection('users')
const TIERS: readonly PlanTier[] = ['free', 'pro', 'wedding']

function toRecord(uid: string, d: FirebaseFirestore.DocumentData): UserRecord {
  const tier: PlanTier = TIERS.includes(d.plan?.tier) ? d.plan.tier : 'free'
  return {
    uid,
    email: d.email ?? '',
    displayName: d.displayName ?? null,
    avatarUrl:   d.avatarUrl ?? null,
    plan: {
      tier,
      source: d.plan?.source ?? 'default',
      validUntil: d.plan?.validUntil instanceof Timestamp ? d.plan.validUntil.toDate() : null,
    },
    legacySupabaseId: d.legacySupabaseId,
  }
}

export async function getUserByUid(uid: string): Promise<UserRecord | null> {
  const snap = await users().doc(uid).get()
  return snap.exists ? toRecord(uid, snap.data()!) : null
}

export async function getUserByLegacyId(legacySupabaseId: string): Promise<UserRecord | null> {
  const q = await users().where('legacySupabaseId', '==', legacySupabaseId).limit(1).get()
  return q.empty ? null : toRecord(q.docs[0].id, q.docs[0].data())
}

/** Creates the document if missing (free/default plan). Never overwrites an existing plan. */
export async function ensureUser(input: { uid: string; email: string; displayName?: string | null }): Promise<UserRecord> {
  const ref = users().doc(input.uid)
  await firestore().runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return
    tx.set(ref, {
      uid: input.uid, email: input.email,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      plan: { tier: 'free', source: 'default' },
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    })
  })
  return (await getUserByUid(input.uid))!
}

/** Server-side plan write (future Stripe webhook / Functions). */
export async function setPlan(uid: string, plan: { tier: PlanTier; source: PlanSource; validUntil?: Date | null }): Promise<void> {
  await users().doc(uid).update({
    plan: { tier: plan.tier, source: plan.source, ...(plan.validUntil ? { validUntil: Timestamp.fromDate(plan.validUntil) } : {}) },
    updatedAt: FieldValue.serverTimestamp(),
  })
}

/** Links an existing Firebase user to its Supabase row (transitional, owner / legacy records). */
export async function linkLegacySupabaseId(uid: string, legacySupabaseId: string): Promise<void> {
  await users().doc(uid).update({ legacySupabaseId, updatedAt: FieldValue.serverTimestamp() })
}

export async function getPlanTier(uid: string): Promise<PlanTier> {
  return (await getUserByUid(uid))?.plan.tier ?? 'free'
}

/** Entitlements are derived from the tier (single source: config/plans.ts), never stored. */
export async function getEntitlements(uid: string): Promise<PlanLimits> {
  return PLAN_LIMITS[await getPlanTier(uid)]
}
