import type { Firestore } from 'firebase-admin/firestore'

export class UnresolvedAccountError extends Error { constructor() { super('unresolved_account') } }

export interface AccountHints { firebaseUid?: string | null; customerId?: string | null; legacyUserId?: string | null }
/**
 * Stripe object → Firebase account, in order of trust:
 *   1. metadata.firebaseUid (set by createCheckoutSession) — only if that account exists
 *   2. stripeCustomers/{customerId} (reverse mapping written at customer creation / by the backfill)
 *   3. users.legacySupabaseId == metadata.legacySupabaseId | metadata.user_id (checkouts started by the old backend)
 * Anything else is an explicit error: the webhook fails (non-2xx) instead of guessing.
 */
export async function resolveUid(db: Firestore, h: AccountHints): Promise<string> {
  if (h.firebaseUid && (await db.doc(`users/${h.firebaseUid}`).get()).exists) return h.firebaseUid
  if (h.customerId) {
    const m = await db.doc(`stripeCustomers/${h.customerId}`).get()
    const uid = m.data()?.uid
    if (typeof uid === 'string' && (await db.doc(`users/${uid}`).get()).exists) return uid
  }
  if (h.legacyUserId) {
    const q = await db.collection('users').where('legacySupabaseId', '==', h.legacyUserId).limit(2).get()
    if (q.size === 1) return q.docs[0].id
  }
  throw new UnresolvedAccountError()
}
