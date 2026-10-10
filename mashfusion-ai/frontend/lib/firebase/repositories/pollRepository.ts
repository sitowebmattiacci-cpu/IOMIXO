import {
  collection, doc, onSnapshot, query, where, orderBy, limit, getDocs, Timestamp,
  type Firestore, type DocumentData, type Unsubscribe,
} from 'firebase/firestore'
import type { PollDoc, PollStatus } from '../models'

// Read-only repository for events/{eventId}/polls (+ tally shards + the guest's own vote).
// Votes are cast by the votePoll Cloud Function; nothing is written from the client.

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null)

export function fromPollDoc(id: string, d: DocumentData): PollDoc {
  const status: PollStatus = d.status === 'open' ? 'open' : 'closed'
  return {
    id,
    question: d.question ?? '',
    options:  Array.isArray(d.options) ? d.options.map(String) : [],
    status,
    legacySupabaseId: d.legacySupabaseId,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

/**
 * The tally is split into shards (to avoid write contention on one document):
 * `s0..s4` from the Cloud Function, `legacy` from the legacy route. Result = per-option sum.
 * Individual shards may hold negative numbers (a changed vote decrements the old option); only the sum matters.
 */
export function sumTally(shards: Array<DocumentData | undefined>, optionCount: number): number[] {
  const out = new Array(optionCount).fill(0)
  for (const s of shards) {
    const counts = s?.counts ?? {}
    for (let i = 0; i < optionCount; i++) out[i] += Number(counts[`o${i}`] ?? 0)
  }
  return out.map((n) => Math.max(0, n))
}

const pollsCol = (db: Firestore, eventId: string) => collection(db, 'events', eventId, 'polls')

/** The currently open poll (newest open one, like the legacy `/polls/active`). */
const activeQuery = (db: Firestore, eventId: string) =>
  query(pollsCol(db, eventId), where('status', '==', 'open'), orderBy('createdAt', 'desc'), limit(1))

export async function getActivePoll(db: Firestore, eventId: string): Promise<PollDoc | null> {
  const snap = await getDocs(activeQuery(db, eventId))
  return snap.empty ? null : fromPollDoc(snap.docs[0].id, snap.docs[0].data())
}

/** Realtime: the open poll of ONE event. `null` = no open poll. */
export function subscribeActivePoll(
  db: Firestore, eventId: string, onChange: (poll: PollDoc | null) => void, onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(activeQuery(db, eventId),
    (snap) => onChange(snap.empty ? null : fromPollDoc(snap.docs[0].id, snap.docs[0].data())),
    (e) => onError?.(e))
}

/** Realtime: summed counts of ONE poll — listens to the (at most 6) shard docs, never to the votes. */
export function subscribePollTally(
  db: Firestore, eventId: string, pollId: string, optionCount: number,
  onChange: (counts: number[]) => void, onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(collection(db, 'events', eventId, 'polls', pollId, 'tally'),
    (snap) => onChange(sumTally(snap.docs.map((d) => d.data()), optionCount)),
    (e) => onError?.(e))
}

/** Realtime: the guest's OWN vote (`votes/{uid}`); `null` = has not voted. Lets the UI survive reloads. */
export function subscribeMyVote(
  db: Firestore, eventId: string, pollId: string, uid: string,
  onChange: (optionIndex: number | null) => void, onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(doc(db, 'events', eventId, 'polls', pollId, 'votes', uid),
    (snap) => onChange(snap.exists() ? (snap.data().optionIndex as number) : null),
    (e) => onError?.(e))
}

/** Realtime: the event's polls (newest first, bounded) — used by the DJ as a change signal. */
export function subscribeEventPolls(
  db: Firestore, eventId: string, onChange: (polls: PollDoc[]) => void, onError?: (e: Error) => void, max = 20,
): Unsubscribe {
  return onSnapshot(query(pollsCol(db, eventId), orderBy('createdAt', 'desc'), limit(max)),
    (snap) => onChange(snap.docs.map((d) => fromPollDoc(d.id, d.data()))), (e) => onError?.(e))
}
