import { FieldValue, Timestamp, type Firestore, type DocumentReference, type DocumentData } from 'firebase-admin/firestore'
import { parseSourceTimestamp } from '../repositories/gameRoundRepository'
import { BackfillRefused, maskId, ser } from './entitlementBackfill'
import { decideEvent, type EventRollbackEntry } from './eventBackfill'

/**
 * Backfill of the HISTORICAL children of already-migrated events: live_requests, live_dedications, live_polls (+ live_poll_votes)
 * → events/{eventId}/{requests|dedications|polls}/..., tally shard `legacy`, votes/{uid}, state/requests counter.
 * Library (emulator-testable); the CLI is scripts/backfill-event-history.ts. It never reads Supabase: it receives a snapshot.
 *
 *  - DRY RUN by default; nothing is written unless `apply: true` (guards re-checked before the first write).
 *  - Only sessions whose event ALREADY exists in Firestore (events.legacySupabaseId) and whose owner maps through
 *    users.legacySupabaseId == dj_id are touched. Others are skipped and counted. No email fallback exists here.
 *  - Correlation key: `legacySupabaseId` on each child (same key the projection and the Functions use). Auto document ids, like the projection.
 *  - Versioning: `sourceUpdatedAt` = Supabase updated_at. A child that exists WITHOUT a version (created by a Function / the projection) is never
 *    overwritten unless identical; an older snapshot never overwrites a newer one (decideEvent rules). No delete, ever.
 *  - Guests: legacy rows only carry a hashed IP, which is NOT copied. Requests/dedications get guestUid null (as in the projection).
 *    Poll votes cast through the Firestore callable (ip_hash `fb:<uid>`) restore their votes/{uid} doc (marked `importedOption`), so "my vote" survives.
 *  - Votes: the `legacy` tally shard receives every legacy vote that is NOT already represented by a Firestore vote doc, so the sum of shards
 *    equals the Supabase tally (shards may be negative later when a restored voter changes their vote: only the sum matters).
 *  - Counter: events/{id}/state/requests.total = documents that exist (created now + already there); an existing counter is increased by the
 *    number of requests created now.
 */
export interface HistorySession { id: string; dj_id: string; public_slug?: string }
export interface HistoryRequest { id: string; session_id: string; track_title: string; artist?: string | null; message?: string | null; status?: string; created_at?: string; updated_at?: string }
export interface HistoryDedication { id: string; session_id: string; guest_name?: string | null; message: string; status?: string; created_at?: string; updated_at?: string }
export interface HistoryPoll { id: string; session_id: string; question: string; options: unknown; is_active: boolean; created_at?: string; updated_at?: string }
export interface HistoryVote { poll_id: string; option_index: number; voter?: string | null; created_at?: string }
export interface HistorySnapshot { sessions: HistorySession[]; requests: HistoryRequest[]; dedications: HistoryDedication[]; polls: HistoryPoll[]; votes: HistoryVote[] }

export interface HistoryOptions { apply: boolean; projectId: string; yesProduction?: boolean; legacyUserId?: string; limit?: number }
type Kind = 'requests' | 'dedications' | 'polls'
interface KindStats { read: number; selected: number; invalid: number; duplicate: number; wouldCreate: number; wouldUpdate: number; wouldNoop: number; stale: number; unversioned: number; drift: number }
export interface HistoryReport {
  mode: 'dry-run' | 'apply'; project: string
  sessions: { read: number; selected: number; mapped: number; unmappedOwner: number; ambiguousOwner: number; noEvent: number; ownerConflict: number; ambiguousEvent: number }
  requests: KindStats; dedications: KindStats; polls: KindStats
  votes: { read: number; invalid: number; orphan: number; fromCallable: number; voteDocsToCreate: number; voteDocsExisting: number; voteDocConflicts: number; alreadyInFirestore: number; legacyShardVotes: number
           shardsWouldWrite: number; shardsNoop: number; shardsDrift: number }
  counters: { wouldSet: number; wouldIncrease: number; noop: number }
  blockers: string[]; samples: Array<Record<string, unknown>>
  applied?: { written: number; skipped: number }
  rollbackEntries?: EventRollbackEntry[]
}

const STATUS = { requests: ['pending', 'approved', 'rejected'], dedications: ['pending', 'approved', 'rejected'] } as const
const emptyKind = (): KindStats => ({ read: 0, selected: 0, invalid: 0, duplicate: 0, wouldCreate: 0, wouldUpdate: 0, wouldNoop: 0, stale: 0, unversioned: 0, drift: 0 })
const versionOf = (r: { updated_at?: string | null; created_at?: string | null }) => parseSourceTimestamp(r.updated_at ?? r.created_at)
const bucket = { create: 'wouldCreate', update: 'wouldUpdate', noop: 'wouldNoop', stale: 'stale', unversioned: 'unversioned', drift: 'drift', repair_slug: 'wouldNoop' } as const

/** Snapshot statistics: pure, no identifiers. */
export function inventoryHistory(s: HistorySnapshot) {
  const dup = (rows: Array<{ id: string }>) => rows.length - new Set(rows.map((r) => r.id)).size
  const bySession = new Map<string, number>()
  for (const r of [...s.requests, ...s.dedications, ...s.polls]) bySession.set(r.session_id, (bySession.get(r.session_id) ?? 0) + 1)
  const pollIds = new Set(s.polls.map((p) => p.id))
  return {
    sessions: s.sessions.length, distinctOwners: new Set(s.sessions.map((x) => x.dj_id)).size,
    requests: { total: s.requests.length, duplicateIds: dup(s.requests), byStatus: tally(s.requests.map((r) => r.status ?? '∅')) },
    dedications: { total: s.dedications.length, duplicateIds: dup(s.dedications), byStatus: tally(s.dedications.map((r) => r.status ?? '∅')) },
    polls: { total: s.polls.length, duplicateIds: dup(s.polls), open: s.polls.filter((p) => p.is_active).length },
    votes: { total: s.votes.length, fromCallable: s.votes.filter((v) => v.voter?.startsWith('fb:')).length, orphan: s.votes.filter((v) => !pollIds.has(v.poll_id)).length },
    sessionsWithChildren: bySession.size,
  }
}
function tally(values: string[]) { const o: Record<string, number> = {}; for (const v of values) o[v] = (o[v] ?? 0) + 1; return o }

export async function runHistoryBackfill(
  input: HistorySnapshot, opts: HistoryOptions,
  deps: { db: Firestore; onBeforeApply?: (preImage: Array<{ path: string; kind: string; before: unknown }>) => Promise<void> },
): Promise<HistoryReport> {
  const guard = (bag: string[]) => {
    if (!opts.projectId) bag.push('project id not explicit')
    if (!(opts.projectId.startsWith('demo-') || opts.yesProduction === true)) bag.push('non-emulator project requires --yes-production')
  }
  if (opts.apply) { const early: string[] = []; guard(early); if (early.length) throw new BackfillRefused(early) }

  const { db } = deps
  const r: HistoryReport = {
    mode: opts.apply ? 'apply' : 'dry-run', project: opts.projectId,
    sessions: { read: input.sessions.length, selected: 0, mapped: 0, unmappedOwner: 0, ambiguousOwner: 0, noEvent: 0, ownerConflict: 0, ambiguousEvent: 0 },
    requests: emptyKind(), dedications: emptyKind(), polls: emptyKind(),
    votes: { read: input.votes.length, invalid: 0, orphan: 0, fromCallable: 0, voteDocsToCreate: 0, voteDocsExisting: 0, voteDocConflicts: 0, alreadyInFirestore: 0, legacyShardVotes: 0, shardsWouldWrite: 0, shardsNoop: 0, shardsDrift: 0 },
    counters: { wouldSet: 0, wouldIncrease: 0, noop: 0 }, blockers: [], samples: [],
  }
  for (const k of ['requests', 'dedications', 'polls'] as const) r[k].read = input[k].length

  // ── session selection + duplicate detection (on the FULL input, so filters cannot hide a collision) ──
  let sessions = input.sessions
  if (opts.legacyUserId) sessions = sessions.filter((s) => s.dj_id === opts.legacyUserId)
  if (opts.limit !== undefined) sessions = sessions.slice(0, opts.limit)
  r.sessions.selected = sessions.length
  const sessionIds = new Set(input.sessions.map((s) => s.id))
  const dupIds = new Set<string>()
  for (const k of ['requests', 'dedications', 'polls'] as const) {
    const seen = new Set<string>()
    for (const row of input[k]) { if (seen.has(row.id)) dupIds.add(`${k}:${row.id}`); seen.add(row.id) }
  }
  if (dupIds.size) r.blockers.push(`${dupIds.size} duplicate legacy id(s) in the snapshot children`)
  if (new Set(input.sessions.map((s) => s.id)).size !== input.sessions.length) r.blockers.push('duplicate session ids in the snapshot')

  const planned: Array<() => Promise<'written' | 'skipped'>> = []
  const entries: EventRollbackEntry[] = []
  const preImage: Array<{ path: string; kind: string; before: unknown }> = []
  const note = (path: string, kind: string, before: unknown) => preImage.push({ path, kind, before })

  const pollsBySession = new Map<string, HistoryPoll[]>()
  for (const p of input.polls) pollsBySession.set(p.session_id, [...(pollsBySession.get(p.session_id) ?? []), p])
  const votesByPoll = new Map<string, HistoryVote[]>()
  for (const v of input.votes) votesByPoll.set(v.poll_id, [...(votesByPoll.get(v.poll_id) ?? []), v])
  const allPollIds = new Set(input.polls.map((p) => p.id))
  r.votes.orphan = input.votes.filter((v) => !allPollIds.has(v.poll_id)).length

  const ownerCache = new Map<string, string | 'unmapped' | 'ambiguous'>()
  const ownerOf = async (djId: string) => {
    if (!ownerCache.has(djId)) {
      const q = await db.collection('users').where('legacySupabaseId', '==', djId).limit(2).get()
      ownerCache.set(djId, q.size === 0 ? 'unmapped' : q.size > 1 ? 'ambiguous' : q.docs[0].id)
    }
    return ownerCache.get(djId)!
  }

  for (const s of sessions) {
    const owner = await ownerOf(s.dj_id)
    if (owner === 'unmapped') { r.sessions.unmappedOwner++; continue }
    if (owner === 'ambiguous') { r.sessions.ambiguousOwner++; continue }
    const ev = await db.collection('events').where('legacySupabaseId', '==', s.id).limit(2).get()
    if (ev.empty) { r.sessions.noEvent++; continue }
    if (ev.size > 1) { r.sessions.ambiguousEvent++; continue }
    const eventRef = ev.docs[0].ref
    if (ev.docs[0].data().ownerUid !== owner) { r.sessions.ownerConflict++; continue }
    r.sessions.mapped++

    const existing = async (coll: string) => {
      const snap = await eventRef.collection(coll).get()
      const m = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>(); const dup = new Set<string>()
      snap.docs.forEach((d) => { const l = d.data().legacySupabaseId as string | undefined; if (l) { if (m.has(l)) dup.add(l); m.set(l, d) } })
      return { m, dup, size: snap.size }
    }

    // ── generic request / dedication handling ──
    const plainKind = async (kind: 'requests' | 'dedications', rows: Array<HistoryRequest | HistoryDedication>) => {
      const ex = await existing(kind); let created = 0
      for (const row of rows.filter((x) => x.session_id === s.id)) {
        const st = r[kind]; st.selected++
        const status = (row.status ?? 'pending') as string
        const version = versionOf(row), createdAt = parseSourceTimestamp(row.created_at)
        const msg = (row as HistoryDedication).message
        if (!row.id || !version || (kind === 'dedications' && typeof msg !== 'string') || !(STATUS[kind] as readonly string[]).includes(status)
            || (kind === 'requests' && typeof (row as HistoryRequest).track_title !== 'string')) { st.invalid++; continue }
        if (dupIds.has(`${kind}:${row.id}`) || ex.dup.has(row.id)) { st.duplicate++; continue }
        const fields = kind === 'requests'
          ? { songTitle: (row as HistoryRequest).track_title, artist: (row as HistoryRequest).artist ?? null, message: (row as HistoryRequest).message ?? null, status }
          : { senderName: (row as HistoryDedication).guest_name ?? null, message: msg, status }
        const cur = ex.m.get(row.id)
        const decision = decideEvent(cur ? { version: (cur.data().sourceUpdatedAt as Timestamp | undefined) ?? null, content: cur.data() } : null, { version, fields })
        st[bucket[decision]]++
        if (r.samples.length < 20) r.samples.push({ kind, id: maskId(row.id), status, decision })
        if (decision !== 'create' && decision !== 'update') continue
        if (decision === 'create') {
          created++
          const ref = eventRef.collection(kind).doc(), legacyId = row.id
          const doc = { ...(kind === 'requests' ? { guestUid: null } : {}), ...fields, legacySupabaseId: legacyId, createdAt: createdAt ?? version, sourceUpdatedAt: version }
          note(ref.path, 'child', null)
          planned.push(() => db.runTransaction(async (tx) => {
            const again = await tx.get(eventRef.collection(kind).where('legacySupabaseId', '==', legacyId).limit(1))
            if (!again.empty) return 'skipped' as const
            tx.create(ref, { ...doc, updatedAt: version })
            entries.push({ path: ref.path, kind: 'child', before: null, after: ser({ ...doc, updatedAt: version }) })
            return 'written' as const
          }))
        } else {
          const ref = cur!.ref, patch = { ...fields, sourceUpdatedAt: version }
          const before = Object.fromEntries([...Object.keys(patch), 'updatedAt'].map((k) => [k, cur!.data()[k] ?? null]))
          note(ref.path, 'child', ser(before))
          planned.push(() => db.runTransaction(async (tx) => {
            const c = await tx.get(ref); if (!c.exists) return 'skipped' as const
            const d2 = decideEvent({ version: (c.data()!.sourceUpdatedAt as Timestamp | undefined) ?? null, content: c.data()! }, { version, fields })
            if (d2 !== 'update') return 'skipped' as const
            tx.update(ref, { ...patch, updatedAt: version })
            entries.push({ path: ref.path, kind: 'child', before: ser(Object.fromEntries([...Object.keys(patch), 'updatedAt'].map((k) => [k, c.data()![k] ?? null]))), after: ser({ ...patch, updatedAt: version }) })
            return 'written' as const
          }))
        }
      }
      return { ex, created }
    }

    const reqRes = await plainKind('requests', input.requests)
    await plainKind('dedications', input.dedications)

    // counter: only when requests were created or no counter exists
    {
      const counterRef = eventRef.collection('state').doc('requests'), counter = await counterRef.get()
      const total = reqRes.ex.size + reqRes.created
      if (reqRes.created > 0 || (!counter.exists && total > 0)) {
        if (!counter.exists) { r.counters.wouldSet++; note(counterRef.path, 'counter', null) }
        else { r.counters.wouldIncrease++; note(counterRef.path, 'counter', ser({ total: counter.data()!.total })) }
        planned.push(() => db.runTransaction(async (tx) => {
          const cur = await tx.get(counterRef)
          const made = entries.filter((e) => e.kind === 'child' && e.before === null && e.path.startsWith(`${eventRef.path}/requests/`)).length
          if (cur.exists && made === 0) return 'skipped' as const
          const next = cur.exists ? (cur.data()!.total as number) + made : total
          if (cur.exists && next === cur.data()!.total) return 'skipped' as const
          tx.set(counterRef, { total: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
          entries.push({ path: counterRef.path, kind: 'counter', before: cur.exists ? ser({ total: cur.data()!.total }) : null, after: ser({ total: next }) })
          return 'written' as const
        }))
      } else r.counters.noop++
    }

    // ── polls (+ legacy tally shard + callable voters' vote docs) ──
    const pex = await existing('polls')
    for (const p of pollsBySession.get(s.id) ?? []) {
      r.polls.selected++
      const version = versionOf(p), createdAt = parseSourceTimestamp(p.created_at)
      const options = Array.isArray(p.options) ? p.options.map(String) : null
      if (!p.id || !version || !options || options.length < 2 || typeof p.question !== 'string' || typeof p.is_active !== 'boolean') { r.polls.invalid++; continue }
      if (dupIds.has(`polls:${p.id}`) || pex.dup.has(p.id)) { r.polls.duplicate++; continue }
      const fields = { question: p.question, options, status: p.is_active ? 'open' : 'closed' }
      const cur = pex.m.get(p.id)
      const decision = decideEvent(cur ? { version: (cur.data().sourceUpdatedAt as Timestamp | undefined) ?? null, content: cur.data() } : null, { version, fields })
      r.polls[bucket[decision]]++
      if (r.samples.length < 20) r.samples.push({ kind: 'polls', id: maskId(p.id), status: fields.status, decision })

      let pollRef: DocumentReference
      if (decision === 'create') {
        pollRef = eventRef.collection('polls').doc()
        const ref = pollRef, doc = { ...fields, legacySupabaseId: p.id, createdAt: createdAt ?? version, sourceUpdatedAt: version }
        note(ref.path, 'child', null)
        planned.push(() => db.runTransaction(async (tx) => {
          const again = await tx.get(eventRef.collection('polls').where('legacySupabaseId', '==', p.id).limit(1))
          if (!again.empty) return 'skipped' as const
          tx.create(ref, { ...doc, updatedAt: version })
          entries.push({ path: ref.path, kind: 'child', before: null, after: ser({ ...doc, updatedAt: version }) })
          return 'written' as const
        }))
      } else {
        pollRef = cur!.ref
        if (decision === 'update') {
          const ref = pollRef, patch = { ...fields, sourceUpdatedAt: version }
          note(ref.path, 'child', ser(Object.fromEntries([...Object.keys(patch), 'updatedAt'].map((k) => [k, cur!.data()[k] ?? null]))))
          planned.push(() => db.runTransaction(async (tx) => {
            const c = await tx.get(ref); if (!c.exists) return 'skipped' as const
            const d2 = decideEvent({ version: (c.data()!.sourceUpdatedAt as Timestamp | undefined) ?? null, content: c.data()! }, { version, fields })
            if (d2 !== 'update') return 'skipped' as const
            tx.update(ref, { ...patch, updatedAt: version })
            entries.push({ path: ref.path, kind: 'child', before: ser(Object.fromEntries([...Object.keys(patch), 'updatedAt'].map((k) => [k, c.data()![k] ?? null]))), after: ser({ ...patch, updatedAt: version }) })
            return 'written' as const
          }))
        }
      }

      // votes of this poll
      const counts = options.map(() => 0)
      const voteDocsToCreate: Array<{ uid: string; option: number; at: Timestamp }> = []
      for (const v of votesByPoll.get(p.id) ?? []) {
        if (!Number.isInteger(v.option_index) || v.option_index < 0 || v.option_index >= options.length) { r.votes.invalid++; continue }
        const voterUid = v.voter?.startsWith('fb:') ? v.voter.slice(3) : null
        if (voterUid) {
          r.votes.fromCallable++
          const vd = cur ? await cur.ref.collection('votes').doc(voterUid).get() : null
          if (vd?.exists && vd.data()!.importedOption !== undefined) {
            // restored by an earlier run: it is counted in the `legacy` shard (by its ORIGINAL option), so count it again to keep the target stable
            r.votes.voteDocsExisting++; counts[v.option_index]++; r.votes.legacyShardVotes++; continue
          }
          if (vd?.exists) {
            r.votes.voteDocsExisting++; r.votes.alreadyInFirestore++
            if (vd.data()!.optionIndex !== v.option_index) r.votes.voteDocConflicts++        // Firestore wins; legacy vote is not counted
            continue
          }
          voteDocsToCreate.push({ uid: voterUid, option: v.option_index, at: parseSourceTimestamp(v.created_at) ?? version })
        }
        counts[v.option_index]++; r.votes.legacyShardVotes++
      }
      const shardRef = pollRef.collection('tally').doc('legacy')
      const shardNow = cur ? await shardRef.get() : null
      const target = Object.fromEntries(counts.map((n, i) => [`o${i}`, n]))
      if (counts.every((n) => n === 0) && !shardNow?.exists) { /* nothing to record */ }
      else if (shardNow?.exists) {
        const same = JSON.stringify(shardNow.data()!.counts ?? {}) === JSON.stringify(target) || options.every((_, i) => Number((shardNow.data()!.counts ?? {})[`o${i}`] ?? 0) === counts[i])
        if (same) r.votes.shardsNoop++; else r.votes.shardsDrift++                      // an existing, different shard is never overwritten
      } else {
        r.votes.shardsWouldWrite++
        note(shardRef.path, 'tally', null)
        planned.push(() => db.runTransaction(async (tx) => {
          const [pollNow, sh] = await Promise.all([tx.get(pollRef), tx.get(shardRef)])
          if (!pollNow.exists || sh.exists) return 'skipped' as const
          tx.create(shardRef, { counts: target, updatedAt: FieldValue.serverTimestamp() })
          entries.push({ path: shardRef.path, kind: 'tally', before: null, after: ser({ counts: target }) })
          return 'written' as const
        }))
      }
      for (const vd of voteDocsToCreate) {
        r.votes.voteDocsToCreate++
        const vref = pollRef.collection('votes').doc(vd.uid)
        note(vref.path, 'vote', null)
        planned.push(() => db.runTransaction(async (tx) => {
          const [pollNow, v0] = await Promise.all([tx.get(pollRef), tx.get(vref)])
          if (!pollNow.exists || v0.exists) return 'skipped' as const
          tx.create(vref, { optionIndex: vd.option, importedOption: vd.option, createdAt: vd.at, updatedAt: vd.at })
          entries.push({ path: vref.path, kind: 'vote', before: null, after: ser({ optionIndex: vd.option, importedOption: vd.option, createdAt: vd.at, updatedAt: vd.at }) })
          return 'written' as const
        }))
      }
    }
  }

  // orphans: children of sessions that are not in the snapshot at all
  void sessionIds
  const s = r.sessions
  if (s.ambiguousOwner) r.blockers.push(`${s.ambiguousOwner} session(s) with an ambiguous owner mapping`)
  if (s.ownerConflict) r.blockers.push(`${s.ownerConflict} event(s) belong to a different owner than the snapshot says`)
  if (s.ambiguousEvent) r.blockers.push(`${s.ambiguousEvent} legacy session id(s) match more than one event`)
  if (r.votes.voteDocConflicts) r.blockers.push(`${r.votes.voteDocConflicts} vote(s) differ between Firestore and Supabase (Firestore kept) — review before apply`)
  for (const k of ['requests', 'dedications', 'polls'] as const) if (r[k].duplicate) r.blockers.push(`${r[k].duplicate} ${k} with a duplicate legacy id (skipped)`)

  if (opts.apply) {
    const reasons = [...r.blockers]; guard(reasons)
    if (reasons.length) throw new BackfillRefused(reasons)
    await deps.onBeforeApply?.(preImage)
    let written = 0, skipped = 0
    for (const w of planned) { (await w()) === 'written' ? written++ : skipped++ }     // sequential: poll before its votes, requests before the counter
    r.applied = { written, skipped }; r.rollbackEntries = entries
  }
  return r
}

export type { DocumentData }
