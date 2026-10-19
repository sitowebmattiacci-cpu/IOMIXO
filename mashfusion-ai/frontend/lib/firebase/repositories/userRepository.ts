import {
  collection, doc, getDoc, getDocs, limit, setDoc, updateDoc, serverTimestamp, Timestamp, query,
  type Firestore, type DocumentData,
} from 'firebase/firestore'
import type { UserDoc, UserProfilePatch, PlanTier, AccountType, EventPassDoc, SubscriptionDoc, PaymentDoc } from '../models'

// Repository: the ONLY place that knows the users/{uid} path and field names.
// Firestore instance is injected so it can be tested against the emulator.

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null)
const tiers: readonly PlanTier[] = ['free', 'pro', 'wedding']
const scopeOf = (v: unknown): 'iomixo' | 'miolove' => (v === 'miolove' ? 'miolove' : 'iomixo')     // no scope = IOMIXO

function fromDoc(uid: string, d: DocumentData): UserDoc {
  const tier = tiers.includes(d.plan?.tier) ? d.plan.tier : 'free'
  return {
    uid,
    ...(d.miolovePlan ? { miolovePlan: { tier: tiers.includes(d.miolovePlan.tier) ? d.miolovePlan.tier : 'free', source: d.miolovePlan.source ?? 'default', validUntil: toDate(d.miolovePlan.validUntil) } } : {}),
    ...(d.accountType === 'dj' || d.accountType === 'couple' ? { accountType: d.accountType as AccountType } : {}),
    email:       d.email ?? '',
    displayName: d.displayName ?? null,
    avatarUrl:   d.avatarUrl ?? null,
    avatarPath:  d.avatarPath ?? null,
    plan:        { tier, source: d.plan?.source ?? 'default', validUntil: toDate(d.plan?.validUntil) },
    ...(d.miolovePlan ? { miolovePlan: { tier: tiers.includes(d.miolovePlan.tier) ? d.miolovePlan.tier : 'free', source: d.miolovePlan.source ?? 'default', validUntil: toDate(d.miolovePlan.validUntil) } } : {}),
    legacySupabaseId: d.legacySupabaseId,
    createdAt:   toDate(d.createdAt),
    updatedAt:   toDate(d.updatedAt),
  }
}

export async function getUser(db: Firestore, uid: string): Promise<UserDoc | null> {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? fromDoc(uid, snap.data()) : null
}

/** Creates the FREE default document. Rules reject anything else from a client. */
export async function createUser(
  db: Firestore,
  input: { uid: string; email: string; displayName?: string | null; accountType?: AccountType },
): Promise<void> {
  await setDoc(doc(db, 'users', input.uid), {
    uid:   input.uid,
    email: input.email,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accountType ? { accountType: input.accountType } : {}),
    plan:  { tier: 'free', source: 'default' },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function updateUserProfile(db: Firestore, uid: string, patch: UserProfilePatch): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { ...patch, updatedAt: serverTimestamp() })
}

/** users/{uid}/eventPasses: server-written, readable by the owner. Unordered query (no index, tolerates docs without createdAt); newest first in memory. */
export async function listEventPasses(db: Firestore, uid: string, max = 50): Promise<EventPassDoc[]> {
  const snap = await getDocs(query(collection(db, 'users', uid, 'eventPasses'), limit(max)))
  const passes = snap.docs.flatMap((s): EventPassDoc[] => {
    const d = s.data(), until = toDate(d.validUntil)
    if (!until || !['active', 'expired', 'refunded'].includes(d.status)) return []
    return [{
      id: s.id, status: d.status, validUntil: until,
      legacySessionId: d.legacySessionId ?? null, eventId: d.eventId ?? null, legacySupabaseId: d.legacySupabaseId ?? null,
      stripePaymentIntentId: d.stripePaymentIntentId ?? null, amountCents: d.amountCents ?? 0, currency: d.currency ?? 'eur', productScope: scopeOf(d.productScope),
      createdAt: toDate(d.createdAt), updatedAt: toDate(d.sourceUpdatedAt) ?? toDate(d.updatedAt),
    }]
  })
  return passes.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
}

/** users/{uid}/subscriptions: server-written (webhook; legacy history from the backfill, flagged `historical`). Unordered query; the caller picks. */
export async function listSubscriptions(db: Firestore, uid: string, max = 20): Promise<SubscriptionDoc[]> {
  const snap = await getDocs(query(collection(db, 'users', uid, 'subscriptions'), limit(max)))
  return snap.docs.map((s): SubscriptionDoc => {
    const d = s.data()
    return {
      id: s.id, status: String(d.status ?? d.legacyStatus ?? ''), historical: d.historical === true, stale: d.stale === true,
      tier: tiers.includes(d.tier) ? d.tier : null, stripeSubscriptionId: d.stripeSubscriptionId ?? s.id, stripeCustomerId: d.stripeCustomerId ?? null, productScope: scopeOf(d.productScope),
      currentPeriodStart: toDate(d.currentPeriodStart), currentPeriodEnd: toDate(d.currentPeriodEnd), cancelAtPeriodEnd: d.cancelAtPeriodEnd === true, createdAt: toDate(d.createdAt),
    }
  })
}

/** users/{uid}/payments: the billing ledger (server-written). Newest first in memory (no index). */
export async function listPayments(db: Firestore, uid: string, max = 50): Promise<PaymentDoc[]> {
  const snap = await getDocs(query(collection(db, 'users', uid, 'payments'), limit(max)))
  return snap.docs.map((s): PaymentDoc => {
    const d = s.data()
    return { id: s.id, userRef: uid, stripePaymentIntentId: d.stripePaymentIntentId ?? d.stripeCheckoutSessionId ?? s.id, amountCents: d.amountCents ?? 0, currency: d.currency ?? 'eur', status: String(d.status ?? 'succeeded'), description: d.description ?? '', createdAt: toDate(d.createdAt), productScope: scopeOf(d.productScope) }
  }).sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
}
