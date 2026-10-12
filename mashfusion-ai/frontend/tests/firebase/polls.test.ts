import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { deleteApp } from 'firebase/app'
import { newClient, closeClient, denied, newSignedOutDb, type TestClient } from './helpers'
import { seedSet, seedUpdate, eventFields } from './seed'
import { startFakeSupabase, type FakeSupabase } from './fakeSupabase'
import { getActivePoll, subscribeActivePoll, subscribePollTally, subscribeMyVote, subscribeEventPolls, sumTally } from '../../lib/firebase/repositories/pollRepository'
import { votePoll as votePollService, VoteError } from '../../lib/events/pollService'

let fake: FakeSupabase
const clients: TestClient[] = []
before(async () => { fake = await startFakeSupabase() })
after(async () => { await Promise.all(clients.map(closeClient)); await fake.close() })
const mk = async (k: 'account' | 'anonymous' = 'anonymous') => { const c = await newClient(k); clients.push(c); return c }

let n = 0
async function seedPoll(ownerUid: string, over: { event?: Record<string, unknown>; poll?: Record<string, unknown> } = {}) {
  const id = `pev${Date.now()}${n++}`, pollId = `poll${Date.now()}${n}`, legacy = `lp-${pollId}`
  await seedSet(`events/${id}`, eventFields(ownerUid, `s${id}`, { type: 'party', legacySupabaseId: `ps-${id}`, ...over.event }))
  await seedSet(`events/${id}/polls/${pollId}`, {
    question: 'Quale canzone?', options: ['A', 'B', 'C'], status: 'open', legacySupabaseId: legacy,
    createdAt: new Date(), updatedAt: new Date(), ...over.poll,
  })
  return { id, pollId, legacy }
}
const call = (c: TestClient, data: unknown) => {
  const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  return httpsCallable<any, { optionIndex: number; changed: boolean; alreadyVoted: boolean }>(f, 'votePoll')(data as any)
}
async function rejects(p: Promise<unknown>) { try { await p } catch (e: any) { return { code: e.code, reason: e.details?.reason } } assert.fail('expected rejection') }
const tallyOf = async (c: TestClient, e: { id: string; pollId: string }, options = 3) => {
  const snap = await getDocs(collection(c.db, 'events', e.id, 'polls', e.pollId, 'tally'))
  return sumTally(snap.docs.map((d) => d.data()), options)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('1. valid vote: vote doc keyed by the token uid, tally updated, legacy row written', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedPoll(dj.uid)
  const r = await call(g, { eventId: e.id, pollId: e.pollId, optionIndex: 1 })
  assert.deepEqual(r.data, { optionIndex: 1, changed: false, alreadyVoted: false })
  assert.equal((await getDoc(doc(g.db, 'events', e.id, 'polls', e.pollId, 'votes', g.uid))).data()?.optionIndex, 1)
  assert.deepEqual(await tallyOf(g, e), [0, 1, 0])
  assert.equal(fake.pollVotes.get(`${e.legacy}|fb:${g.uid}`), 1)
})

test('2/3/4. unauthenticated, missing event/poll, ended event, closed poll, invalid option/payload', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedPoll(dj.uid)
  const { app } = newSignedOutDb(); const f = getFunctions(app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  assert.deepEqual(await rejects(httpsCallable(f, 'votePoll')({ eventId: e.id, pollId: e.pollId, optionIndex: 0 })), { code: 'functions/unauthenticated', reason: 'unauthenticated' })
  await deleteApp(app)
  assert.deepEqual(await rejects(call(g, { eventId: 'nope', pollId: e.pollId, optionIndex: 0 })), { code: 'functions/not-found', reason: 'event_not_found' })
  assert.deepEqual(await rejects(call(g, { eventId: e.id, pollId: 'nope', optionIndex: 0 })), { code: 'functions/not-found', reason: 'poll_not_found' })
  const ended = await seedPoll(dj.uid, { event: { status: 'ended' } })
  assert.deepEqual(await rejects(call(g, { eventId: ended.id, pollId: ended.pollId, optionIndex: 0 })), { code: 'functions/failed-precondition', reason: 'event_ended' })
  const closed = await seedPoll(dj.uid, { poll: { status: 'closed' } })
  assert.deepEqual(await rejects(call(g, { eventId: closed.id, pollId: closed.pollId, optionIndex: 0 })), { code: 'functions/failed-precondition', reason: 'poll_closed' })
  assert.deepEqual(await rejects(call(g, { eventId: e.id, pollId: e.pollId, optionIndex: 3 })), { code: 'functions/invalid-argument', reason: 'invalid_option' })
  for (const bad of [{ optionIndex: 0 }, { eventId: e.id, optionIndex: 0 }, { eventId: e.id, pollId: e.pollId, optionIndex: -1 },
    { eventId: e.id, pollId: e.pollId, optionIndex: 1.5 }, { eventId: e.id, pollId: e.pollId, optionIndex: '1' }, { eventId: 'a/b', pollId: e.pollId, optionIndex: 0 }, null]) {
    assert.equal((await rejects(call(g, bad))).code, 'functions/invalid-argument', JSON.stringify(bad))
  }
  assert.deepEqual(await tallyOf(g, e), [0, 0, 0])
})

test('5. spoofed uid / guestUid in the payload is ignored (the vote is keyed by the token uid)', async () => {
  const dj = await mk('account'); const g = await mk(); const victim = await mk(); const e = await seedPoll(dj.uid)
  await call(g, { eventId: e.id, pollId: e.pollId, optionIndex: 0, uid: victim.uid, guestUid: victim.uid })
  assert.ok((await getDoc(doc(g.db, 'events', e.id, 'polls', e.pollId, 'votes', g.uid))).exists())
  assert.equal((await getDoc(doc(victim.db, 'events', e.id, 'polls', e.pollId, 'votes', victim.uid))).exists(), false)
})

test('6. one vote per guest; changing it moves the count (legacy semantics) after the change cooldown; same option is a no-op', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedPoll(dj.uid)
  await call(g, { eventId: e.id, pollId: e.pollId, optionIndex: 0 })
  const again = await call(g, { eventId: e.id, pollId: e.pollId, optionIndex: 0 })
  assert.deepEqual(again.data, { optionIndex: 0, changed: false, alreadyVoted: true })
  assert.deepEqual(await rejects(call(g, { eventId: e.id, pollId: e.pollId, optionIndex: 2 })), { code: 'functions/resource-exhausted', reason: 'cooldown' })
  await sleep(1700)
  const changed = await call(g, { eventId: e.id, pollId: e.pollId, optionIndex: 2 })
  assert.deepEqual(changed.data, { optionIndex: 2, changed: true, alreadyVoted: false })
  assert.deepEqual(await tallyOf(g, e), [0, 0, 1], 'total stays 1')
  assert.equal(fake.pollVotes.get(`${e.legacy}|fb:${g.uid}`), 2, 'legacy row follows the change (one row per guest)')
})

test('7. idempotency / concurrency on the SAME uid: double click, retries, racing choices', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedPoll(dj.uid)
  const same = await Promise.allSettled(Array.from({ length: 6 }, () => call(g, { eventId: e.id, pollId: e.pollId, optionIndex: 1 })))
  assert.ok(same.every((r) => r.status === 'fulfilled'), 'retries / double clicks succeed')
  assert.deepEqual(await tallyOf(g, e), [0, 1, 0], 'exactly one vote counted')

  const g2 = await mk(); const e2 = await seedPoll(dj.uid)
  await Promise.allSettled([call(g2, { eventId: e2.id, pollId: e2.pollId, optionIndex: 0 }), call(g2, { eventId: e2.id, pollId: e2.pollId, optionIndex: 2 })])
  const t = await tallyOf(g2, e2)
  assert.equal(t.reduce((a, b) => a + b, 0), 1, 'racing choices still count once')
  const stored = (await getDoc(doc(g2.db, 'events', e2.id, 'polls', e2.pollId, 'votes', g2.uid))).data()!.optionIndex
  assert.equal(t[stored], 1); assert.equal(fake.pollVotes.get(`${e2.legacy}|fb:${g2.uid}`), stored, 'legacy converges to Firestore')
})

test('8. many guests voting at once are all counted (sharded tally, no lost updates)', async () => {
  const dj = await mk('account'); const e = await seedPoll(dj.uid)
  const guests = await Promise.all(Array.from({ length: 24 }, () => mk()))
  const res = await Promise.allSettled(guests.map((g, i) => call(g, { eventId: e.id, pollId: e.pollId, optionIndex: i % 3 })))
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 24)
  assert.deepEqual(await tallyOf(dj, e), [8, 8, 8])
  const shards = await getDocs(collection(dj.db, 'events', e.id, 'polls', e.pollId, 'tally'))
  assert.ok(shards.size > 1 && shards.size <= 5, `spread over ${shards.size} shards`)
  assert.equal(fake.pollVotes.size >= 24, true)
})

test('9. legacy failure rolls the Firestore write back (new vote and changed vote)', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedPoll(dj.uid)
  fake.failInserts = true
  assert.deepEqual(await rejects(call(g, { eventId: e.id, pollId: e.pollId, optionIndex: 1 })), { code: 'functions/unavailable', reason: 'bridge_failed' })
  fake.failInserts = false
  assert.equal((await getDoc(doc(g.db, 'events', e.id, 'polls', e.pollId, 'votes', g.uid))).exists(), false)
  assert.deepEqual(await tallyOf(g, e), [0, 0, 0])
  await call(g, { eventId: e.id, pollId: e.pollId, optionIndex: 1 })   // retry works

  await sleep(1700); fake.failInserts = true
  assert.equal((await rejects(call(g, { eventId: e.id, pollId: e.pollId, optionIndex: 2 }))).reason, 'bridge_failed')
  fake.failInserts = false
  assert.deepEqual(await tallyOf(g, e), [0, 1, 0], 'changed vote restored')
  assert.equal((await getDoc(doc(g.db, 'events', e.id, 'polls', e.pollId, 'votes', g.uid))).data()?.optionIndex, 1)
})

test('10. rules: polls/tally readable by participants; votes private; nobody writes', async () => {
  const dj = await mk('account'); const g1 = await mk(); const g2 = await mk(); const e = await seedPoll(dj.uid)
  await call(g1, { eventId: e.id, pollId: e.pollId, optionIndex: 0 })
  const voteRef = (uid: string) => ['events', e.id, 'polls', e.pollId, 'votes', uid] as const
  assert.ok((await getDoc(doc(g1.db, ...voteRef(g1.uid)))).exists(), 'own vote')
  assert.ok(await denied(getDoc(doc(g2.db, ...voteRef(g1.uid)))), "someone else's vote")
  assert.ok(await denied(getDoc(doc(dj.db, ...voteRef(g1.uid)))), 'even the owner cannot read individual votes')
  assert.ok(await denied(getDocs(collection(dj.db, 'events', e.id, 'polls', e.pollId, 'votes'))), 'no uid lists')
  assert.ok(await denied(getDocs(collection(g1.db, 'events', e.id, 'polls', e.pollId, 'votes'))))
  assert.equal((await getActivePoll(g2.db, e.id))?.id, e.pollId)
  assert.deepEqual(await tallyOf(g2, e), [1, 0, 0])
  const { app, db } = newSignedOutDb(); assert.ok(await denied(getActivePoll(db, e.id))); await deleteApp(app)

  for (const c of [g1, dj]) {
    assert.ok(await denied(updateDoc(doc(c.db, 'events', e.id, 'polls', e.pollId), { status: 'closed' })))
    assert.ok(await denied(deleteDoc(doc(c.db, 'events', e.id, 'polls', e.pollId))))
    assert.ok(await denied(addDoc(collection(c.db, 'events', e.id, 'polls'), { question: 'x', options: ['a', 'b'], status: 'open' })))
    assert.ok(await denied(setDoc(doc(c.db, 'events', e.id, 'polls', e.pollId, 'tally', 's0'), { counts: { o0: 999 } })))
    assert.ok(await denied(setDoc(doc(c.db, ...voteRef(c.uid)), { optionIndex: 0 })))
    assert.ok(await denied(deleteDoc(doc(c.db, ...voteRef(g1.uid)))))
  }
  assert.deepEqual(await tallyOf(g2, e), [1, 0, 0])
})

test('11/12. realtime: poll close, tally and my-vote listeners update; unsubscribe stops them; sumTally handles shards', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedPoll(dj.uid)
  const polls: Array<string | null> = [], tallies: number[][] = [], mine: Array<number | null> = [], djPolls: number[] = []
  const subs = [
    subscribeActivePoll(g.db, e.id, (p) => polls.push(p?.id ?? null)),
    subscribePollTally(g.db, e.id, e.pollId, 3, (t) => tallies.push(t)),
    subscribeMyVote(g.db, e.id, e.pollId, g.uid, (v) => mine.push(v)),
    subscribeEventPolls(dj.db, e.id, (l) => djPolls.push(l.length)),
  ]
  const until = async (cond: () => boolean) => { for (let i = 0; i < 60 && !cond(); i++) await sleep(100); assert.ok(cond(), `timeout polls=${polls} tallies=${JSON.stringify(tallies)} mine=${mine}`) }
  await until(() => polls.length > 0 && tallies.length > 0 && mine.length > 0 && djPolls.length > 0)
  assert.equal(mine.at(-1), null)

  await call(g, { eventId: e.id, pollId: e.pollId, optionIndex: 2 })
  await until(() => tallies.at(-1)?.[2] === 1 && mine.at(-1) === 2)

  await seedUpdate(`events/${e.id}/polls/${e.pollId}`, { status: 'closed' })
  await until(() => polls.at(-1) === null)

  subs.forEach((u) => u())
  const sizes = [polls.length, tallies.length, mine.length, djPolls.length]
  await seedUpdate(`events/${e.id}/polls/${e.pollId}`, { status: 'open' })
  await seedSet(`events/${e.id}/polls/${e.pollId}/tally/legacy`, { counts: { o0: 5 } })
  await sleep(800)
  assert.deepEqual([polls.length, tallies.length, mine.length, djPolls.length], sizes, 'no events after unsubscribe')

  assert.deepEqual(sumTally([{ counts: { o0: 2, o1: -1 } }, { counts: { o1: 3 } }, undefined, { counts: { o0: 4 } }], 3), [6, 2, 0])
  assert.deepEqual(sumTally([{ counts: { o2: -2 } }], 3), [0, 0, 0], 'never negative')
})

test('13. client service: reasons map to legacy wording; fallback only for not-ready / infrastructure', async () => {
  const dj = await mk('account')
  const noLegacy = await seedPoll(dj.uid, { poll: { legacySupabaseId: undefined } })
  // A poll without legacySupabaseId is Firestore-native (createPoll callable): there is no Supabase row to mirror, so the vote succeeds without the bridge.
  assert.equal((await votePollService({ eventId: noLegacy.id, pollId: noLegacy.pollId, optionIndex: 2 })).optionIndex, 2)
  const closed = await seedPoll(dj.uid, { poll: { status: 'closed' } })
  await assert.rejects(votePollService({ eventId: closed.id, pollId: closed.pollId, optionIndex: 0 }), (e: any) => !e.fallbackToLegacy && /chiuso/.test(e.message))
  const ok = await seedPoll(dj.uid)
  assert.equal((await votePollService({ eventId: ok.id, pollId: ok.pollId, optionIndex: 1 })).optionIndex, 1)
})

test('14. policy switch: with allowChange=false a different second vote is rejected (already_voted), same option stays idempotent', async () => {
  const { votePoll, VOTE_POLICY } = await import('../../../../firebase/functions/lib/polls/votePoll.js')
  const { initializeApp, getApps } = await import('../../../../firebase/functions/node_modules/firebase-admin/lib/app/index.js') as any
  const { getFirestore } = await import('../../../../firebase/functions/node_modules/firebase-admin/lib/firestore/index.js') as any
  const app = getApps().find((a: any) => a.name === 'policy') ?? initializeApp({ projectId: 'demo-iomixo' }, 'policy')
  const db = getFirestore(app)
  const dj = await mk('account'); const e = await seedPoll(dj.uid)
  ;(VOTE_POLICY as any).allowChange = false
  try {
    const uid = `policy-${Date.now()}`
    assert.equal((await votePoll(db, null, uid, { eventId: e.id, pollId: e.pollId, optionIndex: 0 })).alreadyVoted, false)
    assert.equal((await votePoll(db, null, uid, { eventId: e.id, pollId: e.pollId, optionIndex: 0 })).alreadyVoted, true)
    await assert.rejects(votePoll(db, null, uid, { eventId: e.id, pollId: e.pollId, optionIndex: 1 }), (err: any) => err.details?.reason === 'already_voted')
  } finally { (VOTE_POLICY as any).allowChange = true }
})
