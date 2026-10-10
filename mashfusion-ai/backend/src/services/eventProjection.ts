import type { Request } from 'express'
import { isFirebaseAuthConfigured } from '../lib/firebaseAdmin'
import type { AuthUser } from '../middleware/auth'
import type { LegacySessionRow } from '../repositories/eventRepository'
import type { LegacyRequestRow, RequestStatus } from '../repositories/requestRepository'
import type { LegacyDedicationRow, DedicationStatus } from '../repositories/dedicationRepository'
import type { LegacyPollRow } from '../repositories/pollRepository'

/**
 * TRANSITIONAL one-way projection Supabase live_sessions → Firestore events.
 *
 * - Disabled unless FIRESTORE_EVENT_PROJECTION=on (production behaviour is unchanged).
 * - Only for requests authenticated with Firebase (we need the owner's Firebase UID).
 * - Best effort and never throws: Supabase is authoritative, a failed projection is
 *   logged and repaired by the next write of that session.
 *   TODO(firebase-migration): a backfill script for pre-existing sessions is still missing.
 * - It is NOT a dual-write of truth: Firestore is never read back into Supabase.
 */
const enabled = () => process.env.FIRESTORE_EVENT_PROJECTION === 'on' && isFirebaseAuthConfigured()
const ownerOf = (req: Request): string | null => {
  const u = (req as any).user as AuthUser | undefined
  return u?.provider === 'firebase' ? u.uid : null
}

export async function projectSession(req: Request, row: LegacySessionRow): Promise<void> {
  const uid = ownerOf(req)
  if (!enabled() || !uid) return
  try {
    const { upsertEventFromLegacy } = await import('../repositories/eventRepository')
    const [requestLimit, dedicationsEnabled] = await Promise.all([requestLimitFor(row), dedicationsEnabledFor(row)])
    // undefined (unknown plan) must not reach Firestore: it rejects undefined values.
    await upsertEventFromLegacy(uid, row, {
      ...(requestLimit === undefined ? {} : { requestLimit }),
      ...(dedicationsEnabled === undefined ? {} : { dedicationsEnabled }),
    })
  } catch (e) {
    console.error('[eventProjection] upsert failed for session', row.id, (e as Error).message)
  }
}

export async function projectSessionDeleted(req: Request, legacyId: string): Promise<void> {
  const uid = ownerOf(req)
  if (!enabled() || !uid) return
  try {
    const { deleteEventByLegacyId } = await import('../repositories/eventRepository')
    await deleteEventByLegacyId(uid, legacyId)
  } catch (e) {
    console.error('[eventProjection] delete failed for session', legacyId, (e as Error).message)
  }
}

/**
 * Request limit bridge (plan authority is still Supabase): computed here, server-side, from the DJ's
 * EFFECTIVE plan (incl. Event Pass) and stored on the event for the createMusicRequest Function.
 * Limitation: refreshed only when the session is written; a plan/pass change mid-event is picked up at
 * the next session update. TODO(firebase-migration): replace when plan/entitlements live in Firestore.
 */
async function requestLimitFor(row: LegacySessionRow): Promise<number | null | undefined> {
  if (!row.dj_id) return undefined
  const [{ getEffectivePlan }, { PLAN_LIMITS }] = await Promise.all([import('./plan'), import('../config/plans')])
  const max = PLAN_LIMITS[await getEffectivePlan(row.dj_id, row.id)].maxRequestsPerSession
  return Number.isFinite(max) ? max : null
}

/**
 * Same bridge for dedications: legacy POST requires a party/wedding session AND hasEventAccess(dj, session)
 * (Advance plan or active Event Pass). Computed server-side; refreshed on the next write of the session.
 */
async function dedicationsEnabledFor(row: LegacySessionRow): Promise<boolean | undefined> {
  if (!row.dj_id) return undefined
  const { hasEventAccess } = await import('./plan')
  return hasEventAccess(row.dj_id, row.id)
}

// ── live_requests projection (same flag, same rules: best effort, never throws) ──────────────
export async function projectRequestCreated(row: LegacyRequestRow): Promise<void> {
  if (!enabled()) return
  try { await (await import('../repositories/requestRepository')).projectRequestCreated(row) }
  catch (e) { console.error('[requestProjection] create failed', row.id, (e as Error).message) }
}
export async function projectRequestStatus(sessionId: string, requestId: string, status: RequestStatus): Promise<void> {
  if (!enabled()) return
  try { await (await import('../repositories/requestRepository')).projectRequestStatus(sessionId, requestId, status) }
  catch (e) { console.error('[requestProjection] status failed', requestId, (e as Error).message) }
}
export async function projectRequestDeleted(sessionId: string, requestId: string): Promise<void> {
  if (!enabled()) return
  try { await (await import('../repositories/requestRepository')).projectRequestDeleted(sessionId, requestId) }
  catch (e) { console.error('[requestProjection] delete failed', requestId, (e as Error).message) }
}

// ── live_dedications projection (same flag, same rules) ──────────────────────────────────────
export async function projectDedicationCreated(row: LegacyDedicationRow): Promise<void> {
  if (!enabled()) return
  try { await (await import('../repositories/dedicationRepository')).projectDedicationCreated(row) }
  catch (e) { console.error('[dedicationProjection] create failed', row.id, (e as Error).message) }
}
export async function projectDedicationStatus(sessionId: string, id: string, status: DedicationStatus): Promise<void> {
  if (!enabled()) return
  try { await (await import('../repositories/dedicationRepository')).projectDedicationStatus(sessionId, id, status) }
  catch (e) { console.error('[dedicationProjection] status failed', id, (e as Error).message) }
}
export async function projectDedicationDeleted(sessionId: string, id: string): Promise<void> {
  if (!enabled()) return
  try { await (await import('../repositories/dedicationRepository')).projectDedicationDeleted(sessionId, id) }
  catch (e) { console.error('[dedicationProjection] delete failed', id, (e as Error).message) }
}

// ── live_polls / live_poll_votes projection (same flag, same rules) ──────────────────────────
export async function projectPollCreated(row: LegacyPollRow, closedPollIds: string[] = []): Promise<void> {
  if (!enabled()) return
  try {
    const repo = await import('../repositories/pollRepository')
    // Creating a poll deactivates the previous ones of the session (legacy behaviour): mirror it first.
    for (const id of closedPollIds) await repo.projectPollActive(row.session_id, id, false)
    await repo.projectPollCreated(row)
  } catch (e) { console.error('[pollProjection] create failed', row.id, (e as Error).message) }
}
export async function projectPollActive(sessionId: string, pollId: string, isActive: boolean): Promise<void> {
  if (!enabled()) return
  try { await (await import('../repositories/pollRepository')).projectPollActive(sessionId, pollId, isActive) }
  catch (e) { console.error('[pollProjection] status failed', pollId, (e as Error).message) }
}
export async function projectLegacyVote(sessionId: string, pollId: string, previous: number | null, next: number): Promise<void> {
  if (!enabled()) return
  try { await (await import('../repositories/pollRepository')).projectLegacyVote(sessionId, pollId, previous, next) }
  catch (e) { console.error('[pollProjection] legacy vote failed', pollId, (e as Error).message) }
}
