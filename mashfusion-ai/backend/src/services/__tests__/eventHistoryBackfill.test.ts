/** Emulator-only (npm run test:firebase): historical children backfill — mapping, fidelity, idempotency, stale protection, votes/tally, rollback. */
export {}
const emu = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const d = emu ? describe : describe.skip
const svc: typeof import('../eventHistoryBackfill') = emu ? require('../eventHistoryBackfill') : (undefined as never)
const evSvc: typeof import('../eventBackfill') = emu ? require('../eventBackfill') : (undefined as never)
const { firestore } = emu ? require('../../lib/firebaseAdmin') : ({} as any)
const { Timestamp, FieldValue } = emu ? require('firebase-admin/firestore') : ({} as any)

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const v = (n: number) => `2026-02-01T10:00:00.${String(100000 + n).padStart(6, '0')}+00:00`
const OPTS = { apply: false, projectId: 'demo-iomixo' }
const APPLY = { apply: true, projectId: 'demo-iomixo' }

/** An owner (users/{uid}.legacySupabaseId) with a migrated event (events.legacySupabaseId). */
async function migrated(slugSuffix = uid()) {
  const dj = 'dj-' + uid(), fb = `fb-${uid()}`, sid = 'sess-' + uid()
  await firestore().doc(`users/${fb}`).set({ uid: fb, legacySupabaseId: dj, createdAt: new Date(), updatedAt: new Date() })
  const ref = firestore().collection('events').doc()
  await ref.set({ ownerUid: fb, legacySupabaseId: sid, slug: 's' + slugSuffix, title: 'T', type: 'party', status: 'live', createdAt: new Date(), updatedAt: new Date() })
  return { dj, fb, sid, ref, session: { id: sid, dj_id: dj, public_slug: 's' + slugSuffix } }
}
const rq = (session_id: string, over: Record<string, unknown> = {}) => ({ id: 'rq-' + uid(), session_id, track_title: 'Song', artist: 'Art', message: null, status: 'pending', created_at: v(0), updated_at: v(1), ...over })
const dd = (session_id: string, over: Record<string, unknown> = {}) => ({ id: 'dd-' + uid(), session_id, guest_name: 'Zia', message: 'Auguri', status: 'approved', created_at: v(0), updated_at: v(2), ...over })
const pl = (session_id: string, over: Record<string, unknown> = {}) => ({ id: 'pl-' + uid(), session_id, question: 'Q?', options: ['A', 'B', 'C'], is_active: true, created_at: v(0), updated_at: v(3), ...over })
const vt = (poll_id: string, option_index: number, voter: string | null = null) => ({ poll_id, option_index, voter, created_at: v(4) })
const snap = (m: { session: any }[], p: Partial<import('../eventHistoryBackfill').HistorySnapshot> = {}) => ({ sessions: m.map((x) => x.session), requests: [], dedications: [], polls: [], votes: [], ...p }) as import('../eventHistoryBackfill').HistorySnapshot
const run = (s: any, o: any = OPTS) => svc.runHistoryBackfill(s, o, { db: firestore() })
const docs = async (ref: any, c: string) => (await ref.collection(c).get()).docs
const sum = async (pollRef: any, n: number) => {
  const out = new Array(n).fill(0)
  for (const s of (await pollRef.collection('tally').get()).docs) for (let i = 0; i < n; i++) out[i] += Number(s.data().counts?.[`o${i}`] ?? 0)
  return out
}

d('event history backfill (Firestore emulator)', () => {
  jest.setTimeout(240_000)

  it('dry-run is the default and never writes', async () => {
    const m = await migrated(); const s = snap([m], { requests: [rq(m.sid)], dedications: [dd(m.sid)], polls: [pl(m.sid)] })
    const r = await run(s)
    expect(r.mode).toBe('dry-run'); expect(r.requests.wouldCreate).toBe(1); expect(r.dedications.wouldCreate).toBe(1); expect(r.polls.wouldCreate).toBe(1); expect(r.applied).toBeUndefined()
    expect(await docs(m.ref, 'requests')).toHaveLength(0); expect(await docs(m.ref, 'polls')).toHaveLength(0); expect((await m.ref.collection('state').doc('requests').get()).exists).toBe(false)
  })

  it('apply preserves status, timestamps, content, poll open/closed, votes and counts; a rerun changes nothing', async () => {
    const m = await migrated()
    const r1 = rq(m.sid, { status: 'approved' }), r2 = rq(m.sid, { status: 'rejected', created_at: v(7), updated_at: v(8) }), r3 = rq(m.sid)
    const d1 = dd(m.sid), d2 = dd(m.sid, { status: 'pending', guest_name: null })
    const open = pl(m.sid), closed = pl(m.sid, { is_active: false, options: ['X', 'Y'] })
    const guestA = 'guestA' + uid(), guestB = 'guestB' + uid()
    const votes = [vt(open.id, 0), vt(open.id, 0), vt(open.id, 2), vt(open.id, 1, `fb:${guestA}`), vt(open.id, 1, `fb:${guestB}`), vt(closed.id, 1)]
    const s = snap([m], { requests: [r1, r2, r3], dedications: [d1, d2], polls: [open, closed], votes })
    const out = await run(s, APPLY)
    expect(out.applied!.skipped).toBe(0)

    const reqs = new Map<string, any>((await docs(m.ref, 'requests')).map((x: any) => [x.data().legacySupabaseId, x.data()]))
    expect(reqs.size).toBe(3)
    expect(reqs.get(r1.id)).toMatchObject({ songTitle: 'Song', artist: 'Art', status: 'approved', guestUid: null })
    expect(reqs.get(r2.id)!.status).toBe('rejected'); expect(reqs.get(r2.id)!.createdAt.toDate().toISOString()).toBe('2026-02-01T10:00:00.100Z')
    expect(reqs.get(r1.id)).not.toHaveProperty('ip_hash')
    expect((await m.ref.collection('state').doc('requests').get()).data()!.total).toBe(3)
    const deds = new Map<string, any>((await docs(m.ref, 'dedications')).map((x: any) => [x.data().legacySupabaseId, x.data()]))
    expect(deds.get(d1.id)).toMatchObject({ senderName: 'Zia', message: 'Auguri', status: 'approved' }); expect(deds.get(d2.id)).toMatchObject({ senderName: null, status: 'pending' })

    const polls = new Map<string, any>((await docs(m.ref, 'polls')).map((x: any) => [x.data().legacySupabaseId, x]))
    expect(polls.get(open.id).data()).toMatchObject({ status: 'open', options: ['A', 'B', 'C'], question: 'Q?' }); expect(polls.get(closed.id).data().status).toBe('closed')
    expect(await sum(polls.get(open.id).ref, 3)).toEqual([2, 2, 1]); expect(await sum(polls.get(closed.id).ref, 2)).toEqual([0, 1])
    const vd = await polls.get(open.id).ref.collection('votes').get()
    expect(vd.docs.map((x: any) => [x.id, x.data().optionIndex]).sort()).toEqual([[guestA, 1], [guestB, 1]].sort())

    const again = await run(s, APPLY)
    expect(again.requests).toMatchObject({ wouldCreate: 0, wouldUpdate: 0, wouldNoop: 3 }); expect(again.dedications.wouldNoop).toBe(2); expect(again.polls.wouldNoop).toBe(2)
    expect(again.applied).toEqual({ written: 0, skipped: 0 }); expect(again.votes.shardsNoop).toBe(2); expect(again.votes.voteDocsToCreate).toBe(0)
    expect((await docs(m.ref, 'requests')).length).toBe(3); expect((await m.ref.collection('state').doc('requests').get()).data()!.total).toBe(3)
  })

  it('a voter restored by the backfill can change their vote through the callable logic: the SUM of shards stays right', async () => {
    const m = await migrated(); const guest = 'g' + uid(); const p = pl(m.sid)
    await run(snap([m], { polls: [p], votes: [vt(p.id, 0), vt(p.id, 1, `fb:${guest}`)] }), APPLY)
    const pr = (await docs(m.ref, 'polls'))[0].ref
    expect(await sum(pr, 3)).toEqual([1, 1, 0])
    // what votePoll does for a CHANGED vote: vote doc update + shard s{k} -1 old / +1 new
    await pr.collection('votes').doc(guest).update({ optionIndex: 2 })
    await pr.collection('tally').doc('s0').set({ counts: { o1: FieldValue.increment(-1), o2: FieldValue.increment(1) } }, { merge: true })
    expect(await sum(pr, 3)).toEqual([1, 0, 1])
  })

  it('unmapped owner / session without event are skipped; owner conflict and ambiguous owner block --apply', async () => {
    const ok = await migrated()
    const noOwner = { id: 'sess-x' + uid(), dj_id: 'dj-nobody-' + uid() }
    const noEvent = await migrated(); await noEvent.ref.delete()
    const other = await migrated(); const stolen = { id: other.sid, dj_id: ok.dj }                  // event exists but belongs to another owner
    const base = { requests: [rq(ok.sid), rq(noOwner.id), rq(noEvent.sid)] }
    const r = await run({ ...snap([ok], base), sessions: [ok.session, noOwner, noEvent.session] })
    expect(r.sessions).toMatchObject({ mapped: 1, unmappedOwner: 1, noEvent: 1 }); expect(r.requests.wouldCreate).toBe(1); expect(r.blockers).toEqual([])
    await run({ ...snap([ok], base), sessions: [ok.session, noOwner, noEvent.session] }, APPLY)       // allowed: skips are not blockers
    expect(await docs(ok.ref, 'requests')).toHaveLength(1)
    const c = await run({ ...snap([ok], { requests: [rq(other.sid)] }), sessions: [stolen] })
    expect(c.sessions.ownerConflict).toBe(1); expect(c.blockers.join()).toMatch(/different owner/)
    await expect(run({ ...snap([ok], { requests: [rq(other.sid)] }), sessions: [stolen] }, APPLY)).rejects.toThrow(/different owner/)
    expect(await docs(other.ref, 'requests')).toHaveLength(0)
    const dj2 = 'dj-' + uid(); await firestore().doc(`users/a-${uid()}`).set({ legacySupabaseId: dj2 }); await firestore().doc(`users/b-${uid()}`).set({ legacySupabaseId: dj2 })
    expect((await run({ ...snap([ok]), sessions: [{ id: 'z', dj_id: dj2 }] })).sessions.ambiguousOwner).toBe(1)
  })

  it('no email fallback: an account that only shares the email is never an owner', async () => {
    const m = await migrated(); await firestore().doc(`users/${m.fb}`).update({ legacySupabaseId: FieldValue.delete(), email: 'x@example.com' })
    const r = await run(snap([m], { requests: [rq(m.sid)] }))
    expect(r.sessions.unmappedOwner).toBe(1); expect(r.requests.wouldCreate).toBe(0)
  })

  it('stale / unversioned protection: newer or Function-created docs are never overwritten; a newer snapshot updates only the status', async () => {
    const m = await migrated(); const a = rq(m.sid), b = rq(m.sid)
    await run(snap([m], { requests: [a] }), APPLY)
    const [da] = await docs(m.ref, 'requests')
    await da.ref.update({ status: 'approved', sourceUpdatedAt: Timestamp.fromDate(new Date('2026-03-01T00:00:00Z')), updatedAt: new Date() })   // moderated later on Firestore
    expect((await run(snap([m], { requests: [{ ...a, status: 'rejected', updated_at: v(5) }] }), APPLY)).requests.stale).toBe(1)
    expect((await da.ref.get()).data().status).toBe('approved')
    // created by the createMusicRequest Function: legacy id but no sourceUpdatedAt
    await m.ref.collection('requests').doc('fn1').set({ guestUid: 'anon1', songTitle: 'Fn', artist: null, message: null, status: 'pending', legacySupabaseId: b.id, createdAt: new Date(), updatedAt: new Date() })
    const r = await run(snap([m], { requests: [{ ...b, status: 'approved' }] }), APPLY)
    expect(r.requests.unversioned).toBe(1); const fn = (await m.ref.collection('requests').doc('fn1').get()).data()
    expect(fn).toMatchObject({ status: 'pending', guestUid: 'anon1', songTitle: 'Fn' })
    // a genuinely newer snapshot (Supabase moderated after our first import) updates
    const c = rq(m.sid); await run(snap([m], { requests: [c] }), APPLY)
    const up = await run(snap([m], { requests: [{ ...c, status: 'approved', updated_at: v(9) }] }), APPLY)
    expect(up.requests.wouldUpdate).toBe(1); expect(up.applied!.written).toBe(1)
    const cd = (await docs(m.ref, 'requests')).find((x: any) => x.data().legacySupabaseId === c.id)
    expect(cd.data()).toMatchObject({ status: 'approved', songTitle: 'Song' })
  })

  it('votes already in Firestore are not counted twice; a conflicting vote is reported (Firestore wins) and blocks --apply', async () => {
    const m = await migrated(); const guest = 'g' + uid(), other = 'g' + uid(); const p = pl(m.sid)
    await run(snap([m], { polls: [p] }), APPLY)
    const pr = (await docs(m.ref, 'polls'))[0].ref
    await pr.collection('votes').doc(guest).set({ optionIndex: 1, createdAt: new Date(), updatedAt: new Date() }); await pr.collection('tally').doc('s1').set({ counts: { o1: 1 } })
    const s = snap([m], { polls: [p], votes: [vt(p.id, 1, `fb:${guest}`), vt(p.id, 2), vt(p.id, 0, `fb:${other}`)] })
    const r = await run(s)
    expect(r.votes).toMatchObject({ alreadyInFirestore: 1, voteDocsToCreate: 1, legacyShardVotes: 2, voteDocConflicts: 0 })
    await run(s, APPLY)
    expect(await sum(pr, 3)).toEqual([1, 1, 1])                                                  // s1 (1 vote) + legacy shard (other→o0, anon→o2)
    const conflict = snap([m], { polls: [p], votes: [vt(p.id, 2, `fb:${guest}`)] })
    const c = await run(conflict); expect(c.votes.voteDocConflicts).toBe(1)
    await expect(run(conflict, APPLY)).rejects.toThrow(/differ between Firestore and Supabase/)
  })

  it('an existing, different legacy shard is never overwritten (drift is reported)', async () => {
    const m = await migrated(); const p = pl(m.sid); const s = snap([m], { polls: [p], votes: [vt(p.id, 0)] })
    await run(s, APPLY); const pr = (await docs(m.ref, 'polls'))[0].ref
    await pr.collection('tally').doc('legacy').set({ counts: { o0: 9, o1: 0, o2: 0 } })
    const r = await run(s); expect(r.votes.shardsDrift).toBe(1); await run(s, APPLY)
    expect((await pr.collection('tally').doc('legacy').get()).data().counts.o0).toBe(9)
  })

  it('duplicate legacy ids and invalid rows are excluded and reported; guards require --yes-production before any Firestore access', async () => {
    const m = await migrated(); const a = rq(m.sid)
    const r = await run(snap([m], { requests: [a, { ...a }, rq(m.sid, { status: 'banana' }), rq(m.sid, { created_at: 'garbage', updated_at: null }), rq(m.sid)] }))
    expect(r.requests).toMatchObject({ duplicate: 2, invalid: 2, wouldCreate: 1 }); expect(r.blockers.join()).toMatch(/duplicate/)
    await expect(run(snap([m], { requests: [a, { ...a }] }), APPLY)).rejects.toThrow(/duplicate/)
    const throwing = { collection() { throw new Error('touched firestore') } } as any
    await expect(svc.runHistoryBackfill(snap([]), { apply: true, projectId: 'iomixo-494817' }, { db: throwing })).rejects.toThrow(/yes-production/)
  })

  it('--legacy-user-id and --limit select sessions', async () => {
    const a = await migrated(), b = await migrated(); const s = snap([a, b], { requests: [rq(a.sid), rq(b.sid)] })
    expect((await run(s, { ...OPTS, legacyUserId: a.dj })).requests).toMatchObject({ selected: 1, wouldCreate: 1 })
    expect((await run(s, { ...OPTS, limit: 1 })).sessions.selected).toBe(1)
  })

  it('rollback: removes only what the run created (dry-run first), keeps changed docs and polls with other children, restores the counter', async () => {
    const m = await migrated(); const r1 = rq(m.sid), r2 = rq(m.sid), p1 = pl(m.sid), p2 = pl(m.sid)
    await m.ref.collection('state').doc('requests').set({ total: 5 })                       // a pre-existing counter
    const out = await run(snap([m], { requests: [r1, r2], polls: [p1, p2], votes: [vt(p1.id, 0), vt(p2.id, 1)] }), APPLY)
    expect((await m.ref.collection('state').doc('requests').get()).data().total).toBe(7)
    const reqDocs = await docs(m.ref, 'requests'); const changed = reqDocs.find((x: any) => x.data().legacySupabaseId === r1.id)
    await changed.ref.update({ status: 'approved' })                                          // moderated after the import → keep
    const pollDocs = await docs(m.ref, 'polls'); const kept = pollDocs.find((x: any) => x.data().legacySupabaseId === p2.id)
    await kept.ref.collection('votes').doc('late-guest').set({ optionIndex: 0 })              // a vote cast after the import → keep the poll
    const dry = await evSvc.runEventRollback(firestore(), { entries: out.rollbackEntries! }, { apply: false, projectId: 'demo-iomixo' })
    expect(dry.skippedChanged).toBeGreaterThan(0); expect(await docs(m.ref, 'requests')).toHaveLength(2)
    await expect(evSvc.runEventRollback(firestore(), { entries: out.rollbackEntries! }, { apply: true, projectId: 'iomixo-494817' })).rejects.toThrow(/yes-production/)
    await evSvc.runEventRollback(firestore(), { entries: out.rollbackEntries! }, { apply: true, projectId: 'demo-iomixo' })
    const left = await docs(m.ref, 'requests'); expect(left.map((x: any) => x.data().legacySupabaseId)).toEqual([r1.id])
    expect(left[0].data().status).toBe('approved')
    const polls = await docs(m.ref, 'polls'); expect(polls.map((x: any) => x.data().legacySupabaseId)).toEqual([p2.id])
    expect((await kept.ref.collection('votes').doc('late-guest').get()).exists).toBe(true)
  })

  it('6 events × (60 requests, 20 dedications, 3 polls, 120 votes): applies, rerun is zero changes, counters coherent', async () => {
    const ms = await Promise.all(Array.from({ length: 6 }, () => migrated()))
    const s = snap(ms)
    for (const m of ms) {
      for (let i = 0; i < 60; i++) s.requests.push(rq(m.sid, { status: ['pending', 'approved', 'rejected'][i % 3] }) as any)
      for (let i = 0; i < 20; i++) s.dedications.push(dd(m.sid, { status: ['pending', 'approved'][i % 2] }) as any)
      for (let i = 0; i < 3; i++) { const p = pl(m.sid, { is_active: i === 0 }); s.polls.push(p as any); for (let k = 0; k < 40; k++) s.votes.push(vt(p.id, k % 3) as any) }
    }
    const r = await run(s, APPLY)
    expect(r.requests.wouldCreate).toBe(360); expect(r.dedications.wouldCreate).toBe(120); expect(r.polls.wouldCreate).toBe(18); expect(r.applied!.skipped).toBe(0)
    for (const m of ms) {
      expect((await m.ref.collection('state').doc('requests').get()).data().total).toBe(60)
      const open = (await docs(m.ref, 'polls')).filter((x: any) => x.data().status === 'open'); expect(open).toHaveLength(1)
      expect(await sum(open[0].ref, 3)).toEqual([14, 13, 13])
    }
    const again = await run(s, APPLY)
    expect(again.applied).toEqual({ written: 0, skipped: 0 }); expect(again.requests.wouldNoop).toBe(360)
  })
})

describe('event history backfill (pure)', () => {
  it('inventoryHistory counts statuses, duplicate ids, callable voters and orphan votes', () => {
    const { inventoryHistory } = jest.requireActual('../eventHistoryBackfill') as typeof import('../eventHistoryBackfill')
    const inv = inventoryHistory({
      sessions: [{ id: 's', dj_id: 'u' }], requests: [rq('s'), { ...rq('s'), status: 'approved' }] as any, dedications: [], polls: [pl('s', { id: 'p' })] as any,
      votes: [vt('p', 0, 'fb:x'), vt('p', 1), vt('ghost', 0)] as any,
    })
    expect(inv).toMatchObject({ sessions: 1, requests: { total: 2 }, polls: { total: 1, open: 1 }, votes: { total: 3, fromCallable: 1, orphan: 1 } })
  })
})
