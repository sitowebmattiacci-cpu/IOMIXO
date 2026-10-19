import { HttpsError } from 'firebase-functions/v2/https'
import type { Firestore, DocumentData, DocumentReference } from 'firebase-admin/firestore'
import { fail } from '../shared/guard'
import { str, LIMITS } from '../requests/validation'
import { selectEventEntitlements, logEntitlementDecision } from '../entitlements/source'
import { eventBrandOf } from './brand'

/** Auth subset of a callable request that the owner guards need. */
export interface CallerAuth { auth?: { uid?: string; token?: { firebase?: { sign_in_provider?: string } } } }

export const idField = (raw: unknown, field: string): string => {
  const v = str(raw, field, LIMITS.eventId, true)!
  if (v.includes('/')) throw new HttpsError('invalid-argument', `invalid ${field}`, { reason: 'invalid_payload', field })
  return v
}

/**
 * Owner-only operations: a real (non-anonymous) account that owns the event. The owner is taken from the verified token and
 * compared with events/{id}.ownerUid; nothing about identity comes from the payload. Unlike guest callables, the event may be ended.
 */
/** A real (non-anonymous) signed-in account; returns its uid. */
export function requireAccount(request: CallerAuth): string {
  const uid = request.auth?.uid
  if (!uid) throw fail('unauthenticated', 'Sign in required', 'unauthenticated')
  if (request.auth?.token?.firebase?.sign_in_provider === 'anonymous') throw fail('permission-denied', 'Account required', 'account_required')
  return uid
}

export type AccountType = 'dj' | 'couple'

/** users/{uid}.accountType. A missing document / field is a LEGACY account created before roles existed: it stays 'dj' (full access). */
export async function loadAccountType(db: Firestore, uid: string): Promise<AccountType> {
  const snap = await db.collection('users').doc(uid).get()
  return snap.exists && snap.data()!.accountType === 'couple' ? 'couple' : 'dj'
}

/** DJ-only operations (live control: requests, dedications, polls, games, screen) are refused on a MIOLOVE album. The decision is per EVENT (its brand), never per account: one uid may own both. */
export async function requireIomixoEvent(db: Firestore, ev: DocumentData): Promise<void> {
  if ((await eventBrandOf(db, ev)) === 'miolove') throw fail('permission-denied', 'DJ account required', 'dj_account_required')
}

/** Soft-deleted events (events/{id}.deletedAt) behave as missing for every owner operation, except an explicit restore. */
export async function requireEventOwner(
  db: Firestore, request: CallerAuth, eventId: string, opts: { allowDeleted?: boolean; djOnly?: boolean } = {},
): Promise<{ uid: string; ref: DocumentReference; data: DocumentData }> {
  const uid = requireAccount(request)
  const ref = db.collection('events').doc(eventId)
  const snap = await ref.get()
  // Same answer for "missing", "deleted" and "not yours": do not reveal which event ids exist.
  if (!snap.exists || snap.data()!.ownerUid !== uid || (snap.data()!.deletedAt && !opts.allowDeleted)) throw fail('not-found', 'Event not found', 'event_not_found')
  if (opts.djOnly) await requireIomixoEvent(db, snap.data()!)
  return { uid, ref, data: snap.data()! }
}

/**
 * hasEventAccess(owner, event) for DJ-side premium gates (dedication moderation, polls). Firestore entitlements decide when they
 * exist for the owner; an owner without a server-written plan falls back to the projected `dedicationsEnabled` (same predicate).
 */
export async function requireOwnerEventAccess(db: Firestore, eventId: string, ev: DocumentData, fn: string): Promise<void> {
  const decision = await selectEventEntitlements(db, eventId, ev)
  const allowed = decision.ent ? decision.ent.gates.polls : ev.dedicationsEnabled === true
  logEntitlementDecision(fn, decision, allowed ? 'allow' : 'deny', 'eventAccess')
  if (!allowed) throw fail('permission-denied', 'Advance plan or an Event Pass is required', 'event_access_required')
}
