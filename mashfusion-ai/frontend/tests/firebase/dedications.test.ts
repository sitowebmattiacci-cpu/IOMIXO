import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where } from 'firebase/firestore'
import { deleteApp } from 'firebase/app'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { newClient, closeClient, denied, newSignedOutDb, type TestClient } from './helpers'
import { seedSet, seedUpdate, eventFields } from './seed'
import { startFakeSupabase, type FakeSupabase } from './fakeSupabase'
import { subscribeApprovedDedications, subscribeEventDedications, listApprovedDedications, listEventDedications } from '../../lib/firebase/repositories/dedicationRepository'
import { sendDedication, DedicationError } from '../../lib/events/dedicationService'

let fake: FakeSupabase
const clients: TestClient[] = []
before(async () => { fake = await startFakeSupabase() })
after(async () => { await Promise.all(clients.map(closeClient)); await fake.close() })
const mk = async (k: 'account' | 'anonymous' = 'anonymous') => { const c = await newClient(k); clients.push(c); return c }

let n = 0
async function seedParty(ownerUid: string, extra: Record<string, unknown> = {}) {
  const slug = `dd${Date.now()}${n++}`, id = `dev${Date.now()}${n}`
  await seedSet(`events/${id}`, eventFields(ownerUid, slug, { type: 'party', dedicationsEnabled: true, legacySupabaseId: `dsess-${id}`, ...extra }))
  return { id, sess: `dsess-${id}` }
}
const call = (c: TestClient, data: unknown) => {
  const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  return httpsCallable<any, { dedicationId: string; projected: boolean }>(f, 'createDedication')(data as any)
}
async function rejects(p: Promise<unknown>) { try { await p } catch (e: any) { return { code: e.code, reason: e.details?.reason } } assert.fail('expected rejection') }
const past = new Date(Date.now() - 3600_000)
const dedDoc = (status: string, msg: string, extra: Record<string, unknown> = {}) =>
  ({ senderName: 'Zia', message: msg, status, createdAt: new Date(), updatedAt: new Date(), ...extra })

test('1. valid dedication: Firestore doc (no guest uid), legacy row, pending status', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedParty(dj.uid)
  const r = await call(g, { eventId: e.id, senderName: ' Zia  Maria ', message: '  Auguri   agli sposi  ' })
  assert.equal(r.data.projected, true)
  const d = (await getDoc(doc(dj.db, 'events', e.id, 'dedications', r.data.dedicationId))).data()!
  assert.equal(d.senderName, 'Zia Maria'); assert.equal(d.message, 'Auguri agli sposi'); assert.equal(d.status, 'pending')
  assert.ok(d.legacySupabaseId && d.createdAt); assert.equal('guestUid' in d, false)
  assert.equal(fake.dedications.at(-1)?.session_id, e.sess); assert.equal(fake.dedications.at(-1)?.guest_name, 'Zia Maria')
})

test('2/3/4/5. unauthenticated, missing, ended and disabled/unavailable are rejected with reasons', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedParty(dj.uid)
  const { app } = newSignedOutDb(); const f = getFunctions(app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  assert.deepEqual(await rejects(httpsCallable(f, 'createDedication')({ eventId: e.id, message: 'x' })), { code: 'functions/unauthenticated', reason: 'unauthenticated' })
  assert.deepEqual(await rejects(call(g, { eventId: 'nope', message: 'x' })), { code: 'functions/not-found', reason: 'event_not_found' })
  const ended = await seedParty(dj.uid, { status: 'ended' })
  assert.deepEqual(await rejects(call(g, { eventId: ended.id, message: 'x' })), { code: 'functions/failed-precondition', reason: 'event_ended' })
  const std = await seedParty(dj.uid, { type: 'standard' })
  assert.deepEqual(await rejects(call(g, { eventId: std.id, message: 'x' })), { code: 'functions/failed-precondition', reason: 'dedications_unavailable' })
  const noPlan = await seedParty(dj.uid, { dedicationsEnabled: false })
  assert.deepEqual(await rejects(call(g, { eventId: noPlan.id, message: 'x' })), { code: 'functions/permission-denied', reason: 'dedications_unavailable' })
  const notReady = await seedParty(dj.uid, { dedicationsEnabled: undefined })
  assert.deepEqual(await rejects(call(g, { eventId: notReady.id, message: 'x' })), { code: 'functions/failed-precondition', reason: 'event_not_ready' })
  assert.equal(fake.dedications.filter((r) => [ended, std, noPlan, notReady].some((x) => x.sess === r.session_id)).length, 0)
})

test('6. invalid payloads are rejected', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedParty(dj.uid)
  for (const bad of [{}, { eventId: e.id }, { eventId: e.id, message: '   ' }, { eventId: e.id, message: 'm'.repeat(501) },
    { eventId: e.id, message: 'ok', senderName: 's'.repeat(81) }, { eventId: e.id, message: 42 }, { eventId: e.id, message: 'ok', senderName: [1] }, { eventId: 'a/b', message: 'ok' }, null]) {
    assert.equal((await rejects(call(g, bad))).code, 'functions/invalid-argument', JSON.stringify(bad))
  }
})

test('7. spoofed guestUid / status / ownerUid / createdAt are ignored', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedParty(dj.uid)
  const r = await call(g, { eventId: e.id, message: 'spoof', guestUid: 'victim', status: 'approved', ownerUid: g.uid, createdAt: '2000-01-01' })
  const d = (await getDoc(doc(dj.db, 'events', e.id, 'dedications', r.data.dedicationId))).data()!
  assert.equal(d.status, 'pending'); assert.equal('guestUid' in d, false); assert.ok(d.createdAt.toDate().getFullYear() >= 2026)
  // anti-spam state is keyed by the TOKEN uid
  const res = await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/events/${e.id}/dedicationGuests/${g.uid}`, { headers: { authorization: 'Bearer owner' } })
  assert.equal(res.status, 200)
})

test('8/9. cooldown (30 s) and per-guest cap, with their own reasons', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedParty(dj.uid)
  await call(g, { eventId: e.id, message: 'one' })
  assert.deepEqual(await rejects(call(g, { eventId: e.id, message: 'two' })), { code: 'functions/resource-exhausted', reason: 'cooldown' })
  const g2 = await mk(); await seedSet(`events/${e.id}/dedicationGuests/${g2.uid}`, { count: 5, lastAt: past })
  assert.deepEqual(await rejects(call(g2, { eventId: e.id, message: 'six' })), { code: 'functions/resource-exhausted', reason: 'guest_limit' })
})

test('10. concurrency: same guest cannot bypass the cooldown; different guests are independent (no event cap)', async () => {
  const dj = await mk('account'); const e = await seedParty(dj.uid)
  const g = await mk()
  const same = await Promise.allSettled([1, 2, 3, 4].map((i) => call(g, { eventId: e.id, message: `s${i}` })))
  assert.equal(same.filter((r) => r.status === 'fulfilled').length, 1)
  const many = await Promise.all([mk(), mk(), mk(), mk()])
  const all = await Promise.allSettled(many.map((c, i) => call(c, { eventId: e.id, message: `m${i}` })))
  assert.equal(all.filter((r) => r.status === 'fulfilled').length, 4)
})

test('11. legacy insert failure rolls the reservation back', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedParty(dj.uid)
  fake.failInserts = true
  assert.deepEqual(await rejects(call(g, { eventId: e.id, message: 'x' })), { code: 'functions/unavailable', reason: 'bridge_failed' })
  fake.failInserts = false
  assert.ok((await call(g, { eventId: e.id, message: 'retry' })).data.dedicationId, 'no cooldown consumed')
  assert.equal((await listEventDedications(dj.db, e.id)).length, 1)
})

test('12/13/14. rules: owner reads all; guests read ONLY the approved wall; nobody writes', async () => {
  const dj = await mk('account'); const g = await mk(); const other = await mk('account'); const e = await seedParty(dj.uid)
  await seedSet(`events/${e.id}/dedications/p1`, dedDoc('pending', 'secret pending'))
  await seedSet(`events/${e.id}/dedications/a1`, dedDoc('approved', 'public approved'))
  await seedSet(`events/${e.id}/dedications/r1`, dedDoc('rejected', 'rejected one'))

  assert.equal((await listEventDedications(dj.db, e.id)).length, 3, 'owner reads everything')
  assert.deepEqual((await listApprovedDedications(g.db, e.id)).map((d) => d.message), ['public approved'])
  assert.deepEqual((await listApprovedDedications(other.db, e.id)).map((d) => d.message), ['public approved'])
  assert.ok(await denied(listEventDedications(g.db, e.id)), 'guest cannot list everything')
  assert.ok(await denied(getDocs(query(collection(g.db, 'events', e.id, 'dedications'), where('status', '==', 'pending')))), 'nor filter pending')
  assert.ok(await denied(getDoc(doc(g.db, 'events', e.id, 'dedications', 'p1'))))
  assert.ok((await getDoc(doc(g.db, 'events', e.id, 'dedications', 'a1'))).exists())
  const { app, db } = newSignedOutDb(); assert.ok(await denied(listApprovedDedications(db, e.id))); await deleteApp(app)

  for (const c of [g, dj, other]) {
    const ref = doc(c.db, 'events', e.id, 'dedications', 'a1')
    assert.ok(await denied(updateDoc(ref, { status: 'rejected' })))
    assert.ok(await denied(deleteDoc(ref)))
    assert.ok(await denied(addDoc(collection(c.db, 'events', e.id, 'dedications'), { message: 'direct', status: 'approved' })))
  }
  assert.ok(await denied(getDoc(doc(dj.db, 'events', e.id, 'dedicationGuests', g.uid))))
  assert.ok(await denied(setDoc(doc(g.db, 'events', e.id, 'dedicationGuests', g.uid), { count: 0, lastAt: null })))
})

test('15/16. realtime: guest wall gets only approvals; DJ listener gets new items; unsubscribe stops both', async () => {
  const dj = await mk('account'); const g = await mk(); const e = await seedParty(dj.uid)
  const wall: string[][] = [], djSeen: number[] = []
  const ug = subscribeApprovedDedications(g.db, e.id, (items) => wall.push(items.map((d) => d.message)))
  const ud = subscribeEventDedications(dj.db, e.id, (items) => djSeen.push(items.length))
  const until = async (cond: () => boolean) => { for (let i = 0; i < 60 && !cond(); i++) await new Promise((r) => setTimeout(r, 100)); assert.ok(cond(), `timeout wall=${JSON.stringify(wall)} dj=${djSeen}`) }
  await until(() => wall.length > 0 && djSeen.length > 0)

  const r = await call(g, { eventId: e.id, message: 'for the wall' })
  await until(() => djSeen.at(-1) === 1)
  assert.deepEqual(wall.at(-1), [], 'pending is not on the guest wall')
  await seedUpdate(`events/${e.id}/dedications/${r.data.dedicationId}`, { status: 'approved' })
  await until(() => wall.at(-1)?.[0] === 'for the wall')

  ug(); ud(); const w = wall.length, d = djSeen.length
  await seedUpdate(`events/${e.id}/dedications/${r.data.dedicationId}`, { status: 'rejected' })
  await new Promise((res) => setTimeout(res, 800))
  assert.equal(wall.length, w); assert.equal(djSeen.length, d)
})

test('client service: reasons map to the legacy wording; fallback only for not-ready / infrastructure', async () => {
  const dj = await mk('account')
  const notReady = await seedParty(dj.uid, { dedicationsEnabled: undefined })
  await assert.rejects(sendDedication({ eventId: notReady.id, message: 'x' }), (e: any) => e instanceof DedicationError && e.reason === 'event_not_ready' && e.fallbackToLegacy)
  const noPlan = await seedParty(dj.uid, { dedicationsEnabled: false })
  await assert.rejects(sendDedication({ eventId: noPlan.id, message: 'x' }), (e: any) => !e.fallbackToLegacy && /Advance/.test(e.message))
  const ok = await seedParty(dj.uid)
  assert.ok((await sendDedication({ eventId: ok.id, senderName: 'Io', message: 'via service' })).dedicationId)
  await assert.rejects(sendDedication({ eventId: ok.id, message: 'again' }), (e: any) => e.reason === 'cooldown' && !e.fallbackToLegacy)
})
