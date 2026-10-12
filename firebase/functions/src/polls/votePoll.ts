import { FieldValue, Timestamp, type Firestore, type DocumentReference } from 'firebase-admin/firestore'
import type { LegacyBridge } from '../requests/legacyBridge'
import type { VoteInput } from './validation'
import { fail, loadLiveEvent } from '../shared/guard'

/**
 * Poll voting policy.
 * - Legacy behaviour (verified): one vote per guest, and voting again CHANGES the choice
 *   (upsert on (poll_id, ip_hash)); legacy rate limit 1.5 s per client.
 * - ALLOW_CHANGE=false switches to "final vote": a second, different vote is rejected with `already_voted`.
 */
export const VOTE_POLICY = { allowChange: true, changeCooldownMs: 1_500, shards: 5 } as const

export interface VoteResult { optionIndex: number; changed: boolean; alreadyVoted: boolean }

/** Stable shard per guest: spreads write contention while keeping a guest's votes on one shard. */
export function shardOf(uid: string, shards: number = VOTE_POLICY.shards): number {
  let h = 2166136261
  for (let i = 0; i < uid.length; i++) { h ^= uid.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) % shards
}

const key = (i: number) => `o${i}`
const inc = (n: number) => FieldValue.increment(n)

/**
 * Casts / changes a vote atomically.
 *
 * Authority: Supabase `live_poll_votes` stays authoritative (dashboard, TV `/screen`, remote read it).
 * Order: 1) ONE Firestore transaction: vote doc `polls/{id}/votes/{uid}` + tally shard increments.
 *        2) idempotent Supabase upsert keyed by the guest (`ip_hash = 'fb:<uid>'`).
 *        3) converge check: if a concurrent change by the same guest committed in between, re-send the latest.
 * Failure handling:
 *   - Firestore transaction fails → nothing was written; the client may simply retry.
 *   - Supabase fails → compensating transaction restores the previous state (only if it is still ours); `bridge_failed`.
 *   - Process dies between 1 and 2 → Firestore is ahead; a retry with the same option is a no-op in Firestore
 *     but re-sends the (idempotent) Supabase upsert, repairing it.
 *   - Double click / two simultaneous calls by the same uid → serialised by the transaction on `votes/{uid}`:
 *     one effect, the other returns `alreadyVoted`.
 */
export async function votePoll(
  db: Firestore, bridge: LegacyBridge | null, uid: string, input: VoteInput, now: () => number = Date.now,
): Promise<VoteResult> {
  const { ref: eventRef } = await loadLiveEvent(db, input.eventId)
  // NO entitlement check here, on purpose (legacy semantics): the premium gate belongs to the DJ side — creating / opening / closing a poll.
  // A poll that exists and is `open` was authorised when it was opened, and a later expiry of the Event Pass does not invalidate it.
  // TODO(firebase-migration): when poll management (create/open/close) moves to Functions, apply requireEventAccess THERE
  // (entitlements/load.ts), never on the guest vote.
  const pollRef = eventRef.collection('polls').doc(input.pollId)
  const poll = await pollRef.get()
  if (!poll.exists) throw fail('not-found', 'Poll not found', 'poll_not_found')
  const p = poll.data()!
  if (p.status !== 'open') throw fail('failed-precondition', 'Poll closed', 'poll_closed')
  if (!Array.isArray(p.options) || input.optionIndex >= p.options.length) throw fail('invalid-argument', 'Invalid option', 'invalid_option')
  // A poll WITHOUT legacySupabaseId was created natively in Firestore (createPoll callable): there is no Supabase row to mirror,
  // so the bridge is skipped for it. Polls projected from Supabase always carry the legacy id and keep the bridge.
  const legacyBridge = p.legacySupabaseId ? bridge : null

  const voteRef  = pollRef.collection('votes').doc(uid)
  const shardRef = pollRef.collection('tally').doc(`s${shardOf(uid)}`)
  const t0 = now()
  const opt = input.optionIndex

  const outcome = await db.runTransaction(async (tx) => {
    const [pollNow, vote] = await Promise.all([tx.get(pollRef), tx.get(voteRef)])
    if (pollNow.data()?.status !== 'open') throw fail('failed-precondition', 'Poll closed', 'poll_closed')

    if (!vote.exists) {
      tx.create(voteRef, { optionIndex: opt, createdAt: Timestamp.fromMillis(t0), updatedAt: Timestamp.fromMillis(t0) })
      tx.set(shardRef, { counts: { [key(opt)]: inc(1) }, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      return { kind: 'new' as const, prev: null as number | null }
    }
    const prev = vote.data()!.optionIndex as number
    if (prev === opt) return { kind: 'same' as const, prev }
    if (!VOTE_POLICY.allowChange) throw fail('already-exists', 'You already voted', 'already_voted')
    const last = (vote.data()!.updatedAt as Timestamp).toMillis()
    if (t0 - last < VOTE_POLICY.changeCooldownMs) throw fail('resource-exhausted', 'Please wait before changing your vote', 'cooldown')
    tx.update(voteRef, { optionIndex: opt, updatedAt: Timestamp.fromMillis(t0) })
    tx.set(shardRef, { counts: { [key(prev)]: inc(-1), [key(opt)]: inc(1) }, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return { kind: 'changed' as const, prev }
  })

  if (legacyBridge) {
    try {
      await legacyBridge.upsertPollVote({ pollId: p.legacySupabaseId, guestKey: `fb:${uid}`, optionIndex: opt })
      // Converge: a concurrent change by the same guest may have committed meanwhile; make Supabase match Firestore.
      const current = (await voteRef.get()).data()?.optionIndex as number | undefined
      if (current !== undefined && current !== opt) {
        await legacyBridge.upsertPollVote({ pollId: p.legacySupabaseId, guestKey: `fb:${uid}`, optionIndex: current })
        return { optionIndex: current, changed: outcome.kind === 'changed', alreadyVoted: false }
      }
    } catch (e) {
      if (outcome.kind !== 'same') await compensate(db, voteRef, shardRef, opt, outcome)
      console.error('[votePoll] legacy upsert failed', (e as Error).message)
      throw fail('unavailable', 'Could not save the vote, please retry', 'bridge_failed')
    }
  }
  return { optionIndex: opt, changed: outcome.kind === 'changed', alreadyVoted: outcome.kind === 'same' }
}

/** Undo our own write, but only if the vote is still the one we wrote. */
async function compensate(
  db: Firestore, voteRef: DocumentReference, shardRef: DocumentReference, opt: number,
  outcome: { kind: 'new' | 'changed' | 'same'; prev: number | null },
) {
  await db.runTransaction(async (tx) => {
    const v = await tx.get(voteRef)
    if (!v.exists || v.data()!.optionIndex !== opt) return
    if (outcome.kind === 'new') {
      tx.delete(voteRef)
      tx.set(shardRef, { counts: { [key(opt)]: inc(-1) } }, { merge: true })
    } else if (outcome.kind === 'changed' && outcome.prev !== null) {
      tx.update(voteRef, { optionIndex: outcome.prev, updatedAt: FieldValue.serverTimestamp() })
      tx.set(shardRef, { counts: { [key(opt)]: inc(-1), [key(outcome.prev)]: inc(1) } }, { merge: true })
    }
  }).catch((err) => console.error('[votePoll] rollback failed', err))
}
