import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { doc, getDoc, getDocs, collection, query, where, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { newClient, closeClient, denied, type TestClient } from './helpers'
import { seedSet } from './seed'
import { createUser, getUser } from '../../lib/firebase/repositories/userRepository'

/** Account roles: users/{uid}.accountType 'dj' | 'couple' (UI label "Sposi"). No field = legacy account = DJ. */
const clients: TestClient[] = []
after(async () => { await Promise.all(clients.map(closeClient)) })
const mk = async (k: 'account' | 'anonymous' = 'account') => { const c = await newClient(k); clients.push(c); return c }
const callAs = <O = any>(c: TestClient, name: string, data: unknown) => {
  const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001)
  return httpsCallable<any, O>(f, name)(data as any).then((r) => r.data)
}
async function fails(p: Promise<unknown>) { try { await p } catch (e: any) { return `${String(e.code).replace('functions/', '')}:${e.details?.reason ?? ''}` } assert.fail('expected rejection') }
let n = 0
const rid = () => `acc${Date.now()}${n++}`

/** Seeds the account doc server-side (plan Advance so plan gates never mask the role gate). */
const account = async (type: 'dj' | 'couple' | undefined) => {
  const c = await mk()
  await seedSet(`users/${c.uid}`, { uid: c.uid, email: c.email, ...(type ? { accountType: type } : {}), plan: { tier: 'wedding', source: 'legacy' } })
  return c
}
const create = (c: TestClient, over: Record<string, unknown> = {}) =>
  callAs<{ eventId: string; slug: string }>(c, 'createEvent', { requestId: rid(), title: 'Evento', type: 'wedding', ...over })

// ── users/{uid} rules ───────────────────────────────────────────────────────
test('R1. sign-up may write accountType dj|couple (and nothing else); other values are refused', async () => {
  const a = await mk(), b = await mk(), c = await mk()
  await createUser(a.db, { uid: a.uid, email: a.email, accountType: 'couple' })
  assert.equal((await getUser(a.db, a.uid))?.accountType, 'couple')
  await createUser(b.db, { uid: b.uid, email: b.email, accountType: 'dj' })
  assert.equal((await getUser(b.db, b.uid))?.accountType, 'dj')
  const base = { uid: c.uid, email: c.email, plan: { tier: 'free', source: 'default' }, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
  assert.ok(await denied(setDoc(doc(c.db, 'users', c.uid), { ...base, accountType: 'admin' })))
  assert.ok(await denied(setDoc(doc(c.db, 'users', c.uid), { ...base, accountType: 'Sposi' })))
})

test('R2. accountType is immutable from the client (couple cannot become dj, dj cannot become couple)', async () => {
  const a = await mk(), b = await mk()
  await createUser(a.db, { uid: a.uid, email: a.email, accountType: 'couple' })
  await createUser(b.db, { uid: b.uid, email: b.email, accountType: 'dj' })
  assert.ok(await denied(updateDoc(doc(a.db, 'users', a.uid), { accountType: 'dj', updatedAt: serverTimestamp() })))
  assert.ok(await denied(updateDoc(doc(b.db, 'users', b.uid), { accountType: 'couple', updatedAt: serverTimestamp() })))
  assert.equal((await getUser(a.db, a.uid))?.accountType, 'couple')
  // a legacy doc (no field) cannot self-assign a role afterwards either
  const l = await mk(); await createUser(l.db, { uid: l.uid, email: l.email })
  assert.equal((await getUser(l.db, l.uid))?.accountType, undefined)
  assert.ok(await denied(updateDoc(doc(l.db, 'users', l.uid), { accountType: 'couple', updatedAt: serverTimestamp() })))
})

// ── event creation ──────────────────────────────────────────────────────────
test('R3. couple creates ONLY wedding events; party / standard are refused server-side', async () => {
  const couple = await account('couple')
  assert.equal(await fails(create(couple, { type: 'party' })), 'permission-denied:wedding_only')
  assert.equal(await fails(create(couple, { type: 'standard' })), 'permission-denied:wedding_only')
  assert.equal(await fails(create(couple, { type: undefined })), 'permission-denied:wedding_only')
  const w = await create(couple, { type: 'wedding', coupleNames: 'Anna & Marco' })
  const e = (await getDoc(doc(couple.db, 'events', w.eventId))).data()!
  assert.deepEqual([e.type, e.ownerUid], ['wedding', couple.uid])
})

test('R4. DJ (explicit) and legacy account without accountType keep creating wedding AND party', async () => {
  for (const type of ['dj', undefined] as const) {
    const dj = await account(type)
    await create(dj, { type: 'wedding' }); await create(dj, { type: 'party' })
  }
  // a legacy account with NO users document at all is also treated as DJ (the plan gate then decides, not the role)
  const bare = await mk()
  assert.equal(await fails(create(bare, { type: 'party' })), 'permission-denied:event_access_required')
})

// ── DJ-only callables ───────────────────────────────────────────────────────
test('R5. couple is refused by every DJ live-control callable; the DJ owner passes', async () => {
  const couple = await account('couple'); const w = await create(couple)
  const E = w.eventId
  const deny = 'permission-denied:dj_account_required'
  assert.equal(await fails(callAs(couple, 'moderateRequest', { eventId: E, requestId: 'r1', action: 'delete' })), deny)
  assert.equal(await fails(callAs(couple, 'moderateDedication', { eventId: E, dedicationId: 'd1', action: 'delete' })), deny)
  assert.equal(await fails(callAs(couple, 'createPoll', { eventId: E, question: 'Q?', options: ['A', 'B'] })), deny)
  assert.equal(await fails(callAs(couple, 'setPollStatus', { eventId: E, pollId: 'p1', open: false })), deny)
  assert.equal(await fails(callAs(couple, 'ownerGameAction', { eventId: E, game: 'roulette', action: 'start' })), deny)
  assert.equal(await fails(callAs(couple, 'setGameConfig', { eventId: E, roulettePenitenze: null })), deny)

  const dj = await account('dj'); const d = await create(dj)
  const poll = await callAs(dj, 'createPoll', { eventId: d.eventId, question: 'Q?', options: ['A', 'B'] })
  assert.ok(poll)
  await callAs(dj, 'ownerGameAction', { eventId: d.eventId, game: 'roulette', action: 'start' })
  const legacy = await account(undefined); const l = await create(legacy)
  await callAs(legacy, 'createPoll', { eventId: l.eventId, question: 'Q?', options: ['A', 'B'] })
})

test('R6. couple cannot write Screen Mode / winner config, but can edit its event details, guest visibility and lifecycle', async () => {
  const couple = await account('couple'); const w = await create(couple); const E = w.eventId
  const deny = 'permission-denied:dj_account_required'
  assert.equal(await fails(callAs(couple, 'updateEventConfig', { eventId: E, screenConfig: { show_photos: true } })), deny)
  assert.equal(await fails(callAs(couple, 'updateEventConfig', { eventId: E, screenModeEnabled: true })), deny)
  assert.equal(await fails(callAs(couple, 'updateEventConfig', { eventId: E, winnerAnnouncement: null })), deny)
  await callAs(couple, 'updateEventConfig', { eventId: E, eventFields: { title: 'Nostro matrimonio', coupleNames: 'A & B' } })
  await callAs(couple, 'updateEventConfig', { eventId: E, guestConfig: { live_booth: true } })
  const e = (await getDoc(doc(couple.db, 'events', E))).data()!
  assert.deepEqual([e.title, e.coupleNames, e.guestConfig, e.screenConfig], ['Nostro matrimonio', 'A & B', { live_booth: true }, null])
  assert.deepEqual(await callAs(couple, 'deleteEvent', { eventId: E }), { deleted: true })

  const dj = await account('dj'); const d = await create(dj)
  await callAs(dj, 'updateEventConfig', { eventId: d.eventId, screenConfig: { show_photos: true }, screenModeEnabled: true })
})

// ── Firestore rules on DJ-only subcollections ───────────────────────────────
test('R7. rules: couple owner cannot read requests / dedications / private config; DJ and legacy owners can; approved dedications stay public', async () => {
  const couple = await account('couple'), dj = await account('dj'), legacy = await account(undefined), guest = await mk('anonymous')
  const evs: Array<[TestClient, string]> = []
  for (const c of [couple, dj, legacy]) {
    const e = await create(c); evs.push([c, e.eventId])
    await seedSet(`events/${e.eventId}/requests/r1`, { guestUid: guest.uid, songTitle: 'S', status: 'pending' })
    await seedSet(`events/${e.eventId}/dedications/d1`, { senderName: 'X', message: 'M', status: 'pending' })
    await seedSet(`events/${e.eventId}/dedications/d2`, { senderName: 'X', message: 'M', status: 'approved' })
    await seedSet(`events/${e.eventId}/private/gameConfig`, { roulettePenitenze: [] })
  }
  const [[, cE], [, dE], [, lE]] = evs
  assert.ok(await denied(getDocs(collection(couple.db, 'events', cE, 'requests'))))
  assert.ok(await denied(getDoc(doc(couple.db, 'events', cE, 'private', 'gameConfig'))))
  assert.ok(await denied(getDocs(collection(couple.db, 'events', cE, 'dedications'))), 'unfiltered list would include pending')
  for (const [c, id] of [[dj, dE], [legacy, lE]] as Array<[TestClient, string]>) {
    assert.equal((await getDocs(collection(c.db, 'events', id, 'requests'))).size, 1)
    assert.equal((await getDocs(collection(c.db, 'events', id, 'dedications'))).size, 2)
    assert.ok((await getDoc(doc(c.db, 'events', id, 'private', 'gameConfig'))).exists())
  }
  // the couple still sees the approved wall like any signed-in guest (this is guest-facing content)
  assert.equal((await getDocs(query(collection(couple.db, 'events', cE, 'dedications'), where('status', '==', 'approved')))).size, 1)
  // the guest (anonymous) keeps reading only their own requests: unchanged
  assert.equal((await getDocs(query(collection(guest.db, 'events', dE, 'requests'), where('guestUid', '==', guest.uid)))).size, 1)
})
