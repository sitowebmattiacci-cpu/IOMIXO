import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { seedSet } from './seed'
import { buildPriceTable } from '../../../../firebase/functions/src/billing/prices'
import { createCheckoutSession, createPortalSession, parseCheckoutInput, type AuthLike } from '../../../../firebase/functions/src/billing/checkout'
import { handleStripeWebhook, EVENT_PASS_HOURS } from '../../../../firebase/functions/src/billing/webhook'
import { loadEntitlements } from '../../../../firebase/functions/src/entitlements/load'

// Billing Functions logic (checkout, portal, webhook) against the Firestore emulator with a FAKE Stripe client (no network) and REAL Stripe signatures.
const fnReq = createRequire(__dirname + '/../../../../firebase/functions/package.json')
const { initializeApp, getApps } = fnReq('firebase-admin/app')
const { getFirestore, Timestamp } = fnReq('firebase-admin/firestore')
const Stripe = fnReq('stripe')
if (!getApps().length) initializeApp({ projectId: 'demo-iomixo' })
const db = getFirestore()
const SECRET = 'whsec_test_secret'
const P = { PRO: 'price_PROEUR000001', ADV: 'price_ADVEUR000001', PASS: 'price_PASSEUR00001', OLD: 'price_OLDPRO000001', ROGUE: 'price_ROGUE0000001' }
const PRICES = buildPriceTable({ STRIPE_PRICE_PRO_EUR: P.PRO, STRIPE_PRICE_ADVANCE_EUR: P.ADV, STRIPE_PRICE_EVENT_PASS_EUR: P.PASS, STRIPE_PRICE_LEGACY_PRO: P.OLD })
const CFG = { baseUrl: 'https://www.iomixo.com/' }
const NOW = new Date('2026-10-13T12:00:00Z')
const sec = (d: Date) => Math.floor(d.getTime() / 1000)
let n = 0
const id = (p: string) => `${p}${Date.now().toString(36)}${n++}`

// ── fake Stripe ──
function fakeStripe() {
  const st = { invoices: new Map<string, any>(), failInvoice: false, customers: new Map<string, boolean>(), subs: new Map<string, any>(), lineItems: new Map<string, string[]>(), calls: [] as string[], created: [] as any[], portal: [] as any[], cancelled: [] as string[], failRetrieve: false, missingCustomers: new Set<string>() }
  const api = {
    customers: {
      retrieve: async (cid: string) => { st.calls.push('customers.retrieve'); if (st.missingCustomers.has(cid) || !st.customers.has(cid)) throw Object.assign(new Error('No such customer'), { type: 'StripeInvalidRequestError', code: 'resource_missing' }); return { id: cid } },
      create: async (p: any) => { st.calls.push('customers.create'); const cid = id('cus_'); st.customers.set(cid, true); st.created.push({ kind: 'customer', ...p }); return { id: cid } },
    },
    checkout: { sessions: {
      create: async (p: any) => { st.calls.push('sessions.create'); st.created.push({ kind: 'session', ...p }); return { id: id('cs_'), url: 'https://checkout.stripe.test/c/pay' } },
      listLineItems: async (sid: string) => { st.calls.push('listLineItems'); return { data: (st.lineItems.get(sid) ?? []).map((p) => ({ price: { id: p } })) } },
    } },
    billingPortal: { sessions: { create: async (p: any) => { st.portal.push(p); return { url: 'https://billing.stripe.test/p/session' } } } },
    invoices: { retrieve: async (iid: string) => { st.calls.push('invoices.retrieve'); if (st.failInvoice) throw new Error('stripe is down'); const v = st.invoices.get(iid); if (!v) throw Object.assign(new Error('No such invoice'), { type: 'StripeInvalidRequestError', code: 'resource_missing' }); return v } },
    subscriptions: {
      retrieve: async (sid: string) => { st.calls.push('subscriptions.retrieve'); if (st.failRetrieve) throw new Error('stripe is down'); return st.subs.get(sid) },
      list: async (p: any) => { st.calls.push('subscriptions.list'); return { data: Array.from(st.subs.values()).filter((s) => s.customer === p.customer) } },
      cancel: async (sid: string) => { st.cancelled.push(sid); const s = st.subs.get(sid); if (s) s.status = 'canceled' },
    },
  }
  return { st, api: api as any }
}
const sub = (customer: string, price: string, over: Record<string, unknown> = {}) => ({
  id: id('sub_'), customer, status: 'active', items: { data: [{ price: { id: price } }] }, current_period_start: sec(NOW), current_period_end: sec(NOW) + 30 * 86400,
  cancel_at_period_end: false, canceled_at: null, trial_start: null, trial_end: null, created: sec(NOW), metadata: {}, ...over,
})

// ── accounts ──
const auth = (uid: string, email = `${uid}@example.com`, provider = 'password'): AuthLike => ({ uid, token: { email, firebase: { sign_in_provider: provider } } })
async function mkUser(over: Record<string, unknown> = {}) {
  const uid = id('bu'), legacy = id('leg-')
  await seedSet(`users/${uid}`, { uid, email: `${uid}@example.com`, plan: { tier: 'free', source: 'default' }, legacySupabaseId: legacy, createdAt: new Date(), updatedAt: new Date(), ...over })
  return { uid, legacy }
}
const get = async (path: string) => (await db.doc(path).get()).data()
const reason = async (p: Promise<unknown>) => { try { await p; return 'ok' } catch (e: any) { return `${e.code}:${e.details?.reason ?? ''}` } }

// ── webhook helpers ──
let evNo = 0
const evt = (type: string, object: any, over: Record<string, unknown> = {}) => ({ id: `evt_${Date.now().toString(36)}${evNo++}`, object: 'event', type, created: sec(NOW), livemode: false, data: { object }, ...over })
const deliver = (fs: ReturnType<typeof fakeStripe>, e: any, o: { secret?: string; badSig?: boolean; now?: Date; prices?: any } = {}) => {
  const payload = JSON.stringify(e)
  const signature = o.badSig ? 't=1,v1=deadbeef' : Stripe.webhooks.generateTestHeaderString({ payload, secret: o.secret ?? SECRET })
  return handleStripeWebhook({ db, stripe: fs.api, prices: o.prices ?? PRICES, now: () => o.now ?? NOW }, { rawBody: Buffer.from(payload), signature, secret: SECRET })
}
const checkoutSession = (over: Record<string, unknown> = {}) => ({ id: id('cs_'), object: 'checkout.session', mode: 'subscription', status: 'complete', payment_status: 'paid', customer: null, subscription: null, payment_intent: null, amount_total: 0, currency: 'eur', metadata: {}, ...over })

// ═══════════════ checkout / portal ═══════════════
test('C1. checkout needs a signed-in ACCOUNT; payload and price are validated; a price outside the server allow-list never reaches Stripe', async () => {
  const fs = fakeStripe(); const { uid } = await mkUser()
  assert.equal(await reason(createCheckoutSession(db, fs.api, PRICES, CFG, undefined, { priceId: P.PRO, trial: false, eventId: null })), 'unauthenticated:account_required')
  assert.equal(await reason(createCheckoutSession(db, fs.api, PRICES, CFG, auth(uid, 'a@b.c', 'anonymous'), { priceId: P.PRO, trial: false, eventId: null })), 'unauthenticated:account_required')
  for (const bad of [{}, { priceId: 5 }, { priceId: 'x' }, { priceId: 'price_' }, { priceId: P.PRO, trial: 'yes' }, { priceId: P.PRO, eventId: '../x' }]) assert.throws(() => parseCheckoutInput(bad), /invalid_payload/, JSON.stringify(bad))
  for (const p of [P.ROGUE, P.OLD]) assert.equal(await reason(createCheckoutSession(db, fs.api, PRICES, CFG, auth(uid), { priceId: p, trial: false, eventId: null })), 'invalid-argument:invalid_price', p)
  assert.deepEqual(fs.st.calls, [], 'Stripe was not called at all')
})

test('C2. subscription checkout: customer created ONCE and persisted both ways, then reused; server-built mode / metadata / URLs / payment methods', async () => {
  const fs = fakeStripe(); const { uid, legacy } = await mkUser()
  const r1 = await createCheckoutSession(db, fs.api, PRICES, CFG, auth(uid, 'dj@example.com'), { priceId: P.ADV, trial: false, eventId: null })
  assert.equal(r1.url, 'https://checkout.stripe.test/c/pay')
  const cust = (await get(`users/${uid}`))!.stripeCustomerId as string
  assert.match(cust, /^cus_/); assert.deepEqual(await get(`stripeCustomers/${cust}`), { uid, legacySupabaseId: legacy, source: 'checkout', createdAt: (await get(`stripeCustomers/${cust}`))!.createdAt })
  assert.deepEqual((await get(`users/${uid}`))!.plan, { tier: 'free', source: 'default' }, 'checkout never touches the plan')
  const created = fs.st.created.find((c) => c.kind === 'customer')
  assert.deepEqual(created.metadata, { firebaseUid: uid, legacySupabaseId: legacy }); assert.equal(created.email, 'dj@example.com')
  const s = fs.st.created.find((c) => c.kind === 'session')
  assert.equal(s.customer, cust); assert.equal(s.mode, 'subscription'); assert.deepEqual(s.line_items, [{ price: P.ADV, quantity: 1 }]); assert.deepEqual(s.payment_method_types, ['card', 'paypal'])
  assert.deepEqual(s.metadata, { firebaseUid: uid, legacySupabaseId: legacy, plan: 'wedding', checkoutType: 'subscription', product: 'advance' }); assert.deepEqual(s.subscription_data.metadata, s.metadata)
  assert.equal(s.success_url, 'https://www.iomixo.com/dashboard?upgraded=true&session_id={CHECKOUT_SESSION_ID}'); assert.equal(s.cancel_url, 'https://www.iomixo.com/billing')
  assert.equal(s.subscription_data.trial_period_days, undefined)
  fs.st.calls.length = 0
  await createCheckoutSession(db, fs.api, PRICES, CFG, auth(uid), { priceId: P.PRO, trial: false, eventId: null })
  assert.equal(fs.st.calls.filter((c) => c === 'customers.create').length, 0, 'the saved customer is reused'); assert.equal((await get(`users/${uid}`))!.stripeCustomerId, cust)
})

test('C3. a saved customer from another Stripe environment (resource_missing) is replaced and both mappings updated', async () => {
  const fs = fakeStripe(); const { uid } = await mkUser({ stripeCustomerId: 'cus_fromTestMode' })
  fs.st.missingCustomers.add('cus_fromTestMode')
  await createCheckoutSession(db, fs.api, PRICES, CFG, auth(uid), { priceId: P.PRO, trial: false, eventId: null })
  const cust = (await get(`users/${uid}`))!.stripeCustomerId as string
  assert.notEqual(cust, 'cus_fromTestMode'); assert.equal((await get(`stripeCustomers/${cust}`))!.uid, uid)
})

test('C4. Event Pass checkout: payment mode, optional own event only; trial rules (subscription only, once per account)', async () => {
  const fs = fakeStripe(); const { uid } = await mkUser(); const other = await mkUser()
  await seedSet(`events/ev-${uid}`, { ownerUid: uid, slug: 's1', title: 'T', status: 'live', createdAt: new Date(), updatedAt: new Date() })
  await seedSet(`events/ev-${other.uid}`, { ownerUid: other.uid, slug: 's2', title: 'T', status: 'live', createdAt: new Date(), updatedAt: new Date() })
  await createCheckoutSession(db, fs.api, PRICES, CFG, auth(uid), { priceId: P.PASS, trial: false, eventId: `ev-${uid}` })
  const s = fs.st.created.filter((c) => c.kind === 'session').pop()
  assert.equal(s.mode, 'payment'); assert.equal(s.metadata.checkoutType, 'event_pass'); assert.equal(s.metadata.eventId, `ev-${uid}`); assert.equal(s.payment_intent_data.metadata.eventId, `ev-${uid}`); assert.equal(s.subscription_data, undefined)
  assert.equal(await reason(createCheckoutSession(db, fs.api, PRICES, CFG, auth(uid), { priceId: P.PASS, trial: false, eventId: `ev-${other.uid}` })), 'not-found:event_not_found', 'someone else\'s event')
  assert.equal(await reason(createCheckoutSession(db, fs.api, PRICES, CFG, auth(uid), { priceId: P.PRO, trial: false, eventId: `ev-${uid}` })), 'invalid-argument:invalid_payload', 'an event id only makes sense for the pass')
  assert.equal(await reason(createCheckoutSession(db, fs.api, PRICES, CFG, auth(uid), { priceId: P.PASS, trial: true, eventId: null })), 'invalid-argument:trial_not_available')
  await createCheckoutSession(db, fs.api, PRICES, CFG, auth(uid), { priceId: P.PRO, trial: true, eventId: null })
  const t = fs.st.created.filter((c) => c.kind === 'session').pop()
  assert.equal(t.subscription_data.trial_period_days, 7); assert.equal(t.payment_method_collection, 'if_required'); assert.equal(t.metadata.checkoutType, 'trial')
  await seedSet(`users/${uid}/subscriptions/sub_old`, { status: 'canceled' })
  assert.equal(await reason(createCheckoutSession(db, fs.api, PRICES, CFG, auth(uid), { priceId: P.PRO, trial: true, eventId: null })), 'failed-precondition:trial_not_available', 'not twice')
})

test('C5. portal: needs an account and a saved customer; return URL is server-side', async () => {
  const fs = fakeStripe(); const a = await mkUser(), b = await mkUser({ stripeCustomerId: 'cus_portal1' })
  assert.equal(await reason(createPortalSession(db, fs.api, CFG, undefined)), 'unauthenticated:account_required')
  assert.equal(await reason(createPortalSession(db, fs.api, CFG, auth(a.uid))), 'failed-precondition:no_billing_account')
  assert.deepEqual(await createPortalSession(db, fs.api, CFG, auth(b.uid)), { url: 'https://billing.stripe.test/p/session' })
  assert.deepEqual(fs.st.portal, [{ customer: 'cus_portal1', return_url: 'https://www.iomixo.com/billing' }])
})

// ═══════════════ webhook ═══════════════
test('W1. signature: invalid / missing / wrong-secret → 400, nothing read or written (no stripeEvents doc)', async () => {
  const fs = fakeStripe(); const e = evt('checkout.session.completed', checkoutSession())
  assert.equal((await deliver(fs, e, { badSig: true })).status, 400)
  assert.equal((await deliver(fs, e, { secret: 'whsec_other' })).status, 400)
  assert.equal((await handleStripeWebhook({ db, stripe: fs.api, prices: PRICES }, { rawBody: undefined, signature: 't=1,v1=aa', secret: SECRET })).status, 400)
  assert.equal((await handleStripeWebhook({ db, stripe: fs.api, prices: PRICES }, { rawBody: Buffer.from(JSON.stringify(e)), signature: undefined, secret: SECRET })).status, 400)
  assert.equal((await db.doc(`stripeEvents/${e.id}`).get()).exists, false); assert.deepEqual(fs.st.calls, [])
})

test('W2. subscription checkout: subscription doc + plan {tier, source:stripe, validUntil}; entitlement derives from it; a DUPLICATE event is acknowledged without re-running', async () => {
  const fs = fakeStripe(); const { uid } = await mkUser(); const cust = id('cus_')
  await seedSet(`stripeCustomers/${cust}`, { uid, legacySupabaseId: 'x' })
  const s = sub(cust, P.ADV); fs.st.subs.set(s.id, s)
  const e = evt('checkout.session.completed', checkoutSession({ customer: cust, subscription: s.id, metadata: { firebaseUid: uid, plan: 'wedding' } }))
  const r = await deliver(fs, e)
  assert.deepEqual([r.status, r.body], [200, { received: true }])
  const u = (await get(`users/${uid}`))!
  assert.equal(u.plan.tier, 'wedding'); assert.equal(u.plan.source, 'stripe'); assert.equal(u.plan.validUntil.toMillis(), (sec(NOW) + 30 * 86400 + 3 * 86400) * 1000)
  const sd = (await get(`users/${uid}/subscriptions/${s.id}`))!
  assert.deepEqual([sd.status, sd.tier, sd.priceId, sd.historical, sd.stale, sd.source, sd.cancelAtPeriodEnd], ['active', 'wedding', P.ADV, false, false, 'stripe', false])
  const ev = (await get(`stripeEvents/${e.id}`))!; assert.deepEqual([ev.status, ev.attempts, ev.type], ['processed', 1, 'checkout.session.completed'])
  assert.equal(JSON.stringify(ev).includes('@'), false, 'no personal data in the event log')
  const ent = await loadEntitlements(db, { uid }, null, NOW)
  assert.equal(ent.eventAccess, true, 'the Firestore resolver grants Advance from the webhook-written plan')
  fs.st.calls.length = 0
  const r2 = await deliver(fs, e)
  assert.deepEqual([r2.status, r2.body], [200, { received: true, duplicate: true }]); assert.deepEqual(fs.st.calls, [], 'no Stripe call, no write on a duplicate')
  assert.equal((await get(`stripeEvents/${e.id}`))!.attempts, 1)
})

test('W3. plan switch cancels the superseded subscription; a trial checkout (no_payment_required) is a trialing subscription; unpaid checkout grants nothing', async () => {
  const fs = fakeStripe(); const { uid } = await mkUser(); const cust = id('cus_'); await seedSet(`stripeCustomers/${cust}`, { uid })
  const oldPro = sub(cust, P.PRO); const adv = sub(cust, P.ADV); fs.st.subs.set(oldPro.id, oldPro); fs.st.subs.set(adv.id, adv)
  await deliver(fs, evt('checkout.session.completed', checkoutSession({ customer: cust, subscription: adv.id, metadata: { firebaseUid: uid } })))
  assert.deepEqual(fs.st.cancelled, [oldPro.id]); assert.equal((await get(`users/${uid}`))!.plan.tier, 'wedding')
  // trial
  const t = await mkUser(); const tc = id('cus_'); await seedSet(`stripeCustomers/${tc}`, { uid: t.uid })
  const ts = sub(tc, P.PRO, { status: 'trialing', trial_start: sec(NOW), trial_end: sec(NOW) + 7 * 86400 }); fs.st.subs.set(ts.id, ts)
  await deliver(fs, evt('checkout.session.completed', checkoutSession({ customer: tc, subscription: ts.id, payment_status: 'no_payment_required', metadata: { firebaseUid: t.uid } })))
  const td = (await get(`users/${t.uid}/subscriptions/${ts.id}`))!; assert.equal(td.status, 'trialing'); assert.equal(td.trialEnd.toMillis(), (sec(NOW) + 7 * 86400) * 1000); assert.equal((await get(`users/${t.uid}`))!.plan.tier, 'pro')
  // unpaid
  const x = await mkUser(); const xc = id('cus_'); await seedSet(`stripeCustomers/${xc}`, { uid: x.uid }); const xs = sub(xc, P.ADV); fs.st.subs.set(xs.id, xs)
  assert.equal((await deliver(fs, evt('checkout.session.completed', checkoutSession({ customer: xc, subscription: xs.id, payment_status: 'unpaid', metadata: { firebaseUid: x.uid } })))).status, 200)
  assert.deepEqual((await get(`users/${x.uid}`))!.plan, { tier: 'free', source: 'default' }); assert.equal((await db.doc(`users/${x.uid}/subscriptions/${xs.id}`).get()).exists, false)
})

test('W4. subscription updated / deleted: doc follows Stripe, plan is recomputed from what is STILL live; an older event never overwrites a newer doc', async () => {
  const fs = fakeStripe(); const { uid } = await mkUser(); const cust = id('cus_'); await seedSet(`stripeCustomers/${cust}`, { uid })
  const s = sub(cust, P.PRO); fs.st.subs.set(s.id, s)
  const e1 = evt('customer.subscription.updated', { ...s, cancel_at_period_end: true }, { created: sec(NOW) + 100 })
  await deliver(fs, e1)
  assert.equal((await get(`users/${uid}/subscriptions/${s.id}`))!.cancelAtPeriodEnd, true); assert.equal((await get(`users/${uid}`))!.plan.tier, 'pro')
  await deliver(fs, evt('customer.subscription.updated', { ...s, cancel_at_period_end: false }, { created: sec(NOW) + 50 }))     // older, delivered late
  assert.equal((await get(`users/${uid}/subscriptions/${s.id}`))!.cancelAtPeriodEnd, true, 'stale event ignored for the doc')
  s.status = 'canceled'
  await deliver(fs, evt('customer.subscription.deleted', { ...s }, { created: sec(NOW) + 200 }))
  const d = (await get(`users/${uid}/subscriptions/${s.id}`))!; assert.equal(d.status, 'canceled')
  assert.deepEqual((await get(`users/${uid}`))!.plan, { tier: 'free', source: 'stripe' }, 'nothing live left → free, written by Stripe')
  assert.equal((await loadEntitlements(db, { uid }, null, NOW)).eventAccess, false)
})

test('W5. Event Pass: validUntil = PAYMENT time + 24 h (never processing time); 0 € coupon keyed by session id; create-once across completed/async events; unpaid grants nothing', async () => {
  const fs = fakeStripe(); const { uid } = await mkUser(); const cust = id('cus_'); await seedSet(`stripeCustomers/${cust}`, { uid })
  const paidAt = new Date(NOW.getTime() - 2 * 3600_000)
  const s = checkoutSession({ mode: 'payment', customer: cust, payment_intent: id('pi_'), amount_total: 799, metadata: { firebaseUid: uid, checkoutType: 'event_pass' } })
  fs.st.lineItems.set(s.id, [P.PASS])
  await deliver(fs, evt('checkout.session.completed', s, { created: sec(paidAt) }))
  const pass = (await get(`users/${uid}/eventPasses/${s.payment_intent}`))!
  assert.equal(pass.validUntil.toMillis(), paidAt.getTime() + EVENT_PASS_HOURS * 3600_000); assert.deepEqual([pass.status, pass.source, pass.amountCents], ['active', 'stripe', 799])
  assert.equal((await get(`users/${uid}/payments/${s.payment_intent}`))!.kind, 'event_pass')
  assert.equal((await loadEntitlements(db, { uid }, null, NOW)).eventAccess, true, 'pass grants Advance access')
  await deliver(fs, evt('checkout.session.async_payment_succeeded', s, { created: sec(NOW) }))           // a second, different event for the same purchase
  assert.equal((await get(`users/${uid}/eventPasses/${s.payment_intent}`))!.validUntil.toMillis(), paidAt.getTime() + 24 * 3600_000, 'never extended')
  // late replay (paid 30 h ago, processed now): expired from the start, NOT a fresh 24 h
  const late = checkoutSession({ mode: 'payment', customer: cust, payment_intent: id('pi_'), amount_total: 799, metadata: { firebaseUid: uid } }); fs.st.lineItems.set(late.id, [P.PASS])
  await deliver(fs, evt('checkout.session.completed', late, { created: sec(new Date(NOW.getTime() - 30 * 3600_000)) }))
  const ld = (await get(`users/${uid}/eventPasses/${late.payment_intent}`))!; assert.equal(ld.status, 'expired'); assert.ok(ld.validUntil.toMillis() < NOW.getTime())
  // 100 % coupon: no payment intent
  const free = checkoutSession({ mode: 'payment', customer: cust, payment_intent: null, payment_status: 'no_payment_required', amount_total: 0, metadata: { firebaseUid: uid } }); fs.st.lineItems.set(free.id, [P.PASS])
  await deliver(fs, evt('checkout.session.completed', free))
  const fd = (await get(`users/${uid}/eventPasses/${free.id}`))!; assert.deepEqual([fd.status, fd.stripePaymentIntentId, fd.amountCents], ['active', null, 0])
  // unpaid / not complete
  for (const over of [{ payment_status: 'unpaid' }, { status: 'open' }]) {
    const x = checkoutSession({ mode: 'payment', customer: cust, payment_intent: id('pi_'), metadata: { firebaseUid: uid }, ...over }); fs.st.lineItems.set(x.id, [P.PASS])
    assert.equal((await deliver(fs, evt('checkout.session.completed', x))).status, 200); assert.equal((await db.doc(`users/${uid}/eventPasses/${x.payment_intent}`).get()).exists, false, JSON.stringify(over))
  }
})

test('W6. UNKNOWN PRICE is an explicit failure (500 + recorded), never a fallback plan; fixing the config lets the SAME event succeed on retry', async () => {
  const fs = fakeStripe(); const { uid } = await mkUser(); const cust = id('cus_'); await seedSet(`stripeCustomers/${cust}`, { uid })
  const s = sub(cust, P.ROGUE); fs.st.subs.set(s.id, s)
  const e = evt('checkout.session.completed', checkoutSession({ customer: cust, subscription: s.id, metadata: { firebaseUid: uid } }))
  const r = await deliver(fs, e)
  assert.deepEqual([r.status, r.body], [500, { error: 'unknown_price' }])
  assert.deepEqual((await get(`users/${uid}`))!.plan, { tier: 'free', source: 'default' }, 'no plan granted'); assert.equal((await db.doc(`users/${uid}/subscriptions/${s.id}`).get()).exists, false)
  assert.deepEqual([(await get(`stripeEvents/${e.id}`))!.status, (await get(`stripeEvents/${e.id}`))!.error], ['failed', 'unknown_price'])
  const fixed = buildPriceTable({ STRIPE_PRICE_PRO_EUR: P.ROGUE })
  const r2 = await deliver(fs, e, { prices: fixed })
  assert.equal(r2.status, 200); assert.equal((await get(`users/${uid}`))!.plan.tier, 'pro'); assert.equal((await get(`stripeEvents/${e.id}`))!.attempts, 2)
  // Event Pass: an unknown price, and a known but NOT-pass price, both fail
  for (const price of [P.ROGUE, P.PRO]) {
    const p = checkoutSession({ mode: 'payment', customer: cust, payment_intent: id('pi_'), metadata: { firebaseUid: uid } }); fs.st.lineItems.set(p.id, [price])
    assert.equal((await deliver(fs, evt('checkout.session.completed', p))).status, 500); assert.equal((await db.doc(`users/${uid}/eventPasses/${p.payment_intent}`).get()).exists, false)
  }
  // a live subscription carrying an unknown price also blocks the recompute (no silent downgrade/upgrade)
  const u2 = await mkUser(); const c2 = id('cus_'); await seedSet(`stripeCustomers/${c2}`, { uid: u2.uid }); const s2 = sub(c2, 'price_NEVERSEEN0001'); fs.st.subs.set(s2.id, s2)
  assert.equal((await deliver(fs, evt('customer.subscription.updated', s2))).status, 500)
})

test('W7. a failing handler is NOT acknowledged: 500, recorded, retried by Stripe, then processed exactly once; a concurrent delivery gets 409; an abandoned lock is taken over', async () => {
  const fs = fakeStripe(); const { uid } = await mkUser(); const cust = id('cus_'); await seedSet(`stripeCustomers/${cust}`, { uid })
  const s = sub(cust, P.PRO); fs.st.subs.set(s.id, s); fs.st.failRetrieve = true
  const e = evt('checkout.session.completed', checkoutSession({ customer: cust, subscription: s.id, metadata: { firebaseUid: uid } }))
  const r = await deliver(fs, e)
  assert.deepEqual([r.status, r.body], [500, { error: 'handler_error' }]); assert.equal((await get(`stripeEvents/${e.id}`))!.status, 'failed'); assert.equal((await get(`users/${uid}`))!.plan.tier, 'free')
  fs.st.failRetrieve = false
  assert.equal((await deliver(fs, e)).status, 200); const ev = (await get(`stripeEvents/${e.id}`))!; assert.deepEqual([ev.status, ev.attempts], ['processed', 2]); assert.equal((await get(`users/${uid}`))!.plan.tier, 'pro')
  assert.equal((await db.collection(`users/${uid}/subscriptions`).get()).size, 1)
  // concurrency
  const e2 = evt('customer.subscription.updated', s)
  await seedSet(`stripeEvents/${e2.id}`, { type: e2.type, status: 'processing', attempts: 1, lockedUntil: new Date(NOW.getTime() + 60_000), receivedAt: NOW })
  assert.equal((await deliver(fs, e2)).status, 409)
  await seedSet(`stripeEvents/${e2.id}`, { type: e2.type, status: 'processing', attempts: 1, lockedUntil: new Date(NOW.getTime() - 60_000), receivedAt: NOW })
  assert.equal((await deliver(fs, e2)).status, 200); assert.equal((await get(`stripeEvents/${e2.id}`))!.attempts, 2)
})

test('W8. invoices: paid + payment_succeeded of the same invoice make ONE payment; payment_failed records a failed attempt and flags the subscription', async () => {
  const fs = fakeStripe(); const { uid } = await mkUser(); const cust = id('cus_'); await seedSet(`stripeCustomers/${cust}`, { uid })
  const s = sub(cust, P.PRO); fs.st.subs.set(s.id, s); await deliver(fs, evt('customer.subscription.updated', s))
  const inv = { id: id('in_'), customer: cust, subscription: s.id, payment_intent: id('pi_'), amount_paid: 999, amount_due: 999, currency: 'eur' }
  await deliver(fs, evt('invoice.paid', inv)); await deliver(fs, evt('invoice.payment_succeeded', inv))
  assert.equal((await db.collection(`users/${uid}/payments`).get()).size, 1)
  const pd = (await get(`users/${uid}/payments/${inv.payment_intent}`))!; assert.deepEqual([pd.amountCents, pd.status, pd.kind, pd.stripeInvoiceId, pd.historical], [999, 'succeeded', 'subscription', inv.id, false])
  const bad = { ...inv, id: id('in_'), payment_intent: id('pi_'), amount_paid: 0 }
  await deliver(fs, evt('invoice.payment_failed', bad, { created: sec(NOW) + 5 }))
  assert.equal((await get(`users/${uid}/payments/${bad.id}`))!.status, 'failed'); assert.ok((await get(`users/${uid}/subscriptions/${s.id}`))!.lastPaymentFailedAt)
  assert.equal((await get(`users/${uid}`))!.plan.tier, 'pro', 'a failed invoice alone does not change the plan (the subscription event does)')
  const noPi = { ...inv, id: id('in_'), payment_intent: null, amount_paid: 0 }                                    // 0 € invoice: no payment intent
  await deliver(fs, evt('invoice.paid', noPi)); assert.ok((await db.doc(`users/${uid}/payments/${noPi.id}`).get()).exists)
  assert.ok(!(await db.doc(`users/${uid}/payments/in_${noPi.id}`).get()).exists, 'regression: the invoice id must not be prefixed twice (in_in_…)')
  assert.ok(!(await db.collection(`users/${uid}/payments`).get()).docs.some((d) => d.id.startsWith('in_in_')))
})

test('W8b. a newer-API subscription event (period on the item, not on the subscription) still stores the billing period', async () => {
  const fs = fakeStripe(); const { uid } = await mkUser(); const cust = id('cus_'); await seedSet(`stripeCustomers/${cust}`, { uid })
  const s = sub(cust, P.PRO); const end = sec(NOW) + 30 * 86400
  const { current_period_start, current_period_end, ...rest } = s as Record<string, unknown>; void current_period_start; void current_period_end
  const newer = { ...rest, items: { data: [{ price: { id: P.PRO }, current_period_start: sec(NOW), current_period_end: end }] } }
  fs.st.subs.set(s.id, s); await deliver(fs, evt('customer.subscription.updated', newer))
  const d = (await get(`users/${uid}/subscriptions/${s.id}`))!
  assert.equal(d.currentPeriodEnd.toMillis(), end * 1000); assert.equal(d.currentPeriodStart.toMillis(), sec(NOW) * 1000)
})

test('W8c. API 2026-04-22.dahlia invoices: subscription/metadata under `parent`, no payment_intent (read through the pinned client); same payment ids as the old shape, one payment, no in_in_', async () => {
  const fs = fakeStripe(); const { uid } = await mkUser(); const cust = id('cus_'); await seedSet(`stripeCustomers/${cust}`, { uid })
  const s = sub(cust, P.PRO); fs.st.subs.set(s.id, s); await deliver(fs, evt('customer.subscription.updated', s))
  const parent = { type: 'subscription_details', subscription_details: { subscription: s.id, metadata: { firebaseUid: uid } } }
  const inv = { id: id('in_'), customer: cust, parent, amount_paid: 999, amount_due: 999, currency: 'eur' }          // dahlia: no `subscription`, no `payment_intent`
  const pi = id('pi_'); fs.st.invoices.set(inv.id, { ...inv, payment_intent: pi })
  await deliver(fs, evt('invoice.paid', inv)); await deliver(fs, evt('invoice.payment_succeeded', inv))
  assert.equal((await db.collection(`users/${uid}/payments`).get()).size, 1)
  const pd = (await get(`users/${uid}/payments/${pi}`))!; assert.deepEqual([pd.amountCents, pd.status, pd.stripePaymentIntentId, pd.stripeInvoiceId], [999, 'succeeded', pi, inv.id])
  const bad = { ...inv, id: id('in_'), amount_paid: 0 }; fs.st.invoices.set(bad.id, { ...bad, payment_intent: id('pi_') })
  await deliver(fs, evt('invoice.payment_failed', bad, { created: sec(NOW) + 5 }))
  assert.equal((await get(`users/${uid}/payments/${bad.id}`))!.status, 'failed'); assert.ok((await get(`users/${uid}/subscriptions/${s.id}`))!.lastPaymentFailedAt, 'subscription found through parent.subscription_details')
  const zero = { id: id('in_'), customer: cust, parent, amount_paid: 0, amount_due: 0, currency: 'eur' }; fs.st.invoices.set(zero.id, { ...zero, payment_intent: null })       // 0 € invoice
  await deliver(fs, evt('invoice.paid', zero)); assert.ok((await db.doc(`users/${uid}/payments/${zero.id}`).get()).exists)
  assert.ok(!(await db.collection(`users/${uid}/payments`).get()).docs.some((d) => d.id.startsWith('in_in_')))
  // owner resolved by the metadata under `parent` alone (customer unknown)
  const meta = { id: id('in_'), customer: id('cus_'), parent, amount_paid: 0, amount_due: 0, currency: 'eur' }; fs.st.invoices.set(meta.id, { ...meta, payment_intent: null })
  assert.equal((await deliver(fs, evt('invoice.paid', meta))).status, 200); assert.ok((await db.doc(`users/${uid}/payments/${meta.id}`).get()).exists)
  // Stripe unreadable while the payment intent is needed → 500 (Stripe retries), nothing written
  fs.st.failInvoice = true; const late = { ...zero, id: id('in_') }; fs.st.invoices.set(late.id, late)
  const r = await deliver(fs, evt('invoice.paid', late)); assert.equal(r.status, 500); assert.ok(!(await db.doc(`users/${uid}/payments/${late.id}`).get()).exists)
})

test('W9. refund revokes the Event Pass (monotonic: never resurrected by a late completed event) and marks the payment; replays are harmless', async () => {
  const fs = fakeStripe(); const { uid } = await mkUser(); const cust = id('cus_'); await seedSet(`stripeCustomers/${cust}`, { uid })
  const s = checkoutSession({ mode: 'payment', customer: cust, payment_intent: id('pi_'), amount_total: 799, metadata: { firebaseUid: uid } }); fs.st.lineItems.set(s.id, [P.PASS])
  await deliver(fs, evt('checkout.session.completed', s))
  const charge = { id: id('ch_'), customer: cust, payment_intent: s.payment_intent, metadata: {} }
  await deliver(fs, evt('charge.refunded', charge)); await deliver(fs, evt('charge.refunded', charge))
  const pass = (await get(`users/${uid}/eventPasses/${s.payment_intent}`))!; assert.equal(pass.status, 'refunded'); assert.ok(pass.refundedAt)
  assert.equal((await get(`users/${uid}/payments/${s.payment_intent}`))!.status, 'refunded')
  await deliver(fs, evt('checkout.session.async_payment_succeeded', s))
  assert.equal((await get(`users/${uid}/eventPasses/${s.payment_intent}`))!.status, 'refunded', 'still refunded')
  assert.equal((await loadEntitlements(db, { uid }, null, NOW)).eventAccess, false)
  assert.equal((await deliver(fs, evt('charge.refunded', { id: id('ch_'), customer: cust, payment_intent: null }))).status, 200)
})

test('W10. account resolution: legacy checkout metadata (user_id = Supabase id) works; an unknown account fails explicitly (500); failed-payment events and unrelated types are acknowledged without writes', async () => {
  const fs = fakeStripe(); const { uid, legacy } = await mkUser(); const cust = id('cus_')
  const s = sub(cust, P.PRO); fs.st.subs.set(s.id, s)
  assert.equal((await deliver(fs, evt('checkout.session.completed', checkoutSession({ customer: cust, subscription: s.id, metadata: { user_id: legacy } })))).status, 200)
  assert.equal((await get(`users/${uid}`))!.plan.tier, 'pro')
  const ghost = id('cus_'), g = sub(ghost, P.PRO); fs.st.subs.set(g.id, g)
  const r = await deliver(fs, evt('customer.subscription.updated', g)); assert.deepEqual([r.status, r.body], [500, { error: 'unresolved_account' }])
  for (const [type, obj] of [['payment_intent.payment_failed', { id: 'pi_x' }], ['checkout.session.async_payment_failed', checkoutSession()], ['customer.created', { id: 'cus_x' }]] as const) {
    fs.st.calls.length = 0; assert.equal((await deliver(fs, evt(type, obj))).status, 200); assert.deepEqual(fs.st.calls, [], type)
  }
})

test('W11. clients can neither read nor write stripeEvents (rules deny-all); the webhook stores no payload', async () => {
  const e = evt('customer.created', { id: 'cus_zz', email: 'secret@example.com' }); const fs = fakeStripe(); await deliver(fs, e)
  const doc = (await get(`stripeEvents/${e.id}`))!
  assert.deepEqual(Object.keys(doc).sort(), ['attempts', 'created', 'livemode', 'processedAt', 'receivedAt', 'status', 'type'].sort()); assert.equal(JSON.stringify(doc).includes('secret@example.com'), false)
})

test('C-portal. Stripe return URLs follow the account role: Sposi → MIOLOVE once configured, DJ → IOMIXO, unset → IOMIXO for everybody; nothing else changes', async () => {
  const both = { baseUrl: 'https://www.iomixo.com/', coupleBaseUrl: 'https://miolovealbum.com/' }
  const couple = await mkUser({ accountType: 'couple', stripeCustomerId: 'cus_couplePortal' }), dj = await mkUser({ accountType: 'dj', stripeCustomerId: 'cus_djPortal' }), legacy = await mkUser({ stripeCustomerId: 'cus_legacyPortal' })
  const fs = fakeStripe(); for (const c of ['cus_couplePortal', 'cus_djPortal', 'cus_legacyPortal']) fs.st.customers.set(c, true)
  const sessionFor = async (uid: string, cfg: typeof both | typeof CFG) => { fs.st.created.length = 0; await createCheckoutSession(db, fs.api, PRICES, cfg, auth(uid), { priceId: P.PRO, trial: false, eventId: null }); return fs.st.created.find((c) => c.kind === 'session') }

  let s = await sessionFor(couple.uid, both)
  assert.equal(s.success_url, 'https://miolovealbum.com/billing?upgraded=true&session_id={CHECKOUT_SESSION_ID}'); assert.equal(s.cancel_url, 'https://miolovealbum.com/billing')
  s = await sessionFor(dj.uid, both)
  assert.equal(s.success_url, 'https://www.iomixo.com/dashboard?upgraded=true&session_id={CHECKOUT_SESSION_ID}'); assert.equal(s.cancel_url, 'https://www.iomixo.com/billing')
  s = await sessionFor(legacy.uid, both)
  assert.equal(s.success_url, 'https://www.iomixo.com/dashboard?upgraded=true&session_id={CHECKOUT_SESSION_ID}', 'no accountType = legacy DJ')
  s = await sessionFor(couple.uid, CFG)
  assert.equal(s.success_url, 'https://www.iomixo.com/dashboard?upgraded=true&session_id={CHECKOUT_SESSION_ID}', 'MIOLOVE_BASE_URL unset: the couple keeps today\'s URLs')

  fs.st.portal.length = 0
  await createPortalSession(db, fs.api, both, auth(couple.uid)); await createPortalSession(db, fs.api, both, auth(dj.uid)); await createPortalSession(db, fs.api, CFG, auth(couple.uid))
  assert.deepEqual(fs.st.portal.map((p: any) => p.return_url), ['https://miolovealbum.com/billing', 'https://www.iomixo.com/billing', 'https://www.iomixo.com/billing'])
})
