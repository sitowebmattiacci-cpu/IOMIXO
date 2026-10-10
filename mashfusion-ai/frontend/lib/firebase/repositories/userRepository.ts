import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp,
  type Firestore, type DocumentData,
} from 'firebase/firestore'
import type { UserDoc, UserProfilePatch, PlanTier } from '../models'

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
