// Cloud test harness for the guest callables on iomixo-494817, run with LEGACY_BRIDGE=mock (no Supabase involved).
//   node scripts/cloud-check.mjs request|dedication|poll|cleanup
// Test data only: events `firebase-test-*` with testData:true, real anonymous Auth guests. `cleanup` removes everything
// recursively, deletes the anonymous users it created and verifies 0 leftovers + the owner doc untouched.
// Uses ADC for Firestore/Auth admin and the PUBLIC web api key (read from frontend/.env.production.local, never printed).
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

const PROJECT = 'iomixo-494817'
const OWNER_UID = 'z5EDSZrgFDXMjCrRCB4cMEidoaL2'
const PREFIX = 'firebase-test-'
const STATE = process.env.CHECK_STATE ?? new URL('./.cloud-check-state.json', import.meta.url).pathname
const ENV = new URL('../../../mashfusion-ai/frontend/.env.production.local', import.meta.url).pathname
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== PROJECT) throw new Error('wrong project')
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('emulator env set: refusing')

initializeApp({ projectId: PROJECT })
const db = getFirestore(), auth = getAuth()
const apiKey = readFileSync(ENV, 'utf8').match(/^NEXT_PUBLIC_FIREBASE_API_KEY=(.+)$/m)[1].trim()
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { events: [], users: [] }
const save = () => writeFileSync(STATE, JSON.stringify(state))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }

async function guest() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  })
  const j = await r.json(); assert.ok(j.idToken, 'anonymous signUp failed')
  state.users.push(j.localId); save()
  return { uid: j.localId, token: j.idToken }
}
/** Raw callable protocol. Returns {ok, result} or {ok:false, status, reason}. */
async function call(fn, token, data) {
  const r = await fetch(`https://europe-west1-${PROJECT}.cloudfunctions.net/${fn}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data }),
  })
  const j = await r.json().catch(() => ({}))
  if (j.result) return { ok: true, result: j.result }
  return { ok: false, status: j.error?.status ?? `HTTP_${r.status}`, reason: j.error?.details?.reason }
}
let seq = 0
async function seedEvent(over = {}) {
  const id = `${PREFIX}${Date.now().toString(36)}-${seq++}`
  await db.doc(`events/${id}`).set({
    ownerUid: OWNER_UID, slug: id, legacySupabaseId: `mock-session-${id}`, title: 'TEST EVENT', djName: 'test', description: null,
    type: 'wedding', status: 'live', screenModeEnabled: false, guestConfig: { requests: true }, requestLimit: 30,
    dedicationsEnabled: true, testData: true, createdAt: new Date(), updatedAt: new Date(), ...over,
  })
  state.events.push(id); save()
  return id
}
const rejected = (r, status, reason) => !r.ok && r.status === status && (reason === undefined || r.reason === reason)

async function phaseRequest() {
  const E = await seedEvent(), E2 = await seedEvent({ requestLimit: 2 }), Eend = await seedEvent({ status: 'ended' })
  const Eoff = await seedEvent({ guestConfig: { requests: false } })
  const g1 = await guest()
  const p = { eventId: E, songTitle: 'Test Song', artist: 'Test Artist', message: 'hi' }
  check('no auth token → UNAUTHENTICATED', rejected(await call('createMusicRequest', null, p), 'UNAUTHENTICATED'))
  const r1 = await call('createMusicRequest', g1.token, p)
  check('anonymous guest, valid payload, live event → request created', r1.ok && !!r1.result.requestId, r1.ok ? `projected=${r1.result.projected}` : r1.status)
  const d1 = (await db.doc(`events/${E}/requests/${r1.result?.requestId ?? 'x'}`).get()).data()
  check('request doc: guestUid = token uid, status pending, mock legacy id, testData untouched', d1?.guestUid === g1.uid && d1.status === 'pending' && /^mock-/.test(d1.legacySupabaseId ?? ''))
  check('counter state/requests.total = 1 and requestGuests count = 1',
    (await db.doc(`events/${E}/state/requests`).get()).data()?.total === 1 && (await db.doc(`events/${E}/requestGuests/${g1.uid}`).get()).data()?.count === 1)
  check('cooldown: same guest again → RESOURCE_EXHAUSTED/cooldown', rejected(await call('createMusicRequest', g1.token, p), 'RESOURCE_EXHAUSTED', 'cooldown'))

  const g2 = await guest()
  const r2 = await call('createMusicRequest', g2.token, { ...p, guestUid: 'EVIL', status: 'approved', ownerUid: 'EVIL', createdAt: '2000-01-01', legacySupabaseId: 'EVIL' })
  const d2 = (await db.doc(`events/${E}/requests/${r2.result?.requestId ?? 'x'}`).get()).data()
  check('spoofed guestUid/status/ownerUid/createdAt/legacySupabaseId ignored', r2.ok && d2.guestUid === g2.uid && d2.status === 'pending' && /^mock-/.test(d2.legacySupabaseId) && d2.createdAt.toMillis() > Date.now() - 120000)

  const g3 = await guest()
  await db.doc(`events/${E}/requestGuests/${g3.uid}`).set({ count: 10, lastAt: Timestamp.fromMillis(Date.now() - 3600_000) })
  check('guest limit (10) → RESOURCE_EXHAUSTED/guest_limit', rejected(await call('createMusicRequest', g3.token, p), 'RESOURCE_EXHAUSTED', 'guest_limit'))

  const [g4, g5, g6] = [await guest(), await guest(), await guest()]
  const q = { ...p, eventId: E2 }
  const a = await call('createMusicRequest', g4.token, q), b = await call('createMusicRequest', g5.token, q)
  check('event limit 2: first two guests accepted', a.ok && b.ok)
  check('event limit 2: third guest → RESOURCE_EXHAUSTED/event_limit', rejected(await call('createMusicRequest', g6.token, q), 'RESOURCE_EXHAUSTED', 'event_limit'))

  const g7 = await guest()
  const burst = await Promise.all(Array.from({ length: 5 }, () => call('createMusicRequest', g7.token, p)))
  const okN = burst.filter((x) => x.ok).length
  const g7doc = (await db.doc(`events/${E}/requestGuests/${g7.uid}`).get()).data()
  check('transaction/concurrency: 5 parallel calls by one guest → exactly 1 accepted, 4 cooldown', okN === 1 && burst.filter((x) => rejected(x, 'RESOURCE_EXHAUSTED', 'cooldown')).length === 4 && g7doc.count === 1)
  const total = (await db.doc(`events/${E}/state/requests`).get()).data().total
  const nDocs = (await db.collection(`events/${E}/requests`).get()).size
  check('counter consistent with documents', total === nDocs, `total=${total} docs=${nDocs}`)

  check('ended event → FAILED_PRECONDITION/event_ended', rejected(await call('createMusicRequest', g1.token, { ...p, eventId: Eend }), 'FAILED_PRECONDITION', 'event_ended'))
  check('missing event → NOT_FOUND/event_not_found', rejected(await call('createMusicRequest', g1.token, { ...p, eventId: PREFIX + 'nope' }), 'NOT_FOUND', 'event_not_found'))
  check('requests disabled on wedding event → requests_disabled', rejected(await call('createMusicRequest', g1.token, { ...p, eventId: Eoff }), 'FAILED_PRECONDITION', 'requests_disabled'))
  check('invalid payload (no songTitle) → INVALID_ARGUMENT', rejected(await call('createMusicRequest', g1.token, { eventId: E }), 'INVALID_ARGUMENT', 'invalid_payload'))
  check('invalid payload (eventId with slash) → INVALID_ARGUMENT', rejected(await call('createMusicRequest', g1.token, { ...p, eventId: 'a/b' }), 'INVALID_ARGUMENT', 'invalid_payload'))
  check('invalid payload (title > 200) → INVALID_ARGUMENT', rejected(await call('createMusicRequest', g1.token, { ...p, songTitle: 'x'.repeat(201) }), 'INVALID_ARGUMENT', 'invalid_payload'))
}

async function phaseDedication() {
  const W = await seedEvent({ type: 'wedding' }), P = await seedEvent({ type: 'party' }), S = await seedEvent({ type: 'standard' })
  const Off = await seedEvent({ type: 'party', dedicationsEnabled: false })
  const g1 = await guest()
  const p = { eventId: W, senderName: 'Test Sender', message: 'Auguri!' }
  check('no auth token → UNAUTHENTICATED', rejected(await call('createDedication', null, p), 'UNAUTHENTICATED'))
  const r1 = await call('createDedication', g1.token, p)
  const d1 = (await db.doc(`events/${W}/dedications/${r1.result?.dedicationId ?? 'x'}`).get()).data()
  check('wedding event, anonymous guest → pending dedication, mock id, no guestUid on the doc', r1.ok && d1?.status === 'pending' && /^mock-/.test(d1.legacySupabaseId) && !('guestUid' in d1))
  check('cooldown (30 s) → RESOURCE_EXHAUSTED/cooldown', rejected(await call('createDedication', g1.token, p), 'RESOURCE_EXHAUSTED', 'cooldown'))
  const g2 = await guest()
  const r2 = await call('createDedication', g2.token, { ...p, eventId: P, status: 'approved', guestUid: 'EVIL', ownerUid: 'EVIL' })
  const d2 = (await db.doc(`events/${P}/dedications/${r2.result?.dedicationId ?? 'x'}`).get()).data()
  check('party event accepted; spoofed status/guestUid/ownerUid ignored', r2.ok && d2.status === 'pending' && !('guestUid' in d2) && !('ownerUid' in d2))
  check('standard event → dedications_unavailable', rejected(await call('createDedication', g1.token, { ...p, eventId: S }), 'FAILED_PRECONDITION', 'dedications_unavailable'))
  check('dedicationsEnabled=false → PERMISSION_DENIED/dedications_unavailable', rejected(await call('createDedication', g1.token, { ...p, eventId: Off }), 'PERMISSION_DENIED', 'dedications_unavailable'))
  const g3 = await guest()
  await db.doc(`events/${W}/dedicationGuests/${g3.uid}`).set({ count: 5, lastAt: Timestamp.fromMillis(Date.now() - 3600_000) })
  check('guest limit (5) → RESOURCE_EXHAUSTED/guest_limit', rejected(await call('createDedication', g3.token, p), 'RESOURCE_EXHAUSTED', 'guest_limit'))
  const g4 = await guest()
  const burst = await Promise.all(Array.from({ length: 5 }, () => call('createDedication', g4.token, p)))
  check('transaction/concurrency: 5 parallel calls by one guest → exactly 1 accepted', burst.filter((x) => x.ok).length === 1 && (await db.doc(`events/${W}/dedicationGuests/${g4.uid}`).get()).data().count === 1)
  check('invalid payload (no message) → INVALID_ARGUMENT', rejected(await call('createDedication', g1.token, { eventId: W }), 'INVALID_ARGUMENT', 'invalid_payload'))
  check('invalid payload (message > 500) → INVALID_ARGUMENT', rejected(await call('createDedication', g1.token, { ...p, message: 'x'.repeat(501) }), 'INVALID_ARGUMENT', 'invalid_payload'))
}

const tally = async (E, P) => {
  const t = [0, 0, 0]
  for (const d of (await db.collection(`events/${E}/polls/${P}/tally`).get()).docs) for (const [k, v] of Object.entries(d.data().counts ?? {})) t[Number(k.slice(1))] += v
  return t
}
async function phasePoll() {
  const E = await seedEvent({ type: 'party' }), pollRef = db.collection(`events/${E}/polls`).doc('poll1')
  await pollRef.set({ question: 'Test?', options: ['A', 'B', 'C'], status: 'open', legacySupabaseId: 'mock-poll-1', testData: true, createdAt: new Date(), updatedAt: new Date() })
  await db.doc(`events/${E}/polls/closed`).set({ question: 'Closed', options: ['A', 'B'], status: 'closed', legacySupabaseId: 'mock-poll-2', testData: true, createdAt: new Date(), updatedAt: new Date() })
  const g1 = await guest(), v = (optionIndex, extra = {}) => ({ eventId: E, pollId: 'poll1', optionIndex, ...extra })
  check('no auth token → UNAUTHENTICATED', rejected(await call('votePoll', null, v(0)), 'UNAUTHENTICATED'))
  const r1 = await call('votePoll', g1.token, v(1, { uid: 'EVIL', guestUid: 'EVIL' }))
  const vote = (await pollRef.collection('votes').doc(g1.uid).get()).data()
  check('valid vote: vote doc keyed by TOKEN uid (spoof ignored), option 1', r1.ok && vote?.optionIndex === 1 && !(await pollRef.collection('votes').doc('EVIL').get()).exists)
  check('tally = [0,1,0]', JSON.stringify(await tally(E, 'poll1')) === '[0,1,0]')
  const r2 = await call('votePoll', g1.token, v(1))
  check('retry same option → idempotent (alreadyVoted), tally unchanged', r2.ok && r2.result.alreadyVoted === true && JSON.stringify(await tally(E, 'poll1')) === '[0,1,0]')
  check('immediate change → cooldown (VOTE_POLICY 1.5 s)', rejected(await call('votePoll', g1.token, v(2)), 'RESOURCE_EXHAUSTED', 'cooldown'))
  await sleep(2000)
  const r3 = await call('votePoll', g1.token, v(2))
  check('change vote after cooldown (allowChange=true) → changed, tally [0,0,1]', r3.ok && r3.result.changed === true && JSON.stringify(await tally(E, 'poll1')) === '[0,0,1]')
  check('option beyond poll options → invalid_option', rejected(await call('votePoll', g1.token, v(3)), 'INVALID_ARGUMENT', 'invalid_option'))
  check('option 9 → invalid_option (payload)', rejected(await call('votePoll', g1.token, v(9)), 'INVALID_ARGUMENT', 'invalid_option'))
  check('closed poll → poll_closed', rejected(await call('votePoll', g1.token, { eventId: E, pollId: 'closed', optionIndex: 0 }), 'FAILED_PRECONDITION', 'poll_closed'))
  check('missing poll → poll_not_found', rejected(await call('votePoll', g1.token, { eventId: E, pollId: 'nope', optionIndex: 0 }), 'NOT_FOUND', 'poll_not_found'))
  const guests = await Promise.all(Array.from({ length: 8 }, () => guest()))
  await Promise.all(guests.map((g) => call('votePoll', g.token, v(0))))
  check('concurrency: 8 distinct guests vote option 0 → tally [8,0,1]', JSON.stringify(await tally(E, 'poll1')) === '[8,0,1]', JSON.stringify(await tally(E, 'poll1')))
  const g9 = await guest()
  const burst = await Promise.all(Array.from({ length: 4 }, () => call('votePoll', g9.token, v(1))))
  check('same guest, 4 parallel votes → one effect (tally [8,1,1])', burst.every((x) => x.ok) && JSON.stringify(await tally(E, 'poll1')) === '[8,1,1]', JSON.stringify(await tally(E, 'poll1')))
  check('total votes docs = 10 (one per guest)', (await pollRef.collection('votes').get()).size === 10)
}

async function cleanup() {
  const ids = new Set(state.events)
  for (const ref of await db.collection('events').listDocuments()) if (ref.id.startsWith(PREFIX)) ids.add(ref.id)
  for (const id of ids) await db.recursiveDelete(db.doc(`events/${id}`))
  for (const uid of state.users) await auth.deleteUser(uid).catch((e) => { if (e.code !== 'auth/user-not-found') throw e })
  state.events = []; state.users = []; save()
  const left = (await db.collection('events').listDocuments()).filter((r) => r.id.startsWith(PREFIX)).length
  const groups = {}
  for (const g of ['requests', 'dedications', 'polls', 'votes', 'tally', 'requestGuests', 'dedicationGuests', 'state', 'private']) groups[g] = (await db.collectionGroup(g).count().get()).data().count
  const anon = (await auth.listUsers(1000)).users.filter((u) => u.providerData.length === 0).length
  const owner = (await db.doc(`users/${OWNER_UID}`).get()).data()
  console.log(JSON.stringify({ testEventsLeft: left, collectionGroupCounts: groups, anonymousAuthUsersLeft: anon, ownerDocIntact: owner?.plan?.tier === 'wedding' && owner?.legacySupabaseId?.length === 36, eventsTotal: (await db.collection('events').listDocuments()).length }))
  check('cleanup: 0 test events, 0 subcollection docs, 0 anonymous users, owner intact',
    left === 0 && Object.values(groups).every((n) => n === 0) && anon === 0 && owner?.plan?.tier === 'wedding')
}

const phase = process.argv[2]
const phases = { request: phaseRequest, dedication: phaseDedication, poll: phasePoll, cleanup }
if (!phases[phase]) { console.error('usage: cloud-check.mjs request|dedication|poll|cleanup'); process.exit(2) }
try { await phases[phase]() } finally { save() }
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
