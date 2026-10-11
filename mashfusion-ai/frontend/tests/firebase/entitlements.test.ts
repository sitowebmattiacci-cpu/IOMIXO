import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { deleteApp } from 'firebase/app'
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, collectionGroup } from 'firebase/firestore'
import { newClient, closeClient, denied, newSignedOutDb, type TestClient } from './helpers'
import { seedSet } from './seed'
import { resolveEntitlements, type EventPassDoc } from '../../../../firebase/functions/src/entitlements/resolve'
import { loadEntitlements, loadEventEntitlements, requireEventAccess, hasEventAccess } from '../../../../firebase/functions/src/entitlements/load'

// Admin SDK from the Functions package (the frontend does not depend on firebase-admin).
const fnReq = createRequire(__dirname + '/../../../../firebase/functions/package.json')
const { initializeApp, getApps } = fnReq('firebase-admin/app')
const { getFirestore, Timestamp } = fnReq('firebase-admin/firestore')
if (!getApps().length) initializeApp({ projectId: 'demo-iomixo' })
const adb = getFirestore()

const clients: TestClient[] = []
after(async () => { await Promise.all(clients.map(closeClient)) })
const mk = async (k: 'account' | 'anonymous' = 'account') => { const c = await newClient(k); clients.push(c); return c }

const NOW = new Date('2026-06-01T12:00:00Z')
const H = 3600_000
const pass = (over: Partial<EventPassDoc> = {}): EventPassDoc => ({ id: 'p1', status: 'active', validUntil: new Date(NOW.getTime() + 6 * H), eventId: null, legacySessionId: null, ...over })
const ev = { id: 'evA', legacySessionId: 'sessA' }

// ───────────── resolveEntitlements (pure) ─────────────
test('free / pro / wedding(+aliases) / absent document', () => {
  const free = resolveEntitlements({ plan: { tier: 'free' }, now: NOW })
  assert.deepEqual([free.accountTier, free.effectiveTier, free.eventAccess], ['free', 'free', false])
  assert.equal(free.limits.maxRequestsPerSession, 30)
  const pro = resolveEntitlements({ plan: { tier: 'pro' }, now: NOW })
  assert.deepEqual([pro.accountTier, pro.effectiveTier, pro.eventAccess, pro.limits.analytics, pro.limits.weddingGames], ['pro', 'pro', false, true, false])
  for (const alias of ['wedding', 'advance', 'club', 'studio', 'pro_plus']) {
    const w = resolveEntitlements({ plan: { tier: alias }, now: NOW })
    assert.deepEqual([w.accountTier, w.effectiveTier, w.eventAccess], ['wedding', 'wedding', true], alias)
  }
  const none = resolveEntitlements({ plan: null, now: NOW })
  assert.deepEqual([none.accountTier, none.eventAccess, none.passId], ['free', false, null])
  assert.equal(resolveEntitlements({ plan: { tier: 'platinum' }, now: NOW }).accountTier, 'free')   // unknown tier never escalates
})

test('Event Pass: valid grants Advance-level access; expired / refunded / status-expired do not; boundary is exclusive', () => {
  const ok = resolveEntitlements({ plan: { tier: 'free' }, passes: [pass()], now: NOW })
  assert.deepEqual([ok.eventAccess, ok.effectiveTier, ok.passId], [true, 'wedding', 'p1'])
  assert.equal(ok.limits.maxRequestsPerSession, Infinity)
  for (const bad of [pass({ validUntil: new Date(NOW.getTime() - 1) }), pass({ validUntil: NOW }), pass({ status: 'refunded' }), pass({ status: 'expired' })]) {
    assert.equal(resolveEntitlements({ plan: { tier: 'free' }, passes: [bad], now: NOW }).eventAccess, false)
  }
  const two = resolveEntitlements({ plan: { tier: 'free' }, passes: [pass({ id: 'a' }), pass({ id: 'b', validUntil: new Date(NOW.getTime() + 20 * H) })], now: NOW })
  assert.deepEqual([two.eventAccess, two.passId], [true, 'b'])   // legacy .maybeSingle() would fail here; two valid passes must still grant access
})

test('Event Pass scope: unscoped = any event; scoped = that event only (by event id or legacy session id); no event → only unscoped', () => {
  const scoped = pass({ legacySessionId: 'sessA' })
  assert.equal(resolveEntitlements({ plan: { tier: 'free' }, passes: [scoped], event: ev, now: NOW }).eventAccess, true)
  assert.equal(resolveEntitlements({ plan: { tier: 'free' }, passes: [scoped], event: { id: 'evB', legacySessionId: 'sessB' }, now: NOW }).eventAccess, false)
  assert.equal(resolveEntitlements({ plan: { tier: 'free' }, passes: [scoped], now: NOW }).eventAccess, false)
  assert.equal(resolveEntitlements({ plan: { tier: 'free' }, passes: [pass({ eventId: 'evA' })], event: ev, now: NOW }).eventAccess, true)
  assert.equal(resolveEntitlements({ plan: { tier: 'free' }, passes: [pass()], event: { id: 'zzz' }, now: NOW }).eventAccess, true)
})

test('plan expiry: wedding with validUntil in the past is free; future / absent validUntil is honoured; a pass still applies', () => {
  const expired = resolveEntitlements({ plan: { tier: 'wedding', validUntil: new Date(NOW.getTime() - H) }, now: NOW })
  assert.deepEqual([expired.planExpired, expired.accountTier, expired.eventAccess], [true, 'free', false])
  assert.equal(resolveEntitlements({ plan: { tier: 'wedding', validUntil: new Date(NOW.getTime() + H) }, now: NOW }).eventAccess, true)
  assert.equal(resolveEntitlements({ plan: { tier: 'wedding', validUntil: null }, now: NOW }).eventAccess, true)
  assert.equal(resolveEntitlements({ plan: { tier: 'wedding', validUntil: new Date(NOW.getTime() - H) }, passes: [pass()], now: NOW }).eventAccess, true)
})

test('legacy quirk kept: PRO + pass → eventAccess true but effective tier stays pro (remote games locked, DJ games open)', () => {
  const r = resolveEntitlements({ plan: { tier: 'pro' }, passes: [pass()], now: NOW })
  assert.deepEqual([r.eventAccess, r.effectiveTier, r.gates.djGames, r.gates.remoteGames], [true, 'pro', true, false])
})

test('gates: games / dedications / polls / photos / screen / request limit per scenario', () => {
  const g = (plan: string, passes: EventPassDoc[] = []) => resolveEntitlements({ plan: { tier: plan }, passes, now: NOW })
  assert.deepEqual(Object.values(g('free').gates), [false, false, false, false, false, false])
  assert.deepEqual(Object.values(g('pro').gates), [false, false, false, false, false, false])
  assert.deepEqual(Object.values(g('wedding').gates), [true, true, true, true, true, true])
  assert.deepEqual(Object.values(g('free', [pass()]).gates), [true, true, true, true, true, true])
  assert.equal(g('free').limits.maxRequestsPerSession, 30); assert.equal(g('free', [pass()]).limits.maxRequestsPerSession, Infinity)
  assert.equal(g('pro').limits.maxRequestsPerSession, Infinity)
})

// ───────────── loaders (Admin SDK on the emulator) ─────────────
let n = 0
const id = (p: string) => `${p}${Date.now()}${n++}`
async function seedAccount(plan: { tier: string; source?: string; validUntil?: Date }, passes: Array<Record<string, unknown>> = [], extra: Record<string, unknown> = {}) {
  const uid = id('eu'), legacy = id('lu')
  await adb.doc(`users/${uid}`).set({ uid, email: `${uid}@example.com`, plan: { source: 'legacy', ...plan, ...(plan.validUntil ? { validUntil: Timestamp.fromDate(plan.validUntil) } : {}) }, legacySupabaseId: legacy, ...extra })
  for (let i = 0; i < passes.length; i++) {
    const { key, ...p } = passes[i]
    await adb.doc(`users/${uid}/eventPasses/${key ?? `k${i}`}`).set({ status: 'active', eventId: null, legacySessionId: null, source: 'legacy', ...p, validUntil: Timestamp.fromDate(p.validUntil as Date) })
  }
  return { uid, legacy }
}
const future = (h: number) => new Date(Date.now() + h * H)

test('loader: by Firebase uid and by legacy user id (transition), unknown account → free', async () => {
  const a = await seedAccount({ tier: 'wedding' })
  assert.equal((await loadEntitlements(adb, { uid: a.uid })).eventAccess, true)
  assert.equal((await loadEntitlements(adb, { legacyUserId: a.legacy })).eventAccess, true)
  assert.equal(await hasEventAccess(adb, { legacyUserId: a.legacy }), true)
  assert.equal((await loadEntitlements(adb, { legacyUserId: 'nobody' })).eventAccess, false)
  assert.equal((await loadEntitlements(adb, { uid: 'ghost-uid' })).accountTier, 'free')
  assert.equal((await loadEntitlements(adb, {})).eventAccess, false)
})

test('loader: pass valid / expired (filtered by the query) / refunded / scoped to the event', async () => {
  const a = await seedAccount({ tier: 'free' }, [
    { key: 'old', validUntil: future(-2) }, { key: 'refunded', status: 'refunded', validUntil: future(5) },
    { key: 'other', legacySessionId: 'other-sess', validUntil: future(5) },
  ])
  assert.equal((await loadEntitlements(adb, { uid: a.uid })).eventAccess, false)
  await adb.doc(`users/${a.uid}/eventPasses/mine`).set({ status: 'active', legacySessionId: 'sess-mine', eventId: null, validUntil: Timestamp.fromDate(future(5)) })
  assert.equal((await loadEntitlements(adb, { uid: a.uid }, { id: 'e', legacySessionId: 'sess-mine' })).eventAccess, true)
  assert.equal((await loadEntitlements(adb, { uid: a.uid }, { id: 'e', legacySessionId: 'sess-x' })).eventAccess, false)
  assert.equal((await loadEntitlements(adb, { uid: a.uid })).eventAccess, false)       // scoped pass without event → not applicable
  await adb.doc(`users/${a.uid}/eventPasses/anyEvent`).set({ status: 'active', legacySessionId: null, eventId: null, validUntil: Timestamp.fromDate(future(1)) })
  assert.equal((await loadEntitlements(adb, { uid: a.uid }, { id: 'zzz' }, new Date(Date.now()))).eventAccess, true)
  assert.equal((await loadEntitlements(adb, { uid: a.uid }, { id: 'zzz' }, new Date(Date.now() + 2 * H))).eventAccess, false)   // same pass, 2h later → expired
})

test('loader: upgrade and downgrade are picked up immediately (no caching)', async () => {
  const a = await seedAccount({ tier: 'free' })
  assert.equal((await loadEntitlements(adb, { uid: a.uid })).effectiveTier, 'free')
  await adb.doc(`users/${a.uid}`).update({ plan: { tier: 'pro', source: 'legacy' } })
  assert.equal((await loadEntitlements(adb, { uid: a.uid })).effectiveTier, 'pro')
  await adb.doc(`users/${a.uid}`).update({ plan: { tier: 'wedding', source: 'legacy' } })
  assert.equal((await loadEntitlements(adb, { uid: a.uid })).eventAccess, true)
  await adb.doc(`users/${a.uid}`).update({ plan: { tier: 'free', source: 'legacy' } })
  assert.equal((await loadEntitlements(adb, { uid: a.uid })).eventAccess, false)
})

test('event guard: owner entitlements for THAT event; closed access → typed error; missing event → not-found', async () => {
  const dj = await seedAccount({ tier: 'free' })
  const evId = id('gev')
  await adb.doc(`events/${evId}`).set({ ownerUid: dj.uid, legacySupabaseId: 'sess-guard', status: 'live', slug: evId })
  await assert.rejects(requireEventAccess(adb, evId), (e: any) => e.code === 'permission-denied' && e.details?.reason === 'event_access_required')
  await adb.doc(`users/${dj.uid}/eventPasses/p`).set({ status: 'active', legacySessionId: 'sess-guard', eventId: null, validUntil: Timestamp.fromDate(future(3)) })
  const ent = await requireEventAccess(adb, evId)
  assert.deepEqual([ent.eventAccess, ent.ownerUid, ent.effectiveTier, ent.gates.dedications, ent.gates.polls, ent.gates.djGames], [true, dj.uid, 'wedding', true, true, true])
  await adb.doc(`users/${dj.uid}/eventPasses/p`).update({ legacySessionId: 'another-session' })
  assert.equal((await loadEventEntitlements(adb, evId)).eventAccess, false)
  await assert.rejects(loadEventEntitlements(adb, 'no-such-event'), (e: any) => e.code === 'not-found' && e.details?.reason === 'event_not_found')
})

// ───────────── rules (client SDK) ─────────────
test('rules: owner reads own plan and passes; other accounts / guests / signed-out cannot read the passes', async () => {
  const owner = await mk('account'), other = await mk('account'), guest = await mk('anonymous')
  await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`users/${owner.uid}/eventPasses/pi_1`, { status: 'active', validUntil: new Date(Date.now() + H), source: 'legacy', createdAt: new Date() })
  assert.equal((await getDoc(doc(owner.db, 'users', owner.uid))).data()?.plan.tier, 'wedding')
  assert.equal((await getDoc(doc(owner.db, 'users', owner.uid, 'eventPasses', 'pi_1'))).exists(), true)
  assert.equal((await getDocs(collection(owner.db, 'users', owner.uid, 'eventPasses'))).size, 1)
  for (const c of [other, guest]) {
    assert.ok(await denied(getDoc(doc(c.db, 'users', owner.uid, 'eventPasses', 'pi_1'))))
    assert.ok(await denied(getDocs(collection(c.db, 'users', owner.uid, 'eventPasses'))))
    assert.ok(await denied(getDoc(doc(c.db, 'users', owner.uid))))
  }
  const { app, db } = newSignedOutDb()
  assert.ok(await denied(getDocs(collection(db, 'users', owner.uid, 'eventPasses')))); await deleteApp(app)
  for (const c of [owner, other, guest]) assert.ok(await denied(getDocs(collectionGroup(c.db, 'eventPasses'))))
})

test('rules: spoofing is denied — plan, validUntil, source, legacy id, passes (create / update / delete), self-assigned wedding', async () => {
  const me = await mk('account')
  await seedSet(`users/${me.uid}`, { uid: me.uid, email: me.email, plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`users/${me.uid}/eventPasses/pi_2`, { status: 'refunded', validUntil: new Date(Date.now() - H), source: 'legacy', createdAt: new Date() })
  const u = doc(me.db, 'users', me.uid)
  for (const patch of [{ plan: { tier: 'wedding', source: 'legacy' } }, { 'plan.tier': 'wedding' }, { 'plan.validUntil': new Date(Date.now() + 99 * H) }, { 'plan.source': 'stripe' },
                       { legacySupabaseId: 'victim' }, { planSourceUpdatedAt: new Date() }, { email: 'x@y.z' }]) {
    assert.ok(await denied(updateDoc(u, patch as any)), JSON.stringify(patch))
  }
  assert.ok(await denied(setDoc(u, { uid: me.uid, email: me.email, plan: { tier: 'wedding', source: 'legacy' }, createdAt: new Date(), updatedAt: new Date() })))
  assert.ok(await denied(addDoc(collection(me.db, 'users', me.uid, 'eventPasses'), { status: 'active', validUntil: new Date(Date.now() + 99 * H) })))
  assert.ok(await denied(setDoc(doc(me.db, 'users', me.uid, 'eventPasses', 'mine'), { status: 'active', validUntil: new Date(Date.now() + 99 * H) })))
  assert.ok(await denied(updateDoc(doc(me.db, 'users', me.uid, 'eventPasses', 'pi_2'), { status: 'active', validUntil: new Date(Date.now() + 99 * H) })))
  assert.ok(await denied(deleteDoc(doc(me.db, 'users', me.uid, 'eventPasses', 'pi_2'))))
  const after = (await getDoc(u)).data()!
  assert.deepEqual(after.plan, { tier: 'free', source: 'default' })
  assert.equal((await getDoc(doc(me.db, 'users', me.uid, 'eventPasses', 'pi_2'))).data()?.status, 'refunded')
  // …and the server-side verdict for that account is still "no access"
  assert.equal((await loadEntitlements(adb, { uid: me.uid })).eventAccess, false)
})
