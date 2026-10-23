import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { doc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { newClient, closeClient, denied, type TestClient } from './helpers'
import { seedSet, eventFields } from './seed'
import { buildPriceTable, type PriceInfo } from '../../../../firebase/functions/src/billing/prices'
import { createCheckoutSession, type AuthLike } from '../../../../firebase/functions/src/billing/checkout'
import { handleStripeWebhook } from '../../../../firebase/functions/src/billing/webhook'
import { loadEntitlements, loadEventEntitlements } from '../../../../firebase/functions/src/entitlements/load'
import { createEvent, parseCreateEventInput } from '../../../../firebase/functions/src/owner/sessions'

/**
 * Entitlements are SCOPED by product. One uid may hold IOMIXO and MIOLOVE entitlements at once and they never mix; a record with no scope (every Stripe
 * record written before this field) is IOMIXO, never MIOLOVE. Admin-SDK logic against the Firestore emulator, FAKE Stripe, REAL webhook signatures.
 */
const fnReq = createRequire(__dirname + '/../../../../firebase/functions/package.json')
const { initializeApp, getApps } = fnReq('firebase-admin/app')
const { getFirestore, Timestamp } = fnReq('firebase-admin/firestore')
const Stripe = fnReq('stripe')
if (!getApps().length) initializeApp({ projectId: 'demo-iomixo' })
const db = getFirestore()
const clients: TestClient[] = []
after(async () => { await Promise.all(clients.map(closeClient)) })

const SECRET = 'whsec_test_secret'
const P = { ADV: 'price_ADVEUR000001', PASS: 'price_PASSEUR00001', MADV: 'price_MIOLOVEADV01', MPASS: 'price_MIOLOVEPASS1', OLD: 'price_OLDPRO000001' }
const base = buildPriceTable({ STRIPE_PRICE_ADVANCE_EUR: P.ADV, STRIPE_PRICE_EVENT_PASS_EUR: P.PASS, STRIPE_PRICE_LEGACY_PRO: P.OLD })
// MIOLOVE has no real price yet: these two exist only here, to prove a future MIOLOVE price is marked scope 'miolove'.
const PRICES = new Map<string, PriceInfo>([...Array.from(base.entries()),
  [P.MADV, { product: 'advance', tier: 'wedding', mode: 'subscription', checkout: true, scope: 'miolove' }],
  [P.MPASS, { product: 'event_pass', tier: null, mode: 'payment', checkout: true, scope: 'miolove' }],
])
const NOW = new Date()
const sec = (d: Date) => Math.floor(d.getTime() / 1000)
const future = (h: number) => new Date(NOW.getTime() + h * 3600_000)
let n = 0
const id = (p: string) => `${p}${Date.now().toString(36)}${n++}`

const req = (uid: string): AuthLike & { auth: AuthLike } => { const a = { uid, token: { email: `${uid}@example.com`, firebase: { sign_in_provider: 'password' } } }; return { ...a, auth: a } }
const mkUid = async (userFields: Record<string, unknown> = {}) => {
  const uid = id('es')
  await seedSet(`users/${uid}`, { uid, email: `${uid}@example.com`, plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date(), ...userFields })
  return uid
}
const plan = (tier: string, source = 'stripe') => ({ tier, source, validUntil: future(24 * 30) })
const pass = (uid: string, scope?: 'iomixo' | 'miolove', over: Record<string, unknown> = {}) =>
  seedSet(`users/${uid}/eventPasses/${id('p')}`, { status: 'active', validUntil: future(20), source: 'stripe', ...(scope ? { productScope: scope } : {}), ...over })
const album = (uid: string) => createEvent(db, req(uid), parseCreateEventInput({ requestId: id('r'), title: 'Album', type: 'wedding', brand: 'miolove' }))
const djEvent = (uid: string, type = 'party') => createEvent(db, req(uid), parseCreateEventInput({ requestId: id('r'), title: 'Evento', type, brand: 'iomixo' }))
const mode = async (eventId: string) => (await db.doc(`events/${eventId}`).get()).data()!.accessMode
const ioAccess = async (uid: string) => (await loadEntitlements(db, { uid }, null, NOW, 'iomixo')).eventAccess
const mioAccess = async (uid: string) => (await loadEntitlements(db, { uid }, null, NOW, 'miolove')).eventAccess
const fails = async (p: Promise<unknown>) => { try { await p } catch (e: any) { return `${e.code}:${e.details?.reason ?? ''}` } return 'ok' }

// ═══════════════ A–E: same uid, both products ═══════════════
test('ES-A. IOMIXO Pro / Advance + no MIOLOVE entitlement → IOMIXO keeps its plan, the MIOLOVE album is a TRIAL (not activated)', async () => {
  const pro = await mkUid({ plan: plan('pro') })
  assert.equal((await loadEntitlements(db, { uid: pro }, null, NOW, 'iomixo')).accountTier, 'pro')
  assert.equal((await loadEntitlements(db, { uid: pro }, null, NOW, 'miolove')).accountTier, 'free')
  assert.equal(await mode((await album(pro)).eventId), 'trial')

  const adv = await mkUid({ plan: plan('wedding') })
  assert.equal(await ioAccess(adv), true); assert.equal(await mioAccess(adv), false)
  const a = await album(adv)
  assert.equal(await mode(a.eventId), 'trial', 'an Advance plan does not activate a MIOLOVE album')
  assert.equal((await db.doc(`events/${a.eventId}`).get()).data()!.trialPhotoLimit, 50, 'the 50-photo trial limit is unchanged')
  assert.ok((await djEvent(adv)).eventId, 'and the same uid still creates its IOMIXO Party')
})

test('ES-B. IOMIXO Event Pass + no MIOLOVE entitlement → the pass is valid on IOMIXO, the MIOLOVE album is a TRIAL', async () => {
  const uid = await mkUid(); await pass(uid, 'iomixo')
  assert.equal(await ioAccess(uid), true); assert.equal(await mioAccess(uid), false)
  assert.equal(await mode((await album(uid)).eventId), 'trial')
  assert.ok((await djEvent(uid)).eventId)
})

test('ES-C. legacy entitlements WITHOUT a scope are IOMIXO: valid on IOMIXO, never on MIOLOVE', async () => {
  const uid = await mkUid({ plan: plan('wedding', 'legacy') }); await pass(uid)          // plan source legacy + a pass with no productScope
  assert.equal(await ioAccess(uid), true); assert.equal(await mioAccess(uid), false)
  const onlyPass = await mkUid(); await pass(onlyPass)
  assert.equal(await ioAccess(onlyPass), true); assert.equal(await mioAccess(onlyPass), false)
  assert.equal(await mode((await album(uid)).eventId), 'trial'); assert.equal(await mode((await album(onlyPass)).eventId), 'trial')
  assert.ok((await djEvent(onlyPass)).eventId)
})

test('ES-D. scope=miolove (plan or Event Pass) is isolated from IOMIXO, and creates no "premium account": the album is still the trial (each album is paid for on its own)', async () => {
  const byPlan = await mkUid({ miolovePlan: plan('wedding') })
  assert.equal(await mioAccess(byPlan), true); assert.equal(await ioAccess(byPlan), false)
  assert.equal(await mode((await album(byPlan)).eventId), 'trial', 'no account-level activation any more')
  assert.equal(await fails(djEvent(byPlan)), 'permission-denied:event_access_required', 'IOMIXO Party still needs an IOMIXO entitlement')
  assert.equal(await fails(djEvent(byPlan, 'wedding')), 'permission-denied:event_access_required')

  const byPass = await mkUid(); await pass(byPass, 'miolove')
  assert.equal(await mioAccess(byPass), true); assert.equal(await ioAccess(byPass), false)
  assert.equal(await mode((await album(byPass)).eventId), 'trial')
  assert.equal(await fails(djEvent(byPass)), 'permission-denied:event_access_required')
})

test('ES-E. scope=iomixo → IOMIXO unlocked, MIOLOVE not', async () => {
  const uid = await mkUid({ plan: plan('wedding') }); await pass(uid, 'iomixo')
  assert.equal(await ioAccess(uid), true); assert.equal(await mioAccess(uid), false)
  assert.equal(await mode((await album(uid)).eventId), 'trial'); assert.ok((await djEvent(uid)).eventId)
})

test('ES-F. the trial is one per ACCOUNT: an IOMIXO entitlement does not skip it, a second album is created but pending (no second trial), an expired MIOLOVE plan counts as none', async () => {
  const uid = await mkUid({ plan: plan('wedding') })
  assert.equal(await mode((await album(uid)).eventId), 'trial')
  assert.equal(await mode((await album(uid)).eventId), 'pending', 'second album: allowed, but no second trial')
  const expired = await mkUid({ miolovePlan: { tier: 'wedding', source: 'stripe', validUntil: new Date(NOW.getTime() - 3600_000) } })
  assert.equal(await mioAccess(expired), false)
  assert.equal(await mode((await album(expired)).eventId), 'trial')
  const refunded = await mkUid(); await pass(refunded, 'miolove', { status: 'refunded' }); assert.equal(await mioAccess(refunded), false)
})

// ═══════════════ the event's own product decides which entitlements govern it ═══════════════
test('ES-G. an event is judged by ITS product: IOMIXO Advance gives a MIOLOVE trial album no premium features; a MIOLOVE-activated album keeps them; the IOMIXO event of the same uid is unchanged', async () => {
  const uid = await mkUid({ plan: plan('wedding') })
  const trial = await album(uid), dj = await djEvent(uid)
  assert.equal((await loadEventEntitlements(db, trial.eventId, NOW)).eventAccess, false)
  assert.equal((await loadEventEntitlements(db, trial.eventId, NOW)).gates.photos, false, 'IOMIXO Advance does not turn on premium gates of the album')
  assert.equal((await loadEventEntitlements(db, dj.eventId, NOW)).eventAccess, true)

  const paid = await mkUid({ miolovePlan: plan('wedding') }), act = await album(paid)
  await db.doc(`events/${act.eventId}`).update({ accessMode: 'activated' })                              // what the verified MIOLOVE webhook writes
  assert.equal((await loadEventEntitlements(db, act.eventId, NOW)).eventAccess, true)
  // an album already marked activated keeps its feature set even after its MIOLOVE plan lapses
  await db.doc(`users/${paid}`).update({ miolovePlan: { tier: 'free', source: 'stripe' } })
  assert.equal((await loadEventEntitlements(db, act.eventId, NOW)).eventAccess, true)

  // historic couple album without a brand: still MIOLOVE → IOMIXO plan does not count
  const legacyCouple = await mkUid({ accountType: 'couple', plan: plan('wedding', 'legacy') })
  const eid = id('hist'); await seedSet(`events/${eid}`, eventFields(legacyCouple, `s${eid}`, { type: 'wedding' }))
  assert.equal((await loadEventEntitlements(db, eid, NOW)).eventAccess, false)
})

// ═══════════════ checkout / webhook ═══════════════
function fakeStripe() {
  const st = { subs: new Map<string, any>(), items: new Map<string, string[]>(), cancelled: [] as string[], sessions: [] as any[] }
  const api = {
    customers: { retrieve: async (c: string) => ({ id: c }), create: async () => ({ id: id('cus_') }) },
    checkout: { sessions: {
      create: async (p: any) => { st.sessions.push(p); return { id: id('cs_'), url: 'https://checkout.stripe.test/x' } },
      listLineItems: async (sid: string) => ({ data: (st.items.get(sid) ?? []).map((p) => ({ price: { id: p } })) }),
    } },
    billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.test/p' }) } },
    invoices: { retrieve: async () => { throw Object.assign(new Error('x'), { type: 'StripeInvalidRequestError', code: 'resource_missing' }) } },
    subscriptions: {
      retrieve: async (s: string) => st.subs.get(s),
      list: async (p: any) => ({ data: Array.from(st.subs.values()).filter((s) => s.customer === p.customer) }),
      cancel: async (s: string) => { st.cancelled.push(s); const x = st.subs.get(s); if (x) x.status = 'canceled' },
    },
  }
  return { st, api: api as any }
}
const sub = (customer: string, price: string) => ({ id: id('sub_'), customer, status: 'active', items: { data: [{ price: { id: price } }] }, current_period_start: sec(NOW), current_period_end: sec(NOW) + 30 * 86400, cancel_at_period_end: false, canceled_at: null, trial_start: null, trial_end: null, created: sec(NOW), metadata: {} })
let evNo = 0
const deliver = (fs: ReturnType<typeof fakeStripe>, type: string, object: any) => {
  const e = { id: `evt_${Date.now().toString(36)}${evNo++}`, object: 'event', type, created: sec(NOW), livemode: false, data: { object } }
  const payload = JSON.stringify(e)
  return handleStripeWebhook({ db, stripe: fs.api, prices: PRICES, now: () => NOW }, { rawBody: Buffer.from(payload), signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }), secret: SECRET })
}
const checkoutDone = (over: Record<string, unknown>) => ({ id: id('cs_'), object: 'checkout.session', mode: 'subscription', status: 'complete', payment_status: 'paid', customer: null, subscription: null, payment_intent: null, amount_total: 0, currency: 'eur', metadata: {}, ...over })

test('ES-W1. webhook: a subscription is stored with the scope of its PRICE; IOMIXO writes users.plan, MIOLOVE writes users.miolovePlan; neither touches or cancels the other', async () => {
  const fs = fakeStripe(); const uid = await mkUid(), cust = id('cus_'); await seedSet(`stripeCustomers/${cust}`, { uid })
  const io = sub(cust, P.ADV); fs.st.subs.set(io.id, io)
  assert.equal((await deliver(fs, 'checkout.session.completed', checkoutDone({ customer: cust, subscription: io.id, metadata: { firebaseUid: uid } }))).status, 200)
  let u = (await db.doc(`users/${uid}`).get()).data()!
  assert.equal(u.plan.tier, 'wedding'); assert.equal(u.miolovePlan, undefined)
  assert.equal((await db.doc(`users/${uid}/subscriptions/${io.id}`).get()).data()!.productScope, 'iomixo')

  const mi = sub(cust, P.MADV); fs.st.subs.set(mi.id, mi)
  assert.equal((await deliver(fs, 'checkout.session.completed', checkoutDone({ customer: cust, subscription: mi.id, metadata: { firebaseUid: uid } }))).status, 200)
  u = (await db.doc(`users/${uid}`).get()).data()!
  assert.equal(u.miolovePlan.tier, 'wedding'); assert.equal(u.plan.tier, 'wedding', 'the IOMIXO plan is untouched')
  assert.deepEqual(fs.st.cancelled, [], 'a MIOLOVE purchase never cancels the IOMIXO subscription')
  assert.equal((await db.doc(`users/${uid}/subscriptions/${mi.id}`).get()).data()!.productScope, 'miolove')
  assert.equal(await ioAccess(uid), true); assert.equal(await mioAccess(uid), true)

  // ending the MIOLOVE subscription removes ONLY the MIOLOVE entitlement
  mi.status = 'canceled'
  assert.equal((await deliver(fs, 'customer.subscription.deleted', mi)).status, 200)
  u = (await db.doc(`users/${uid}`).get()).data()!
  assert.deepEqual([u.miolovePlan.tier, u.plan.tier], ['free', 'wedding'])
  assert.equal(await ioAccess(uid), true); assert.equal(await mioAccess(uid), false)
})

test('ES-W2. webhook: an Event Pass is stored with the scope of its price (MIOLOVE price → miolove, current / legacy price → iomixo) and only counts in that product', async () => {
  const fs = fakeStripe(); const a = await mkUid(), b = await mkUid(), ca = id('cus_'), cb = id('cus_')
  await seedSet(`stripeCustomers/${ca}`, { uid: a }); await seedSet(`stripeCustomers/${cb}`, { uid: b })
  const sA = checkoutDone({ mode: 'payment', customer: ca, payment_intent: id('pi_'), metadata: { firebaseUid: a } }), sB = checkoutDone({ mode: 'payment', customer: cb, payment_intent: id('pi_'), metadata: { firebaseUid: b } })
  fs.st.items.set(sA.id, [P.MPASS]); fs.st.items.set(sB.id, [P.PASS])
  assert.equal((await deliver(fs, 'checkout.session.completed', sA)).status, 200); assert.equal((await deliver(fs, 'checkout.session.completed', sB)).status, 200)
  const scopes = async (uid: string) => (await db.collection(`users/${uid}/eventPasses`).get()).docs.map((d: any) => d.data().productScope)
  assert.deepEqual(await scopes(a), ['miolove']); assert.deepEqual(await scopes(b), ['iomixo'])
  assert.deepEqual([await mioAccess(a), await ioAccess(a)], [true, false]); assert.deepEqual([await mioAccess(b), await ioAccess(b)], [false, true])
  assert.equal(await mode((await album(a)).eventId), 'trial', 'a MIOLOVE-scope pass is an entitlement record, not an album activation'); assert.equal(await mode((await album(b)).eventId), 'trial')
})

test('ES-W3. webhook stays strict: bad signature → 400 and nothing written; an unknown price is still an explicit failure (no scope fallback)', async () => {
  const fs = fakeStripe(); const uid = await mkUid(), cust = id('cus_'); await seedSet(`stripeCustomers/${cust}`, { uid })
  const bad = sub(cust, 'price_UNKNOWN00001'); fs.st.subs.set(bad.id, bad)
  const e = { id: id('evt_'), object: 'event', type: 'checkout.session.completed', created: sec(NOW), livemode: false, data: { object: checkoutDone({ customer: cust, subscription: bad.id, metadata: { firebaseUid: uid } }) } }
  const payload = JSON.stringify(e)
  assert.equal((await handleStripeWebhook({ db, stripe: fs.api, prices: PRICES, now: () => NOW }, { rawBody: Buffer.from(payload), signature: 't=1,v1=deadbeef', secret: SECRET })).status, 400)
  assert.equal((await handleStripeWebhook({ db, stripe: fs.api, prices: PRICES, now: () => NOW }, { rawBody: Buffer.from(payload), signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }), secret: SECRET })).status, 500)
  const u = (await db.doc(`users/${uid}`).get()).data()!
  assert.deepEqual(u.plan, { tier: 'free', source: 'default' }); assert.equal(u.miolovePlan, undefined)
})

test('ES-C1. checkout marks the purchase with the scope of the PRICE (server table), never with what the client says; a MIOLOVE price would be marked miolove', async () => {
  const fs = fakeStripe(); const uid = await mkUid()
  const cfg = { baseUrl: 'https://www.iomixo.com', coupleBaseUrl: 'https://miolovealbum.com' }
  await createCheckoutSession(db, fs.api, PRICES, cfg, req(uid), { priceId: P.ADV, trial: false, eventId: null, portal: 'miolove' })
  assert.equal(fs.st.sessions.at(-1).metadata.productScope, 'iomixo', 'an IOMIXO price bought from the MIOLOVE domain is still an IOMIXO purchase')
  assert.equal(fs.st.sessions.at(-1).subscription_data.metadata.productScope, 'iomixo')
  await createCheckoutSession(db, fs.api, PRICES, cfg, req(uid), { priceId: P.MPASS, trial: false, eventId: null, portal: 'iomixo' })
  assert.equal(fs.st.sessions.at(-1).metadata.productScope, 'miolove'); assert.equal(fs.st.sessions.at(-1).payment_intent_data.metadata.productScope, 'miolove')
})

// ═══════════════ rules ═══════════════
test('ES-R1. a client can neither write nor forge a MIOLOVE plan (users rules unchanged: profile fields only)', async () => {
  const c = await newClient('account'); clients.push(c)
  assert.ok(await denied(setDoc(doc(c.db, 'users', c.uid), { uid: c.uid, email: c.email, plan: { tier: 'free', source: 'default' }, miolovePlan: { tier: 'wedding', source: 'stripe' }, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })))
  await seedSet(`users/${c.uid}`, { uid: c.uid, email: c.email, plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  assert.ok(await denied(updateDoc(doc(c.db, 'users', c.uid), { miolovePlan: { tier: 'wedding', source: 'stripe' }, updatedAt: serverTimestamp() })))
  assert.ok(await denied(updateDoc(doc(c.db, 'users', c.uid), { plan: { tier: 'wedding', source: 'stripe' }, updatedAt: serverTimestamp() })))
  assert.equal(await mioAccess(c.uid), false)
})
