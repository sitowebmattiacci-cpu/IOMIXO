import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, orderBy, limit } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { newClient, closeClient, denied, newSignedOutDb, type TestClient } from './helpers'
import { seedSet, eventFields } from './seed'
import { startFakeSupabase, type FakeSupabase } from './fakeSupabase'
import { subscribeGuestRequests, subscribeEventRequests, listGuestRequests, listEventRequests } from '../../lib/firebase/repositories/requestRepository'
import { sendMusicRequest, RequestError } from '../../lib/events/requestService'

let fake: FakeSupabase
const clients: TestClient[] = []
before(async () => { fake = await startFakeSupabase() })
after(async () => { await Promise.all(clients.map(closeClient)); await fake.close() })
const mk = async (k: 'account' | 'anonymous' = 'anonymous') => { const c = await newClient(k); clients.push(c); return c }

let n = 0
async function seedEvent(ownerUid: string, extra: Record<string, unknown> = {}) {
  const slug = `rq${Date.now()}${n++}`, id = `ev${Date.now()}${n}`
  await seedSet(`events/${id}`, eventFields(ownerUid, slug, { type: 'standard', legacySupabaseId: `sess-${id}`, ...extra }))
  return { id, slug, sess: `sess-${id}` }
}
const fnsOf = (c: TestClient) => { const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001); return f }
const call = (c: TestClient, data: unknown) => httpsCallable<any, { requestId: string; projected: boolean }>(fnsOf(c), 'createMusicRequest')(data as any)
const reasonOf = (e: any) => ({ code: e.code, reason: e.details?.reason })
async function rejects(p: Promise<unknown>) { try { await p } catch (e) { return reasonOf(e) } assert.fail('expected rejection') }
const past = new Date(Date.now() - 3600_000)

test('1. anonymous guest creates a valid request (Firestore doc + legacy row, server-side fields)', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedEvent(dj.uid)
  const r = await call(g, { eventId: e.id, songTitle: '  Sweet   Child  ', artist: 'Guns', message: 'for Anna' })
  assert.equal(r.data.projected, true)
  const snap = (await getDoc(doc(g.db, 'events', e.id, 'requests', r.data.requestId))).data()!
  assert.equal(snap.guestUid, g.uid); assert.equal(snap.songTitle, 'Sweet Child'); assert.equal(snap.status, 'pending')
  assert.ok(snap.createdAt && snap.legacySupabaseId)
  assert.equal(fake.rows.at(-1)?.session_id, e.sess); assert.equal(fake.rows.at(-1)?.track_title, 'Sweet Child')
})

test('2. unauthenticated caller is rejected', async () => {
  const dj = await mk('account'); const e = await seedEvent(dj.uid)
  const { app, db } = newSignedOutDb(); void db
  const f = getFunctions(app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  const out = await rejects(httpsCallable(f, 'createMusicRequest')({ eventId: e.id, songTitle: 'x' }))
  assert.deepEqual(out, { code: 'functions/unauthenticated', reason: 'unauthenticated' })
})

test('3/4/12. missing, ended, disabled and not-ready events are rejected with a reason', async () => {
  const dj = await mk('account'); const g = await mk()
  assert.deepEqual(await rejects(call(g, { eventId: 'nope', songTitle: 'x' })), { code: 'functions/not-found', reason: 'event_not_found' })
  const ended = await seedEvent(dj.uid, { status: 'ended' })
  assert.deepEqual(await rejects(call(g, { eventId: ended.id, songTitle: 'x' })), { code: 'functions/failed-precondition', reason: 'event_ended' })
  const off = await seedEvent(dj.uid, { type: 'wedding', guestConfig: { requests: false } })
  assert.deepEqual(await rejects(call(g, { eventId: off.id, songTitle: 'x' })), { code: 'functions/failed-precondition', reason: 'requests_disabled' })
  const std = await seedEvent(dj.uid, { guestConfig: { requests: false } }) // standard sessions ignore guest_config
  assert.ok((await call(g, { eventId: std.id, songTitle: 'x' })).data.requestId)
  const notReady = await seedEvent(dj.uid, { requestLimit: undefined })
  assert.deepEqual(await rejects(call(await mk(), { eventId: notReady.id, songTitle: 'x' })), { code: 'functions/failed-precondition', reason: 'event_not_ready' })
})

test('5. invalid payloads are rejected', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedEvent(dj.uid)
  for (const bad of [
    {}, { eventId: e.id }, { eventId: e.id, songTitle: '   ' }, { eventId: e.id, songTitle: 'x'.repeat(201) },
    { eventId: e.id, songTitle: 'ok', artist: 'a'.repeat(201) }, { eventId: e.id, songTitle: 'ok', message: 'm'.repeat(501) },
    { eventId: e.id, songTitle: 123 }, { eventId: e.id, songTitle: 'ok', artist: { a: 1 } }, { eventId: 'a/b', songTitle: 'ok' }, null,
  ]) {
    const out = await rejects(call(g, bad)); assert.equal(out.code, 'functions/invalid-argument', JSON.stringify(bad))
  }
})

test('6. spoofed guestUid / status / createdAt / ownerUid in the payload are ignored', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedEvent(dj.uid)
  const r = await call(g, { eventId: e.id, songTitle: 'Spoof', guestUid: 'victim', status: 'approved', createdAt: '2000-01-01', ownerUid: g.uid, legacySupabaseId: 'x' })
  const d = (await getDoc(doc(g.db, 'events', e.id, 'requests', r.data.requestId))).data()!
  assert.equal(d.guestUid, g.uid); assert.equal(d.status, 'pending'); assert.notEqual(d.legacySupabaseId, 'x')
  assert.ok(d.createdAt.toDate().getFullYear() >= 2026)
})

test('7. cooldown: a second request right after the first is rejected', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedEvent(dj.uid)
  await call(g, { eventId: e.id, songTitle: 'one' })
  const out = await rejects(call(g, { eventId: e.id, songTitle: 'two' }))
  assert.deepEqual(out, { code: 'functions/resource-exhausted', reason: 'cooldown' })
  assert.equal(fake.rows.filter((r) => r.session_id === e.sess).length, 1)
})

test('8. per-guest cap', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedEvent(dj.uid)
  await seedSet(`events/${e.id}/requestGuests/${g.uid}`, { count: 10, lastAt: past })
  assert.deepEqual(await rejects(call(g, { eventId: e.id, songTitle: 'eleven' })), { code: 'functions/resource-exhausted', reason: 'guest_limit' })
})

test('9. event-wide limit (from the projected plan limit) and 15. counter seeded from the legacy count', async () => {
  const dj = await mk('account'); const a = await mk(); const b = await mk()
  const e = await seedEvent(dj.uid, { requestLimit: 1 })
  await call(a, { eventId: e.id, songTitle: 'first' })
  assert.deepEqual(await rejects(call(b, { eventId: e.id, songTitle: 'second' })), { code: 'functions/resource-exhausted', reason: 'event_limit' })
  const seeded = await seedEvent(dj.uid, { requestLimit: 5 }); fake.presetCount[seeded.sess] = 5
  assert.deepEqual(await rejects(call(b, { eventId: seeded.id, songTitle: 'x' })), { code: 'functions/resource-exhausted', reason: 'event_limit' })
  const unlimited = await seedEvent(dj.uid, { requestLimit: null })
  assert.ok((await call(a, { eventId: unlimited.id, songTitle: 'x' })).data.requestId)
})

test('10. concurrency: simultaneous requests cannot bypass the event limit or the cooldown', async () => {
  const dj = await mk('account')
  const guests = await Promise.all([mk(), mk(), mk(), mk(), mk()])
  const e = await seedEvent(dj.uid, { requestLimit: 2 })
  const results = await Promise.allSettled(guests.map((g, i) => call(g, { eventId: e.id, songTitle: `c${i}` })))
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2)
  assert.equal(fake.rows.filter((r) => r.session_id === e.sess).length, 2)
  const counter = (await seedCounter(e.id))
  assert.equal(counter, 2)

  const g = await mk(); const e2 = await seedEvent(dj.uid)
  const same = await Promise.allSettled([1, 2, 3].map((i) => call(g, { eventId: e2.id, songTitle: `s${i}` })))
  assert.equal(same.filter((r) => r.status === 'fulfilled').length, 1, 'same guest: cooldown holds under concurrency')
})
async function seedCounter(eventId: string) {
  const res = await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/events/${eventId}/state/requests`, { headers: { authorization: 'Bearer owner' } })
  return Number((await res.json() as any).fields.total.integerValue)
}

test('11. legacy insert failure rolls the reservation back (guest can retry immediately)', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedEvent(dj.uid, { requestLimit: 1 })
  fake.failInserts = true
  assert.deepEqual(await rejects(call(g, { eventId: e.id, songTitle: 'x' })), { code: 'functions/unavailable', reason: 'bridge_failed' })
  fake.failInserts = false
  assert.ok((await call(g, { eventId: e.id, songTitle: 'retry' })).data.requestId, 'cooldown and cap were not consumed')
  assert.equal(await seedCounter(e.id), 1)
})

test('13. rules: owner reads all, guest only own, nobody writes', async () => {
  const dj = await mk('account'); const g1 = await mk(); const g2 = await mk(); const other = await mk('account')
  const e = await seedEvent(dj.uid)
  const r1 = await call(g1, { eventId: e.id, songTitle: 'by g1' }); await call(g2, { eventId: e.id, songTitle: 'by g2' })

  assert.equal((await listEventRequests(dj.db, e.id)).length, 2)
  assert.deepEqual((await listGuestRequests(g1.db, e.id, g1.uid)).map((r) => r.songTitle), ['by g1'])
  assert.ok(await denied(listEventRequests(g1.db, e.id)), 'guest cannot list all')
  assert.ok(await denied(listGuestRequests(g1.db, e.id, g2.uid)), 'guest cannot filter on someone else')
  assert.ok(await denied(listEventRequests(other.db, e.id)), 'other signed-in user')
  assert.ok(await denied(getDoc(doc(g2.db, 'events', e.id, 'requests', r1.data.requestId))))
  assert.ok((await getDoc(doc(g1.db, 'events', e.id, 'requests', r1.data.requestId))).exists())

  const ref = (c: TestClient) => doc(c.db, 'events', e.id, 'requests', r1.data.requestId)
  for (const c of [g1, g2, dj, other]) {
    assert.ok(await denied(updateDoc(ref(c), { status: 'approved' })))
    assert.ok(await denied(deleteDoc(ref(c))))
    assert.ok(await denied(addDoc(collection(c.db, 'events', e.id, 'requests'), { guestUid: c.uid, songTitle: 'direct', status: 'pending' })))
  }
  // server-only helper docs are closed
  assert.ok(await denied(getDoc(doc(dj.db, 'events', e.id, 'state', 'requests'))))
  assert.ok(await denied(getDoc(doc(g1.db, 'events', e.id, 'requestGuests', g1.uid))))
  assert.ok(await denied(setDoc(doc(g1.db, 'events', e.id, 'requestGuests', g1.uid), { count: 0, lastAt: null })))
})

test('14/15. realtime: guest and DJ listeners receive new requests; unsubscribe stops them', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedEvent(dj.uid, { requestLimit: null })
  const guestSeen: number[] = [], djSeen: number[] = []
  const ug = subscribeGuestRequests(g.db, e.id, g.uid, (r) => guestSeen.push(r.length))
  const ud = subscribeEventRequests(dj.db, e.id, (r) => djSeen.push(r.length))
  const until = async (cond: () => boolean) => { for (let i = 0; i < 60 && !cond(); i++) await new Promise((r) => setTimeout(r, 100)); assert.ok(cond(), `timeout guest=${guestSeen} dj=${djSeen}`) }

  await until(() => guestSeen.length > 0 && djSeen.length > 0)
  await call(g, { eventId: e.id, songTitle: 'live one' })
  await until(() => guestSeen.at(-1) === 1 && djSeen.at(-1) === 1)

  ug(); ud()
  const gCount = guestSeen.length, dCount = djSeen.length
  await seedSet(`events/${e.id}/requests/manual`, { guestUid: g.uid, songTitle: 'after unsub', status: 'pending', createdAt: new Date() })
  await new Promise((r) => setTimeout(r, 800))
  assert.equal(guestSeen.length, gCount); assert.equal(djSeen.length, dCount)
})

test('16. client service maps errors; legacy fallback only for infrastructure / not-ready cases', async () => {
  const dj = await mk('account')
  const notReady = await seedEvent(dj.uid, { requestLimit: undefined })
  await assert.rejects(sendMusicRequest({ eventId: notReady.id, songTitle: 'x' }), (e: any) => e instanceof RequestError && e.reason === 'event_not_ready' && e.fallbackToLegacy === true)
  const ended = await seedEvent(dj.uid, { status: 'ended' })
  await assert.rejects(sendMusicRequest({ eventId: ended.id, songTitle: 'x' }), (e: any) => e instanceof RequestError && e.reason === 'event_ended' && e.fallbackToLegacy === false && /terminata/.test(e.message))
  const ok = await seedEvent(dj.uid)
  assert.ok((await sendMusicRequest({ eventId: ok.id, songTitle: 'via service' })).requestId)
  await assert.rejects(sendMusicRequest({ eventId: ok.id, songTitle: 'again' }), (e: any) => e.reason === 'cooldown' && e.fallbackToLegacy === false && /20 secondi/.test(e.message))
})

test('query helpers are bounded and ordered newest first', async () => {
  const dj = await mk('account'); const e = await seedEvent(dj.uid)
  await seedSet(`events/${e.id}/requests/a`, { guestUid: null, songTitle: 'old', status: 'pending', createdAt: new Date('2026-01-01') })
  await seedSet(`events/${e.id}/requests/b`, { guestUid: null, songTitle: 'new', status: 'approved', createdAt: new Date('2026-02-01') })
  assert.deepEqual((await listEventRequests(dj.db, e.id)).map((r) => r.songTitle), ['new', 'old'])
  assert.equal((await listEventRequests(dj.db, e.id, 1)).length, 1)
  assert.ok(await denied(getDocs(query(collection(dj.db, 'events', e.id, 'requests'), where('status', '==', 'pending')))) === false, 'owner may filter')
  void orderBy; void limit
})
