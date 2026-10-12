import {
  collection, doc, getDoc, getDocs, limit, setDoc, updateDoc, serverTimestamp, Timestamp, query,
  type Firestore, type DocumentData,
} from 'firebase/firestore'
import type { UserDoc, UserProfilePatch, PlanTier, EventPassDoc } from '../models'

// Repository: the ONLY place that knows the users/{uid} path and field names.
// Firestore instance is injected so it can be tested against the emulator.

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null)
const tiers: readonly PlanTier[] = ['free', 'pro', 'wedding']

function fromDoc(uid: string, d: DocumentData): UserDoc {
  const tier = tiers.includes(d.plan?.tier) ? d.plan.tier : 'free'
  return {
    uid,
    email:       d.email ?? '',
    displayName: d.displayName ?? null,
    avatarUrl:   d.avatarUrl ?? null,
    avatarPath:  d.avatarPath ?? null,
    plan:        { tier, source: d.plan?.source ?? 'default', validUntil: toDate(d.plan?.validUntil) },
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
  input: { uid: string; email: string; displayName?: string | null },
): Promise<void> {
  await setDoc(doc(db, 'users', input.uid), {
    uid:   input.uid,
    email: input.email,
    ...(input.displayName ? { displayName: input.displayName } : {}),
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
      stripePaymentIntentId: d.stripePaymentIntentId ?? null, amountCents: d.amountCents ?? 0, currency: d.currency ?? 'eur',
      createdAt: toDate(d.createdAt), updatedAt: toDate(d.sourceUpdatedAt) ?? toDate(d.updatedAt),
    }]
  })
  return passes.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
}
