import { Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { resolveEntitlements, type Entitlements, type EventPassDoc, type EventRef, type PassStatus, type PlanDoc } from './resolve'
import { scopeOf, type ProductScope } from './scope'
import { eventBrandOf } from '../owner/brand'

/**
 * Firestore loaders around resolveEntitlements (Admin SDK: server side only). Entitlements are SCOPED by product (see ./scope):
 *   users/{uid}                    { plan: { tier, source, validUntil? } (IOMIXO), miolovePlan: { ... } (MIOLOVE), legacySupabaseId? }
 *   users/{uid}/eventPasses/{key}  { status, validUntil, eventId?, legacySessionId?, productScope?, ... }  (server-written; no scope = IOMIXO)
 * No composite index is needed: passes are read with a single-field range on validUntil and filtered in memory.
 */
const STATUSES: readonly PassStatus[] = ['active', 'expired', 'refunded']
const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null)

export interface AccountRef { uid?: string; legacyUserId?: string }

/** Resolves the Firestore uid from a Firebase uid or, during the transition, the Supabase user id (users.legacySupabaseId). */
export async function resolveAccountUid(db: Firestore, who: AccountRef): Promise<string | null> {
  if (who.uid) return who.uid
  if (!who.legacyUserId) return null
  const q = await db.collection('users').where('legacySupabaseId', '==', who.legacyUserId).limit(1).get()
  return q.empty ? null : q.docs[0].id
}

/** Raw account data behind an entitlement verdict. `planSource` tells whether a SERVER wrote the plan (legacy projection / Stripe). */
export interface AccountData { uid: string | null; plan: PlanDoc | null; planSource: string | null; passes: EventPassDoc[] }

export async function readAccount(db: Firestore, who: AccountRef, now: Date = new Date(), scope: ProductScope = 'iomixo'): Promise<AccountData> {
  const uid = await resolveAccountUid(db, who)
  if (!uid) return { uid: null, plan: null, planSource: null, passes: [] }
  const userRef = db.collection('users').doc(uid)
  const [user, passSnap] = await Promise.all([
    userRef.get(),
    userRef.collection('eventPasses').where('validUntil', '>', Timestamp.fromDate(now)).limit(50).get(),
  ])
  const d = user.data()
  const planDoc = scope === 'miolove' ? d?.miolovePlan : d?.plan
  const plan: PlanDoc | null = planDoc ? { tier: String(planDoc.tier ?? 'free'), source: planDoc.source, validUntil: toDate(planDoc.validUntil) } : null
  const passes: EventPassDoc[] = passSnap.docs.flatMap((s) => {
    const p = s.data(), until = toDate(p.validUntil)
    if (!until || !STATUSES.includes(p.status) || scopeOf(p.productScope) !== scope) return []
    return [{ id: s.id, status: p.status as PassStatus, validUntil: until, eventId: p.eventId ?? null, legacySessionId: p.legacySessionId ?? null }]
  })
  return { uid, plan, planSource: planDoc?.source ? String(planDoc.source) : null, passes }
}

export async function loadEntitlements(
  db: Firestore, who: AccountRef, event: EventRef | null = null, now: Date = new Date(), scope: ProductScope = 'iomixo',
): Promise<Entitlements> {
  const acc = await readAccount(db, who, now, scope)
  return resolveEntitlements({ plan: acc.plan, passes: acc.passes, event, now })      // unknown account → free, no passes
}

/**
 * Entitlements that govern ONE event: the scope is the event's own product (brand), so an IOMIXO plan / pass never counts on a MIOLOVE album and the reverse.
 * A MIOLOVE album already marked `activated` keeps the full feature set it was activated with (that mark is its MIOLOVE entitlement record).
 */
export function resolveForEvent(scope: ProductScope, acc: AccountData, eventId: string, ev: DocumentData, now: Date): Entitlements {
  const event: EventRef = { id: eventId, legacySessionId: ev.legacySupabaseId ?? null }
  const ent = resolveEntitlements({ plan: acc.plan, passes: acc.passes, event, now })
  if (scope === 'miolove' && ev.accessMode === 'activated' && !ent.eventAccess) return resolveEntitlements({ plan: { tier: 'wedding', source: 'miolove_activated' }, passes: [], event, now })
  return ent
}

/** Entitlements of the DJ who owns an event, evaluated for THAT event (what hasEventAccess(dj_id, session_id) does today). */
export async function loadEventEntitlements(db: Firestore, eventId: string, now: Date = new Date()): Promise<Entitlements & { ownerUid: string }> {
  const ev = await db.collection('events').doc(eventId).get()
  if (!ev.exists) throw new HttpsError('not-found', 'Event not found', { reason: 'event_not_found' })
  const e = ev.data()!
  const ownerUid = String(e.ownerUid ?? '')
  const scope = await eventBrandOf(db, e)
  const acc = await readAccount(db, { uid: ownerUid }, now, scope)
  return { ...resolveForEvent(scope, acc, eventId, e, now), ownerUid }
}

/** hasEventAccess replacement: throws a typed business error instead of returning false. */
export async function requireEventAccess(db: Firestore, eventId: string, now: Date = new Date()): Promise<Entitlements & { ownerUid: string }> {
  const ent = await loadEventEntitlements(db, eventId, now)
  if (!ent.eventAccess) throw new HttpsError('permission-denied', 'Advance plan or an Event Pass is required', { reason: 'event_access_required' })
  return ent
}

/** hasEventAccess for an account, optionally scoped to an event (Firebase uid or legacy user id). */
export async function hasEventAccess(db: Firestore, who: AccountRef, event: EventRef | null = null, now: Date = new Date()): Promise<boolean> {
  return (await loadEntitlements(db, who, event, now)).eventAccess
}
