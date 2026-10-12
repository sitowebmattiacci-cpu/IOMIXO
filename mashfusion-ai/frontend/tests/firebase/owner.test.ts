import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, getDoc, getDocs, updateDoc, setDoc, deleteDoc, collection } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { deleteApp } from 'firebase/app'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { newClient, closeClient, denied, newSignedOutDb, type TestClient } from './helpers'
import { seedSet, seedUpdate, eventFields } from './seed'
import { startFakeSupabase, type FakeSupabase } from './fakeSupabase'
import { subscribeEventRequests, subscribeGuestRequests } from '../../lib/firebase/repositories/requestRepository'
import { listApprovedDedications } from '../../lib/firebase/repositories/dedicationRepository'
import { getActivePoll, sumTally } from '../../lib/firebase/repositories/pollRepository'
import { getFirebaseAuth, getFirebaseApp } from '../../lib/firebase/client'

let fake: FakeSupabase
const clients: TestClient[] = []
before(async () => { fake = await startFakeSupabase() })
after(async () => { await Promise.all(clients.map(closeClient)); await fake.close() })
const mk = async (k: 'account' | 'anonymous' = 'account') => { const c = await newClient(k); clients.push(c); return c }

let n = 0
const callAs = <O = any>(c: TestClient, name: string, data: unknown) => {
  const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  return httpsCallable<any, O>(f, name)(data as any).then((r) => r.data)
}
async function fails(p: Promise<unknown>) { try { await p } catch (e: any) { return `${String(e.code).replace('functions/', '')}:${e.details?.reason ?? ''}` } assert.fail('expected rejection') }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, ms = 8000) { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) assert.fail('timeout'); await sleep(50) } }

/** An Advance owner (server-written plan) and one of their events. */
async function seedEvent(ownerUid: string, over: Record<string, unknown> = {}, tier: 'wedding' | 'free' | 'pro' = 'wedding') {
  const id = `oev${Date.now()}${n++}`, slug = `os${id}`
  await seedSet(`users/${ownerUid}`, { uid: ownerUid, plan: { tier, source: 'legacy' } })
  await seedSet(`events/${id}`, eventFields(ownerUid, slug, { type: 'party', ...over }))
  await seedSet(`eventSlugs/${slug}`, { eventId: id })
  return { id, slug }
}
const seedRequest = async (eventId: string, guestUid: string, status = 'pending') => {
  const rid = `r${Date.now()}${n++}`
  await seedSet(`events/${eventId}/requests/${rid}`, { guestUid, songTitle: 'Song', artist: null, message: null, status, createdAt: new Date(), updatedAt: new Date() })
  return rid
}
const seedDedication = async (eventId: string, status = 'pending') => {
  const did = `d${Date.now()}${n++}`
  await seedSet(`events/${eventId}/dedications/${did}`, { senderName: 'Zia', message: 'Auguri', status, createdAt: new Date(), updatedAt: new Date() })
  return did
}

// ── A. music request moderation ───────────────────────────────────────────────
test('A1. owner approves / rejects / resets a request; repeating is a no-op; guest + owner see it in realtime', async () => {
  const dj = await mk(); const g = await mk('anonymous'); const e = await seedEvent(dj.uid); const rid = await seedRequest(e.id, g.uid)
  const ownerSeen: string[] = [], guestSeen: string[] = []
  const u1 = subscribeEventRequests(dj.db, e.id, (r) => ownerSeen.push(r.find((x) => x.id === rid)?.status ?? '-'))
  const u2 = subscribeGuestRequests(g.db, e.id, g.uid, (r) => guestSeen.push(r.find((x) => x.id === rid)?.status ?? '-'))
  assert.deepEqual(await callAs(dj, 'moderateRequest', { eventId: e.id, requestId: rid, action: 'set_status', status: 'approved' }), { changed: true, status: 'approved' })
  await until(() => ownerSeen.at(-1) === 'approved' && guestSeen.at(-1) === 'approved')
  assert.deepEqual(await callAs(dj, 'moderateRequest', { eventId: e.id, requestId: rid, action: 'set_status', status: 'approved' }), { changed: false, status: 'approved' })
  await callAs(dj, 'moderateRequest', { eventId: e.id, requestId: rid, action: 'set_status', status: 'rejected' })
  await until(() => guestSeen.at(-1) === 'rejected')
  await callAs(dj, 'moderateRequest', { eventId: e.id, requestId: rid, action: 'set_status', status: 'pending' })
  await until(() => ownerSeen.at(-1) === 'pending')
  u1(); u2()
})

test('A2. delete removes the request, frees one counter slot, and repeating is idempotent', async () => {
  const dj = await mk(); const g = await mk('anonymous'); const e = await seedEvent(dj.uid)
  const rid = await seedRequest(e.id, g.uid); await seedSet(`events/${e.id}/state/requests`, { total: 3 })
  assert.deepEqual(await callAs(dj, 'moderateRequest', { eventId: e.id, requestId: rid, action: 'delete' }), { changed: true, deleted: true })
  assert.equal((await getDoc(doc(dj.db, 'events', e.id, 'requests', rid))).exists(), false)
  const counter = await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-iomixo/databases/(default)/documents/events/${e.id}/state/requests`, { headers: { authorization: 'Bearer owner' } })).json() as any
  assert.equal(counter.fields.total.integerValue, '2')
  assert.deepEqual(await callAs(dj, 'moderateRequest', { eventId: e.id, requestId: rid, action: 'delete' }), { changed: false, deleted: true })
})

test('A3. unauthorized: signed-out, anonymous, another account, wrong event, missing request, invalid payload — nothing changes', async () => {
  const dj = await mk(); const other = await mk(); const g = await mk('anonymous'); const e = await seedEvent(dj.uid); const other2 = await seedEvent(other.uid)
  const rid = await seedRequest(e.id, g.uid)
  const call = (c: TestClient, d: unknown) => fails(callAs(c, 'moderateRequest', d))
  const ok = { eventId: e.id, requestId: rid, action: 'set_status', status: 'approved' }
  const { app } = newSignedOutDb(); const f = getFunctions(app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  assert.equal(await fails(httpsCallable(f, 'moderateRequest')(ok as any)), 'unauthenticated:unauthenticated'); await deleteApp(app)
  assert.equal(await call(g, ok), 'permission-denied:account_required')                       // the guest who sent it cannot moderate it
  assert.equal(await call(other, ok), 'not-found:event_not_found')                            // another account: same answer as a missing event
  assert.equal(await call(dj, { ...ok, eventId: other2.id }), 'not-found:event_not_found')    // own token, someone else's event
  assert.equal(await call(dj, { ...ok, requestId: 'nope' }), 'not-found:request_not_found')
  for (const bad of [{ ...ok, status: 'banana' }, { ...ok, action: 'drop' }, { ...ok, requestId: 'a/b' }, { eventId: e.id }, null]) assert.equal((await call(dj, bad)).split(':')[0], 'invalid-argument', JSON.stringify(bad))
  assert.equal((await getDoc(doc(dj.db, 'events', e.id, 'requests', rid))).data()?.status, 'pending')
  // direct client writes stay denied for everybody, including the owner
  assert.ok(await denied(updateDoc(doc(dj.db, 'events', e.id, 'requests', rid), { status: 'approved' })))
  assert.ok(await denied(deleteDoc(doc(dj.db, 'events', e.id, 'requests', rid))))
  assert.ok(await denied(updateDoc(doc(g.db, 'events', e.id, 'requests', rid), { status: 'approved' })))
})

// ── B. dedication moderation ──────────────────────────────────────────────────
test('B1. owner approves → guests see it on the wall; rejecting hides it; delete works; repeating is a no-op', async () => {
  const dj = await mk(); const g = await mk('anonymous'); const e = await seedEvent(dj.uid); const did = await seedDedication(e.id)
  assert.equal((await listApprovedDedications(g.db, e.id)).length, 0)
  assert.deepEqual(await callAs(dj, 'moderateDedication', { eventId: e.id, dedicationId: did, action: 'set_status', status: 'approved' }), { changed: true, status: 'approved' })
  assert.deepEqual((await listApprovedDedications(g.db, e.id)).map((d) => d.message), ['Auguri'])
  assert.equal((await callAs(dj, 'moderateDedication', { eventId: e.id, dedicationId: did, action: 'set_status', status: 'approved' })).changed, false)
  await callAs(dj, 'moderateDedication', { eventId: e.id, dedicationId: did, action: 'set_status', status: 'rejected' })
  assert.equal((await listApprovedDedications(g.db, e.id)).length, 0)
  assert.deepEqual(await callAs(dj, 'moderateDedication', { eventId: e.id, dedicationId: did, action: 'delete' }), { changed: true, deleted: true })
  assert.equal((await callAs(dj, 'moderateDedication', { eventId: e.id, dedicationId: did, action: 'delete' })).changed, false)
})

test('B2. unauthorized + premium gate: guest/other account denied; a Free owner cannot change status (can still delete); direct writes denied', async () => {
  const dj = await mk(); const other = await mk(); const g = await mk('anonymous')
  const e = await seedEvent(dj.uid); const did = await seedDedication(e.id)
  const call = (c: TestClient, d: unknown) => fails(callAs(c, 'moderateDedication', d))
  const ok = { eventId: e.id, dedicationId: did, action: 'set_status', status: 'approved' }
  assert.equal(await call(g, ok), 'permission-denied:account_required')
  assert.equal(await call(other, ok), 'not-found:event_not_found')
  assert.equal(await call(dj, { ...ok, dedicationId: 'nope' }), 'not-found:dedication_not_found')
  assert.equal((await call(dj, { ...ok, status: 'x' })).split(':')[0], 'invalid-argument')
  assert.ok(await denied(updateDoc(doc(dj.db, 'events', e.id, 'dedications', did), { status: 'approved' })))
  const free = await mk(); const fe = await seedEvent(free.uid, {}, 'free'); const fd = await seedDedication(fe.id)
  assert.equal(await call(free, { eventId: fe.id, dedicationId: fd, action: 'set_status', status: 'approved' }), 'permission-denied:event_access_required')
  assert.equal((await getDoc(doc(free.db, 'events', fe.id, 'dedications', fd))).data()?.status, 'pending')
  assert.equal((await callAs(free, 'moderateDedication', { eventId: fe.id, dedicationId: fd, action: 'delete' })).changed, true)
  // owner without any server-written plan: the projected flag decides (legacy fallback)
  const lone = await mk(); const le = `oev-lone${Date.now()}`
  await seedSet(`events/${le}`, eventFields(lone.uid, `s${le}`, { type: 'party', dedicationsEnabled: false }))
  const ld = await seedDedication(le)
  assert.equal(await call(lone, { eventId: le, dedicationId: ld, action: 'set_status', status: 'approved' }), 'permission-denied:event_access_required')
  await seedUpdate(`events/${le}`, { dedicationsEnabled: true })
  assert.equal((await callAs(lone, 'moderateDedication', { eventId: le, dedicationId: ld, action: 'set_status', status: 'approved' })).changed, true)
})

// ── C. polls ──────────────────────────────────────────────────────────────────
test('C1. createPoll → guests see it open and vote (Firestore-native poll, no bridge); a new poll closes the previous one; setPollStatus is idempotent', async () => {
  const dj = await mk(); const g = await mk('anonymous'); const e = await seedEvent(dj.uid)
  const p1 = await callAs<{ pollId: string; closedPollIds: string[] }>(dj, 'createPoll', { eventId: e.id, question: '  Quale   canzone? ', options: ['A', 'B', 'C'] })
  assert.deepEqual(p1.closedPollIds, [])
  const active = await getActivePoll(g.db, e.id)
  assert.equal(active?.id, p1.pollId); assert.equal(active?.question, 'Quale canzone?'); assert.deepEqual(active?.options, ['A', 'B', 'C'])
  assert.deepEqual(await callAs(g, 'votePoll', { eventId: e.id, pollId: p1.pollId, optionIndex: 1 }), { optionIndex: 1, changed: false, alreadyVoted: false })
  const tally = sumTally((await getDocs(collection(g.db, 'events', e.id, 'polls', p1.pollId, 'tally'))).docs.map((d) => d.data()), 3)
  assert.deepEqual(tally, [0, 1, 0])
  assert.equal(fake.pollVotes.size, 0, 'native poll: nothing is mirrored to Supabase')
  const p2 = await callAs<{ pollId: string; closedPollIds: string[] }>(dj, 'createPoll', { eventId: e.id, question: 'Seconda', options: ['X', 'Y'] })
  assert.deepEqual(p2.closedPollIds, [p1.pollId]); assert.equal((await getActivePoll(g.db, e.id))?.id, p2.pollId)
  assert.equal(await fails(callAs(g, 'votePoll', { eventId: e.id, pollId: p1.pollId, optionIndex: 0 })), 'failed-precondition:poll_closed')
  assert.deepEqual(await callAs(dj, 'setPollStatus', { eventId: e.id, pollId: p2.pollId, open: false }), { changed: true, status: 'closed' })
  assert.deepEqual(await callAs(dj, 'setPollStatus', { eventId: e.id, pollId: p2.pollId, open: false }), { changed: false, status: 'closed' })
  assert.equal(await getActivePoll(g.db, e.id), null)
  assert.deepEqual(await callAs(dj, 'setPollStatus', { eventId: e.id, pollId: p2.pollId, open: true }), { changed: true, status: 'open' })
})

test('C2. two simultaneous createPoll calls leave exactly ONE open poll', async () => {
  const dj = await mk(); const e = await seedEvent(dj.uid)
  await Promise.all([1, 2, 3].map((i) => callAs(dj, 'createPoll', { eventId: e.id, question: `Q${i}`, options: ['A', 'B'] })))
  const polls = (await getDocs(collection(dj.db, 'events', e.id, 'polls'))).docs.map((d) => d.data().status)
  assert.equal(polls.length, 3); assert.equal(polls.filter((s) => s === 'open').length, 1)
})

test('C3. unauthorized / gated / invalid: guest, other account, standard event, Free owner, bad options, direct writes', async () => {
  const dj = await mk(); const other = await mk(); const g = await mk('anonymous'); const e = await seedEvent(dj.uid)
  const create = (c: TestClient, d: unknown) => fails(callAs(c, 'createPoll', d))
  const ok = { eventId: e.id, question: 'Q?', options: ['A', 'B'] }
  assert.equal(await create(g, ok), 'permission-denied:account_required')
  assert.equal(await create(other, ok), 'not-found:event_not_found')
  for (const bad of [{ ...ok, options: ['A'] }, { ...ok, options: ['A', 'B', 'C', 'D', 'E'] }, { ...ok, options: ['A', ''] }, { ...ok, options: 'AB' }, { ...ok, question: '' }, { ...ok, question: 'x'.repeat(201) }, { ...ok, options: ['A', 'x'.repeat(81)] }]) {
    assert.equal((await create(dj, bad)).split(':')[0], 'invalid-argument', JSON.stringify(bad).slice(0, 80))
  }
  const std = await seedEvent(dj.uid, { type: 'standard' })
  assert.equal(await create(dj, { ...ok, eventId: std.id }), 'failed-precondition:polls_unavailable')
  const free = await mk(); const fe = await seedEvent(free.uid, {}, 'free')
  assert.equal(await create(free, { ...ok, eventId: fe.id }), 'permission-denied:event_access_required')
  assert.equal((await getDocs(collection(dj.db, 'events', fe.id, 'polls'))).size, 0)
  const { pollId } = await callAs(dj, 'createPoll', ok)
  assert.equal(await fails(callAs(g, 'setPollStatus', { eventId: e.id, pollId, open: false })), 'permission-denied:account_required')
  assert.equal(await fails(callAs(other, 'setPollStatus', { eventId: e.id, pollId, open: false })), 'not-found:event_not_found')
  assert.equal(await fails(callAs(dj, 'setPollStatus', { eventId: e.id, pollId: 'nope', open: false })), 'not-found:poll_not_found')
  assert.equal((await fails(callAs(dj, 'setPollStatus', { eventId: e.id, pollId, open: 'no' }))).split(':')[0], 'invalid-argument')
  assert.ok(await denied(updateDoc(doc(dj.db, 'events', e.id, 'polls', pollId), { status: 'closed' })))
  assert.ok(await denied(setDoc(doc(dj.db, 'events', e.id, 'polls', 'mine'), { question: 'x', options: ['a', 'b'], status: 'open' })))
  assert.ok(await denied(setDoc(doc(g.db, 'events', e.id, 'polls', 'mine'), { question: 'x', options: ['a', 'b'], status: 'open' })))
})

// ── D. public event lookup ────────────────────────────────────────────────────
test('D1. getPublicEvent: guests resolve by slug; legacy payload shape; plan-dependent socials/features; requestsRemaining from the counter', async () => {
  const dj = await mk(); const g = await mk('anonymous'); const e = await seedEvent(dj.uid)
  await seedSet(`djProfiles/${dj.uid}`, { displayName: 'DJ X', bio: 'b', avatarUrl: 'https://x/y.png', instagramUrl: 'https://ig/x', createdAt: new Date(), updatedAt: new Date() })
  const r = await callAs(g, 'getPublicEvent', { slug: e.slug })
  assert.equal(r.eventId, e.id)
  assert.deepEqual(r.session, { id: e.id, event_name: 'Wedding Anna & Marco', dj_name: 'DJ X', description: null, is_active: true, session_type: 'party', couple_names: 'Anna & Marco', wedding_date: '2026-09-12', venue_name: 'Villa', screen_mode_enabled: true, guest_config: { requests: true } })
  assert.equal(r.plan, 'wedding'); assert.equal(r.branding, 'full'); assert.equal(r.features.screenMode, true); assert.equal(r.requestsRemaining, null); assert.deepEqual(r.events, [])
  assert.deepEqual(r.profile, { display_name: 'DJ X', bio: 'b', avatar_url: 'https://x/y.png', instagram_url: 'https://ig/x', tiktok_url: null, spotify_url: null, soundcloud_url: null, website_url: null })
  const free = await mk(); const fe = await seedEvent(free.uid, {}, 'free'); await seedSet(`djProfiles/${free.uid}`, { displayName: 'F', instagramUrl: 'https://ig/f', createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/${fe.id}/state/requests`, { total: 12 })
  const f = await callAs(g, 'getPublicEvent', { slug: fe.slug })
  assert.equal(f.plan, 'free'); assert.equal(f.features.screenMode, false); assert.equal(f.profile.instagram_url, null); assert.equal(f.requestsRemaining, 18)
  await seedUpdate(`events/${fe.id}`, { status: 'ended' })
  assert.equal((await callAs(g, 'getPublicEvent', { slug: fe.slug })).session.is_active, false)
})

test('D2. getPublicEvent: signed-out denied, unknown slug not-found, bad slug invalid', async () => {
  const g = await mk('anonymous')
  const { app } = newSignedOutDb(); const f = getFunctions(app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  assert.equal(await fails(httpsCallable(f, 'getPublicEvent')({ slug: 'x' })), 'unauthenticated:unauthenticated'); await deleteApp(app)
  assert.equal(await fails(callAs(g, 'getPublicEvent', { slug: 'does-not-exist' })), 'not-found:event_not_found')
  assert.equal((await fails(callAs(g, 'getPublicEvent', { slug: 'a/b' }))).split(':')[0], 'invalid-argument')
  assert.equal((await fails(callAs(g, 'getPublicEvent', {}))).split(':')[0], 'invalid-argument')
})

// ── E. screen config ──────────────────────────────────────────────────────────
test('E1. updateEventConfig: owner edits TV toggles / guest config / screen mode; winner_announcement is preserved; only these fields', async () => {
  const dj = await mk(); const g = await mk('anonymous'); const e = await seedEvent(dj.uid)
  await seedUpdate(`events/${e.id}`, { screenConfig: { show_polls: false, winner_announcement: { groom_photo_path: `${e.id}/g.jpg` } } })
  const r = await callAs(dj, 'updateEventConfig', { eventId: e.id, screenConfig: { show_polls: true, show_dedications: true, winner_announcement: { groom_photo_path: 'evil/other' } }, guestConfig: { requests: false }, screenModeEnabled: false, title: 'hacked', ownerUid: g.uid })
  assert.deepEqual(r.updated.sort(), ['guestConfig', 'screenConfig', 'screenModeEnabled'])
  const ev = (await getDoc(doc(g.db, 'events', e.id))).data()!
  assert.deepEqual(ev.screenConfig, { show_polls: true, show_dedications: true, winner_announcement: { groom_photo_path: `${e.id}/g.jpg` } })
  assert.deepEqual(ev.guestConfig, { requests: false }); assert.equal(ev.screenModeEnabled, false); assert.equal(ev.title, 'Wedding Anna & Marco'); assert.equal(ev.ownerUid, dj.uid)
  await callAs(dj, 'updateEventConfig', { eventId: e.id, screenConfig: null })
  assert.equal((await getDoc(doc(g.db, 'events', e.id))).data()!.screenConfig, null)
})

test('E1b. winnerAnnouncement is the ONLY way to change the winner signal; eventFields mirror the legacy-owned event fields (validated, status live/ended)', async () => {
  const dj = await mk(); const e = await seedEvent(dj.uid)
  await callAs(dj, 'updateEventConfig', { eventId: e.id, screenConfig: { show_polls: true }, winnerAnnouncement: { groom_photo_path: `${e.id}/g.jpg`, enabled: true } })
  assert.deepEqual((await getDoc(doc(dj.db, 'events', e.id))).data()!.screenConfig, { show_polls: true, winner_announcement: { groom_photo_path: `${e.id}/g.jpg`, enabled: true } })
  await callAs(dj, 'updateEventConfig', { eventId: e.id, screenConfig: { show_polls: false } })                 // later toggles keep the signal
  assert.ok((await getDoc(doc(dj.db, 'events', e.id))).data()!.screenConfig.winner_announcement)
  await callAs(dj, 'updateEventConfig', { eventId: e.id, winnerAnnouncement: null })                              // reset (legacy cleaned the photos)
  assert.equal((await getDoc(doc(dj.db, 'events', e.id))).data()!.screenConfig.winner_announcement, null)
  const r = await callAs(dj, 'updateEventConfig', { eventId: e.id, eventFields: { title: 'Nuovo titolo', djName: null, venueName: 'Villa Rosa', status: 'ended', ownerUid: 'x', type: 'wedding' } })
  assert.deepEqual(r.updated.sort(), ['djName', 'status', 'title', 'venueName'])
  const after = (await getDoc(doc(dj.db, 'events', e.id))).data()!
  assert.deepEqual([after.title, after.djName, after.venueName, after.status, after.type, after.ownerUid], ['Nuovo titolo', null, 'Villa Rosa', 'ended', 'party', dj.uid])
  for (const bad of [{ title: '' }, { title: 5 }, { status: 'paused' }, { weddingDate: 'x'.repeat(40) }, 'x']) {
    assert.equal((await fails(callAs(dj, 'updateEventConfig', { eventId: e.id, eventFields: bad }))).split(':')[0], 'invalid-argument', JSON.stringify(bad))
  }
})

test('E2. updateEventConfig: unauthorized and invalid payloads are refused', async () => {
  const dj = await mk(); const other = await mk(); const g = await mk('anonymous'); const e = await seedEvent(dj.uid)
  const call = (c: TestClient, d: unknown) => fails(callAs(c, 'updateEventConfig', d))
  assert.equal(await call(g, { eventId: e.id, screenConfig: {} }), 'permission-denied:account_required')
  assert.equal(await call(other, { eventId: e.id, screenConfig: {} }), 'not-found:event_not_found')
  for (const bad of [{ eventId: e.id }, { eventId: e.id, screenConfig: [] }, { eventId: e.id, screenConfig: 'x' }, { eventId: e.id, screenConfig: { big: 'x'.repeat(17_000) } }, { eventId: e.id, screenModeEnabled: 'yes' }]) {
    assert.equal((await call(dj, bad)).split(':')[0], 'invalid-argument', JSON.stringify(bad).slice(0, 60))
  }
  assert.ok(await denied(updateDoc(doc(dj.db, 'events', e.id), { screenConfig: { show_polls: true } })))
})

// ── client service (flag + legacy shapes + id registry) ───────────────────────
test('F. ownerOps: flag off → null (legacy); on → Firestore lists in the legacy shapes, actions via callables, unknown ids fall back', async () => {
  const { ownerOps, ownerOpsEnabled } = await import('../../lib/events/ownerService')
  const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), `svc${Date.now()}@example.com`, 'password123')
  const uid = cred.user.uid, legacy = `legacy-svc-${Date.now()}`
  const e = await seedEvent(uid, { legacySupabaseId: legacy })
  const g = await mk('anonymous'); const rid = await seedRequest(e.id, g.uid); const did = await seedDedication(e.id)

  delete process.env.NEXT_PUBLIC_FIRESTORE_OWNER_OPS
  assert.equal(ownerOpsEnabled(), false); assert.equal(await ownerOps.requests.list(legacy), null)
  process.env.NEXT_PUBLIC_FIRESTORE_OWNER_OPS = 'on'
  assert.equal(ownerOpsEnabled(), true)

  const reqs = await ownerOps.requests.list(legacy)
  assert.deepEqual(reqs?.map((r) => [r.id, r.track_title, r.status, r.session_id]), [[rid, 'Song', 'pending', legacy]])
  assert.equal(await ownerOps.requests.setStatus('unknown-id', 'approved'), false)
  assert.equal(await ownerOps.requests.setStatus(rid, 'approved'), true)
  assert.equal((await ownerOps.requests.list(legacy))?.[0].status, 'approved')
  const deds = await ownerOps.dedications.list(legacy)
  assert.deepEqual(deds?.map((d) => [d.id, d.guest_name, d.status]), [[did, 'Zia', 'pending']])
  assert.equal(await ownerOps.dedications.setStatus(did, 'approved'), true)
  const poll = await ownerOps.polls.create(legacy, { question: 'Q?', options: ['A', 'B'] })
  assert.equal(poll?.is_active, true)
  await callAs(g, 'votePoll', { eventId: e.id, pollId: poll!.id, optionIndex: 0 })
  assert.deepEqual((await ownerOps.polls.list(legacy))?.map((p) => [p.id, p.is_active, p.tally]), [[poll!.id, true, [1, 0]]])
  assert.equal(await ownerOps.polls.setActive(poll!.id, false), true)
  assert.equal((await ownerOps.polls.list(legacy))?.[0].is_active, false)
  assert.equal(await ownerOps.requests.remove(rid), true)
  assert.equal(await ownerOps.requests.list('not-a-migrated-session'), null)       // event not in Firestore → legacy route
  await assert.rejects(ownerOps.polls.create(legacy, { question: 'Q', options: ['only one'] }), /Dati non validi/)
  delete process.env.NEXT_PUBLIC_FIRESTORE_OWNER_OPS
  await deleteApp(getFirebaseApp())          // the default app keeps listeners/streams open and would stop the process from exiting
})
