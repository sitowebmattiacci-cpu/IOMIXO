import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { newClient, closeClient, newSignedOutDb, type TestClient } from './helpers'
import { seedSet, eventFields } from './seed'
import { startFakeSupabase, type FakeSupabase } from './fakeSupabase'

/**
 * createMusicRequest / createDedication decide premium access from Firestore entitlements (owner plan + Event Passes) when those exist,
 * and from the legacy-projected event fields otherwise (entitlements/source.ts). votePoll has NO entitlement gate (legacy semantics).
 * Emulator: Auth + Firestore + Functions.
 */
let fake: FakeSupabase
const clients: TestClient[] = []
before(async () => { fake = await startFakeSupabase() })
after(async () => { await Promise.all(clients.map(closeClient)); await fake.close() })
const mk = async (k: 'account' | 'anonymous' = 'anonymous') => { const c = await newClient(k); clients.push(c); return c }

const H = 3600_000
let n = 0
const id = (p: string) => `${p}${Date.now()}${n++}`
type PlanSource = 'legacy' | 'stripe' | 'default' | null   // null = no users document at all

/** Owner (DJ) account + optional plan document, as the server (projection / Stripe) would have written it. */
async function owner(tier: string, source: PlanSource = 'legacy', passes: Array<Record<string, unknown>> = []) {
  const dj = await mk('account')
  if (source) await seedSet(`users/${dj.uid}`, { uid: dj.uid, email: dj.email, plan: { tier, source }, createdAt: new Date(), updatedAt: new Date() })
  for (let i = 0; i < passes.length; i++) { const p = passes[i]; await seedSet(`users/${dj.uid}/eventPasses/p${i}`, { status: 'active', source: 'legacy', legacySessionId: null, eventId: null, validUntil: new Date(Date.now() + 3 * H), createdAt: new Date(), ...p }) }
  return dj
}
async function event(ownerUid: string, type: 'standard' | 'party' | 'wedding', extra: Record<string, unknown> = {}) {
  const e = id('egev'), sess = `esess-${e}`
  await seedSet(`events/${e}`, eventFields(ownerUid, `s${e}`, { type, legacySupabaseId: sess, ...extra }))
  return { id: e, sess }
}
async function withPoll(eventId: string, status = 'open') {
  const pollId = id('poll')
  await seedSet(`events/${eventId}/polls/${pollId}`, { question: 'Q?', options: ['A', 'B', 'C'], status, legacySupabaseId: `lp-${pollId}`, createdAt: new Date(), updatedAt: new Date() })
  return pollId
}
const fnOf = (c: { app: any }) => { const f = getFunctions(c.app, 'europe-west1'); connectFunctionsEmulator(f, '127.0.0.1', 5001); return f }
const callAs = (c: { app: any }, name: string, data: unknown) => httpsCallable<any, any>(fnOf(c), name)(data as any)
async function outcome(p: Promise<unknown>) { try { await p; return 'ok' } catch (e: any) { return `${String(e.code).replace('functions/', '')}:${e.details?.reason}` } }

const request = (g: TestClient, eventId: string, extra: Record<string, unknown> = {}) => outcome(callAs(g, 'createMusicRequest', { eventId, songTitle: 'Song', ...extra }))
const dedicate = (g: TestClient, eventId: string, extra: Record<string, unknown> = {}) => outcome(callAs(g, 'createDedication', { eventId, senderName: 'Zia', message: 'Auguri', ...extra }))
const vote = (g: TestClient, eventId: string, pollId: string, extra: Record<string, unknown> = {}) => outcome(callAs(g, 'votePoll', { eventId, pollId, optionIndex: 1, ...extra }))
/** event-wide request counter, to sit exactly at / below a limit without sending dozens of requests */
const counter = (eventId: string, total: number) => seedSet(`events/${eventId}/state/requests`, { total, updatedAt: new Date() })

// ───────────── createMusicRequest ─────────────
test('REQUEST · FREE owner (server plan) → limit 30 from the resolver, even if the legacy field says unlimited', async () => {
  const dj = await owner('free'); const g1 = await mk(), g2 = await mk()
  const e = await event(dj.uid, 'party', { requestLimit: null })           // legacy field would allow everything
  await counter(e.id, 29); assert.equal(await request(g1, e.id), 'ok')      // 30th request fits
  assert.equal(await request(g2, e.id), 'resource-exhausted:event_limit')   // 31st does not
})

test('REQUEST · PRO / WEDDING owners → unlimited (legacy PLAN_LIMITS), even if the legacy field says 30', async () => {
  for (const tier of ['pro', 'wedding', 'advance']) {
    const dj = await owner(tier); const g = await mk(); const e = await event(dj.uid, 'party', { requestLimit: 30 })
    await counter(e.id, 500); assert.equal(await request(g, e.id), 'ok', tier)
  }
})

test('REQUEST · EVENT PASS: valid / expired / refunded / scoped to this event / scoped to another event', async () => {
  const cases: Array<[string, Array<Record<string, unknown>>, (sess: string) => Array<Record<string, unknown>>, string]> = [
    ['valid unscoped', [{}], () => [{}], 'ok'],
    ['expired', [], () => [{ validUntil: new Date(Date.now() - H) }], 'resource-exhausted:event_limit'],
    ['refunded', [], () => [{ status: 'refunded' }], 'resource-exhausted:event_limit'],
    ['scoped to THIS event', [], (s) => [{ legacySessionId: s }], 'ok'],
    ['scoped to ANOTHER event', [], () => [{ legacySessionId: 'someone-elses-session' }], 'resource-exhausted:event_limit'],
  ]
  for (const [label, , mkPasses, expected] of cases) {
    const dj = await owner('free'); const g = await mk(); const e = await event(dj.uid, 'party')
    const ps = mkPasses(e.sess); for (let i = 0; i < ps.length; i++) await seedSet(`users/${dj.uid}/eventPasses/q${i}`, { status: 'active', source: 'legacy', legacySessionId: null, eventId: null, validUntil: new Date(Date.now() + 3 * H), createdAt: new Date(), ...ps[i] })
    await counter(e.id, 30); assert.equal(await request(g, e.id), expected, label)
  }
})

test('REQUEST · fallback: owner without a server plan keeps the legacy projected limit (no regression)', async () => {
  for (const source of [null, 'default'] as PlanSource[]) {
    const dj = await owner('free', source)
    const g1 = await mk(), g2 = await mk(), g3 = await mk()
    const capped = await event(dj.uid, 'party', { requestLimit: 2 }); await counter(capped.id, 1)
    assert.equal(await request(g1, capped.id), 'ok'); assert.equal(await request(g2, capped.id), 'resource-exhausted:event_limit')
    const unlimited = await event(dj.uid, 'party', { requestLimit: null }); await counter(unlimited.id, 999)   // paid DJ in legacy, projection not run yet
    assert.equal(await request(g3, unlimited.id), 'ok')
    const old = await event(dj.uid, 'party', { requestLimit: undefined })                                    // projected before the field existed
    assert.equal(await request(await mk(), old.id), 'failed-precondition:event_not_ready')
  }
})

// ───────────── createDedication ─────────────
test('DEDICATION · FREE / PRO owner → denied; WEDDING / Advance → allowed (Firestore is final, dedicationsEnabled ignored)', async () => {
  for (const [tier, expected] of [['free', 'permission-denied:dedications_unavailable'], ['pro', 'permission-denied:dedications_unavailable'], ['wedding', 'ok'], ['advance', 'ok']] as const) {
    const dj = await owner(tier); const g = await mk()
    const wrongForAllowed = await event(dj.uid, 'party', { dedicationsEnabled: expected !== 'ok' })     // legacy field deliberately contradicts the plan
    assert.equal(await dedicate(g, wrongForAllowed.id), expected, tier)
  }
})

test('DEDICATION · EVENT PASS: valid / expired / refunded / this event / another event; standard sessions never', async () => {
  const run = async (passes: (s: string) => Array<Record<string, unknown>>, expected: string, type: 'party' | 'wedding' | 'standard' = 'wedding') => {
    const dj = await owner('free'); const e = await event(dj.uid, type)
    const ps = passes(e.sess); for (let i = 0; i < ps.length; i++) await seedSet(`users/${dj.uid}/eventPasses/d${i}`, { status: 'active', source: 'legacy', legacySessionId: null, eventId: null, validUntil: new Date(Date.now() + 3 * H), createdAt: new Date(), ...ps[i] })
    return assert.equal(await dedicate(await mk(), e.id), expected)
  }
  await run(() => [{}], 'ok')
  await run((s) => [{ legacySessionId: s }], 'ok')
  await run(() => [{ validUntil: new Date(Date.now() - H) }], 'permission-denied:dedications_unavailable')
  await run(() => [{ status: 'refunded' }], 'permission-denied:dedications_unavailable')
  await run(() => [{ legacySessionId: 'other' }], 'permission-denied:dedications_unavailable')
  await run(() => [], 'permission-denied:dedications_unavailable')
  await run(() => [{}], 'failed-precondition:dedications_unavailable', 'standard')
})

test('DEDICATION · fallback: owner without a server plan → legacy dedicationsEnabled decides (true allowed, false denied, missing not ready)', async () => {
  for (const source of [null, 'default'] as PlanSource[]) {
    const dj = await owner('free', source)
    assert.equal(await dedicate(await mk(), (await event(dj.uid, 'party', { dedicationsEnabled: true })).id), 'ok')
    assert.equal(await dedicate(await mk(), (await event(dj.uid, 'party', { dedicationsEnabled: false })).id), 'permission-denied:dedications_unavailable')
    assert.equal(await dedicate(await mk(), (await event(dj.uid, 'party', { dedicationsEnabled: undefined })).id), 'failed-precondition:event_not_ready')
  }
})

test('DEDICATION · cooldown and guest limit are unchanged under Firestore entitlements', async () => {
  const dj = await owner('wedding'); const g = await mk(); const e = await event(dj.uid, 'wedding')
  assert.equal(await dedicate(g, e.id), 'ok')
  assert.equal(await dedicate(g, e.id), 'resource-exhausted:cooldown')
})

// ───────────── votePoll ─────────────
// Legacy semantics: the premium gate is on creating / opening / managing a poll (DJ side). The guest vote only needs a live event and an open poll.
test('POLL · a guest can vote on an open poll whatever the owner entitlement is (free, pro, no pass, expired / refunded pass, no plan document)', async () => {
  const scenarios: Array<[string, string, PlanSource, Array<Record<string, unknown>>]> = [
    ['free, no pass', 'free', 'legacy', []], ['pro', 'pro', 'legacy', []], ['wedding', 'wedding', 'legacy', []],
    ['free, valid pass', 'free', 'legacy', [{}]],
    ['free, pass EXPIRED after the poll was opened', 'free', 'legacy', [{ validUntil: new Date(Date.now() - H) }]],
    ['free, pass refunded', 'free', 'legacy', [{ status: 'refunded' }]],
    ['stripe-sourced free plan', 'free', 'stripe', []],
    ['fallback: default plan source', 'free', 'default', []], ['fallback: no plan document', 'free', null, []],
  ]
  for (const [label, tier, source, passes] of scenarios) {
    const dj = await owner(tier, source, passes); const e = await event(dj.uid, 'party'); const p = await withPoll(e.id)
    assert.equal(await vote(await mk(), e.id, p), 'ok', label)
  }
})

test('POLL · pass valid when the poll is opened, expired afterwards → the open poll keeps accepting votes; closing it stops them', async () => {
  const dj = await owner('free', 'legacy', [{}]); const e = await event(dj.uid, 'party'); const p = await withPoll(e.id)
  assert.equal(await vote(await mk(), e.id, p), 'ok')
  await seedSet(`users/${dj.uid}/eventPasses/p0`, { status: 'active', source: 'legacy', legacySessionId: null, eventId: null, validUntil: new Date(Date.now() - 60_000), createdAt: new Date() })   // the pass expires mid-poll
  assert.equal(await vote(await mk(), e.id, p), 'ok')
  await seedSet(`events/${e.id}/polls/${p}`, { question: 'Q?', options: ['A', 'B', 'C'], status: 'closed', legacySupabaseId: `lp-${p}`, createdAt: new Date(), updatedAt: new Date() })
  assert.equal(await vote(await mk(), e.id, p), 'failed-precondition:poll_closed')
})

test('POLL · closed / missing poll, invalid option and missing event are rejected; state, idempotency and tally unchanged', async () => {
  const dj = await owner('free'); const e = await event(dj.uid, 'party'); const g = await mk()
  assert.equal(await vote(g, e.id, await withPoll(e.id, 'closed')), 'failed-precondition:poll_closed')
  assert.equal(await vote(g, e.id, 'no-such-poll'), 'not-found:poll_not_found')
  const p = await withPoll(e.id)
  assert.equal(await outcome(callAs(g, 'votePoll', { eventId: e.id, pollId: p, optionIndex: 3 })), 'invalid-argument:invalid_option')
  assert.equal(await outcome(callAs(g, 'votePoll', { eventId: e.id, pollId: p, optionIndex: -1 })), 'invalid-argument:invalid_option')
  assert.equal(await vote(g, 'no-such-event', p), 'not-found:event_not_found')
  assert.equal(await vote(g, e.id, p), 'ok')
  assert.equal((await callAs(g, 'votePoll', { eventId: e.id, pollId: p, optionIndex: 1 })).data.alreadyVoted, true)
})

// ───────────── security ─────────────
test('SECURITY · plan / pass / ownerUid / limits sent in the payload are ignored', async () => {
  const dj = await owner('free'); const g = await mk()
  const spoof = { plan: 'wedding', tier: 'wedding', eventPass: true, entitlements: { eventAccess: true }, ownerUid: dj.uid, requestLimit: null, dedicationsEnabled: true, eventAccess: true, validUntil: '2099-01-01' }
  const e = await event(dj.uid, 'party', { dedicationsEnabled: true, requestLimit: null })
  assert.equal(await dedicate(g, e.id, spoof), 'permission-denied:dedications_unavailable')
  await counter(e.id, 30); assert.equal(await request(await mk(), e.id, spoof), 'resource-exhausted:event_limit')
  assert.equal(await vote(await mk(), e.id, await withPoll(e.id), spoof), 'ok')      // votes never depend on entitlements; spoofed fields are simply ignored
  // another account's wedding plan does not help: entitlements always come from the EVENT'S owner
  const rich = await owner('wedding')
  const mine = await event(dj.uid, 'party'); assert.equal(await dedicate(await mk(), mine.id, { ownerUid: rich.uid }), 'permission-denied:dedications_unavailable')
})

test('SECURITY · authentication is required on all three callables', async () => {
  const dj = await owner('wedding'); const e = await event(dj.uid, 'party'); const p = await withPoll(e.id)
  const { app } = newSignedOutDb()
  assert.equal(await outcome(callAs({ app }, 'createMusicRequest', { eventId: e.id, songTitle: 'x' })), 'unauthenticated:unauthenticated')
  assert.equal(await outcome(callAs({ app }, 'createDedication', { eventId: e.id, senderName: 'z', message: 'm' })), 'unauthenticated:unauthenticated')
  assert.equal(await outcome(callAs({ app }, 'votePoll', { eventId: e.id, pollId: p, optionIndex: 0 })), 'unauthenticated:unauthenticated')
})

test('TRANSITION · upgrade and downgrade of the owner are effective on the very next call', async () => {
  const dj = await owner('free'); const e = await event(dj.uid, 'party')
  assert.equal(await dedicate(await mk(), e.id), 'permission-denied:dedications_unavailable')
  await seedSet(`users/${dj.uid}`, { uid: dj.uid, email: dj.email, plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  assert.equal(await dedicate(await mk(), e.id), 'ok')
  await seedSet(`users/${dj.uid}`, { uid: dj.uid, email: dj.email, plan: { tier: 'free', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  assert.equal(await dedicate(await mk(), e.id), 'permission-denied:dedications_unavailable')
})
