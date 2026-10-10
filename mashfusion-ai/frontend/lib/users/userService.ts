import { getFirebaseDb } from '../firebase/client'
import { waitForAuthReady } from '../firebase/auth'
import { createUser, getUser, updateUserProfile } from '../firebase/repositories/userRepository'
import type { UserDoc, UserProfilePatch, PlanState } from '../firebase/models'

/**
 * Service layer for the signed-in account. UI calls this (or useUserProfile),
 * never Firestore directly. Requires a non-anonymous Firebase session.
 */
async function currentAccount() {
  const user = await waitForAuthReady()
  if (!user || user.isAnonymous) throw new Error('Not signed in')
  return user
}

/** Returns the profile, creating the default FREE document on first access. */
export async function getCurrentUserProfile(): Promise<UserDoc> {
  const user = await currentAccount()
  const db = getFirebaseDb()
  const existing = await getUser(db, user.uid)
  if (existing) return existing
  await createUser(db, { uid: user.uid, email: user.email ?? '', displayName: user.displayName })
  const created = await getUser(db, user.uid)
  if (!created) throw new Error('Profile creation failed')
  return created
}

export async function updateCurrentUserProfile(patch: UserProfilePatch): Promise<UserDoc> {
  const user = await currentAccount()
  const db = getFirebaseDb()
  await updateUserProfile(db, user.uid, patch)
  return (await getUser(db, user.uid))!
}

/**
 * Plan stored in Firestore. TRANSITIONAL: until the Stripe step writes it
 * server-side, the Supabase plan stays authoritative for billing/limits.
 */
export async function getCurrentPlan(): Promise<PlanState> {
  return (await getCurrentUserProfile()).plan
}
