import { FieldValue } from 'firebase-admin/firestore'
import { eventRefByLegacySession, projectChildCreated, projectChildStatus, type ChildSpec } from './eventChildProjection'

/**
 * Projection of Supabase `live_polls` / `live_poll_votes` into
 *   events/{eventId}/polls/{pollId}            question, options[], status open|closed
 *   events/{eventId}/polls/{pollId}/tally/{s}  sharded counts { counts: { o0: n, ... } }
 * Votes cast through the votePoll Cloud Function live in tally shards s0..s4 (+ votes/{uid}); votes that still
 * arrive through the legacy Express route are folded into the `legacy` shard, so the sum is complete.
 */
export type PollStatus = 'open' | 'closed'

export interface LegacyPollRow {
  id: string
  session_id: string
  question: string
  options: string[]
  is_active: boolean
  created_at?: string
}

const SPEC: ChildSpec = { collection: 'polls' }
const status = (active: boolean): PollStatus => (active ? 'open' : 'closed')

export const projectPollCreated = (row: LegacyPollRow) =>
  projectChildCreated(SPEC, row.session_id, row.id, {
    question: row.question,
    options: row.options,
    status: status(row.is_active),
  }, row.created_at)

export const projectPollActive = (sessionId: string, legacyId: string, isActive: boolean) =>
  projectChildStatus(SPEC, sessionId, legacyId, status(isActive))

async function pollRef(sessionId: string, legacyPollId: string) {
  const eventRef = await eventRefByLegacySession(sessionId)
  if (!eventRef) return null
  const q = await eventRef.collection('polls').where('legacySupabaseId', '==', legacyPollId).limit(1).get()
  return q.empty ? null : q.docs[0].ref
}

/**
 * A vote that arrived through the legacy route: move one unit in the `legacy` shard.
 * `previous` = option of the same client's earlier vote (null for a first vote).
 */
export async function projectLegacyVote(sessionId: string, legacyPollId: string, previous: number | null, next: number): Promise<boolean> {
  if (previous === next) return false
  const ref = await pollRef(sessionId, legacyPollId)
  if (!ref) return false
  const counts: Record<string, FirebaseFirestore.FieldValue> = { [`o${next}`]: FieldValue.increment(1) }
  if (previous !== null) counts[`o${previous}`] = FieldValue.increment(-1)
  await ref.collection('tally').doc('legacy').set({ counts, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return true
}

/** Backfill: set the `legacy` shard to the given counts (idempotent; replaces the shard). */
export async function setLegacyTally(sessionId: string, legacyPollId: string, counts: number[]): Promise<boolean> {
  const ref = await pollRef(sessionId, legacyPollId)
  if (!ref) return false
  await ref.collection('tally').doc('legacy').set({
    counts: Object.fromEntries(counts.map((n, i) => [`o${i}`, n])), updatedAt: FieldValue.serverTimestamp(),
  })
  return true
}

