import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { seedSet } from './seed'
import { eventFields } from './seed'
import { buildPriceTable, checkoutPrice, albumActivationPrice } from '../../../../firebase/functions/src/billing/prices'
import { createCheckoutSession, type AuthLike } from '../../../../firebase/functions/src/billing/checkout'
import { createAlbumCheckoutSession, parseAlbumCheckoutInput, albumCurrencyFor } from '../../../../firebase/functions/src/billing/albumCheckout'
import { handleStripeWebhook } from '../../../../firebase/functions/src/billing/webhook'
import { loadEntitlements } from '../../../../firebase/functions/src/entitlements/load'

// MIOLOVE one-time album purchase (€19.99 / $19.99): checkout rules + the verified webhook that activates ONE album. FAKE Stripe client (no network), REAL signatures.
const fnReq = createRequire(__dirname + '/../../../../firebase/functions/package.json')
const { initializeApp, getApps } = fnReq('firebase-admin/app')
const { getFirestore } = fnReq('firebase-admin/firestore')
const Stripe = fnReq('stripe')
if (!getApps().length) initializeApp({ projectId: 'demo-iomixo' })
const db = getFirestore()
const SECRET = 'whsec_test_secret'
const P = { PRO: 'price_PROEUR000001', ADV: 'price_ADVEUR000001', PASS: 'price_PASSEUR00001', ALB_EUR: 'price_ALBEUR000001', ALB_USD: 'price_ALBUSD000001', ROGUE: 'price_ROGUE0000001' }
const PRICES = buildPriceTable({ STRIPE_PRICE_PRO_EUR: P.PRO, STRIPE_PRICE_ADVANCE_EUR: P.ADV, STRIPE_PRICE_EVENT_PASS_EUR: P.PASS, STRIPE_PRICE_MIOLOVE_ALBUM_EUR: P.ALB_EUR, STRIPE_PRICE_MIOLOVE_ALBUM_USD: P.ALB_USD })
const CFG = { baseUrl: 'https://www.iomixo.com', coupleBaseUrl: 'https://miolovealbum.com' }
const NOW = new Date('2026-10-22T12:00:00Z')
const sec = (d: Date) => Math.floor(d.getTime() / 1000)
let n = 0
const id = (p: string) => `${p}${Date.now().toString(36)}${n++}`

function fakeStripe() {
  const st = { customers: new Map<string, boolean>(), lineItems: new Map<string, string[]>(), created: [] as any[], calls: [] as string[] }
  const api = {
    customers: {
      retrieve: async (cid: string) => { if (!st.customers.has(cid)) throw Object.assign(new Error('No such customer'), { type: 'StripeInvalidRequestError', code: 'resource_missing' }); return { id: cid } },
      create: async () => { const cid = id('cus_'); st.customers.set(cid, true); return { id: cid } },
    },
    checkout: { sessions: {
      create: async (p: any) => { st.calls.push('sessions.create'); st.created.push(p); return { id: id('cs_'), url: 'https://checkout.stripe.test/c/pay' } },
      listLineItems: async (sid: string) => ({ data: (st.lineItems.get(sid) ?? []).map((p) => ({ price: { id: p } })) }),
    } },
    billingPortal: { sessions: { create: async () => ({ url: 'x' }) } },
    invoices: { retrieve: async () => { throw new Error('unused') } },
    subscriptions: { retrieve: async () => { throw new Error('unused') }, list: async () => ({ data: [] }), cancel: async () => ({}) },
  }
  return { st, api: api as any }
}
const auth = (uid: string, provider = 'password'): AuthLike => ({ uid, token: { email: `${uid}@example.com`, firebase: { sign_in_provider: provider } } })
async function mkUser(accountType: 'couple' | 'dj' = 'couple') {
  const uid = id('su'); await seedSet(`users/${uid}`, { uid, email: `${uid}@example.com`, accountType, plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  return uid
}
async function mkAlbum(ownerUid: string, over: Record<string, unknown> = {}) {
  const eid = id('al'); await seedSet(`events/${eid}`, eventFields(ownerUid, `slug${eid}`, { type: 'wedding', brand: 'miolove', accessMode: 'trial', trialPhotoCount: 3, trialPhotoLimit: 50, ...over })); return eid
}
const get = async (path: string) => (await db.doc(path).get()).data()
const reason = async (p: Promise<unknown>) => { try { await p; return 'ok' } catch (e: any) { return `${e.code}:${e.details?.reason ?? ''}` } }
let evNo = 0
const evt = (type: string, object: any, over: Record<string, unknown> = {}) => ({ id: `evt_${Date.now().toString(36)}${evNo++}`, object: 'event', type, created: sec(NOW), livemode: false, data: { object }, ...over })
const deliver = (fs: ReturnType<typeof fakeStripe>, e: any, o: { badSig?: boolean; prices?: any } = {}) => {
  const payload = JSON.stringify(e)
  const signature = o.badSig ? 't=1,v1=deadbeef' : Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET })
  return handleStripeWebhook({ db, stripe: fs.api, prices: o.prices ?? PRICES, now: () => NOW }, { rawBody: Buffer.from(payload), signature, secret: SECRET })
}
const paidSession = (fs: ReturnType<typeof fakeStripe>, uid: string, eventId: string | null, over: Record<string, unknown> = {}, price = P.ALB_EUR) => {
  const cust = id('cus_'); const s = { id: id('cs_'), object: 'checkout.session', mode: 'payment', status: 'complete', payment_status: 'paid', customer: cust, subscription: null, payment_intent: id('pi_'), amount_total: 1999, currency: 'eur',
    metadata: { firebaseUid: uid, ownerUid: uid, portal: 'miolove', product: 'album_activation', productScope: 'miolove', eventId }, ...over }
  fs.st.lineItems.set(s.id, [price]); return { s, cust }
}

test('S-price. the album price: server table only; one price per currency; 19.99 is Stripe\'s; the generic checkout refuses it; language → currency', () => {
  assert.equal(albumActivationPrice(PRICES, 'eur')!.id, P.ALB_EUR); assert.equal(albumActivationPrice(PRICES, 'usd')!.id, P.ALB_USD); assert.equal(albumActivationPrice(buildPriceTable({}), 'eur'), null)
  assert.equal(PRICES.get(P.ALB_EUR)!.scope, 'miolove'); assert.equal(PRICES.get(P.ALB_EUR)!.mode, 'payment'); assert.equal(PRICES.get(P.PRO)!.scope, 'iomixo')
  assert.equal(checkoutPrice(PRICES, P.ALB_EUR), null, 'not offered by the generic checkout')
  assert.deepEqual((['it', 'fr', 'es', 'en'] as const).map(albumCurrencyFor), ['eur', 'eur', 'eur', 'usd'])
  assert.deepEqual(parseAlbumCheckoutInput({ eventId: 'ev_1', locale: 'zz', priceId: P.ROGUE, amount: 1, currency: 'jpy' }), { eventId: 'ev_1', locale: 'it' })
  assert.throws(() => parseAlbumCheckoutInput({ eventId: '../x' })); assert.throws(() => parseAlbumCheckoutInput({}))
})

test('S-checkout-1. the owner of a trial album gets ONE-TIME Checkout: server price, currency by language, MIOLOVE URLs, safe metadata; client price / amount / currency are ignored', async () => {
  const fs = fakeStripe(); const uid = await mkUser(); const eid = await mkAlbum(uid)
  for (const [locale, price, cur] of [['it', P.ALB_EUR, 'eur'], ['fr', P.ALB_EUR, 'eur'], ['es', P.ALB_EUR, 'eur'], ['en', P.ALB_USD, 'usd']] as const) {
    fs.st.created.length = 0
    const r = await createAlbumCheckoutSession(db, fs.api, PRICES, CFG, auth(uid), { ...parseAlbumCheckoutInput({ eventId: eid, locale, priceId: P.ROGUE, amount: 5, currency: 'jpy' }) })
    assert.equal(r.url, 'https://checkout.stripe.test/c/pay')
    const p = fs.st.created[0]
    assert.equal(p.mode, 'payment'); assert.deepEqual(p.line_items, [{ price, quantity: 1 }], `${locale} → ${cur}`); assert.equal(p.locale, locale)
    assert.equal(p.subscription_data, undefined); assert.equal(p.client_reference_id, eid)
    assert.deepEqual(p.metadata, { firebaseUid: uid, ownerUid: uid, portal: 'miolove', product: 'album_activation', productScope: 'miolove', checkoutType: 'album_activation', eventId: eid })
    assert.deepEqual(p.payment_intent_data.metadata, p.metadata)
    assert.equal(p.success_url, `https://miolovealbum.com/sessions/${eid}?payment=success&session_id={CHECKOUT_SESSION_ID}`)
    assert.equal(p.cancel_url, `https://miolovealbum.com/billing?payment=cancelled&album=${eid}`)
    assert.ok(!JSON.stringify(p).includes('iomixo.com'), 'never an IOMIXO URL')
  }
})

test('S-checkout-2. refusals: anonymous, another owner, missing / deleted event, IOMIXO event, already activated, ineligible; nothing reaches Stripe', async () => {
  const fs = fakeStripe(); const uid = await mkUser(), other = await mkUser(); const eid = await mkAlbum(uid)
  const call = (a: AuthLike | undefined, eventId: string, cfg: any = CFG, prices = PRICES) => reason(createAlbumCheckoutSession(db, fs.api, prices, cfg, a, parseAlbumCheckoutInput({ eventId, locale: 'it' })))
  assert.equal(await call(undefined, eid), 'unauthenticated:account_required'); assert.equal(await call(auth(uid, 'anonymous'), eid), 'unauthenticated:account_required')
  assert.equal(await call(auth(other), eid), 'not-found:event_not_found'); assert.equal(await call(auth(uid), 'doesnotexist'), 'not-found:event_not_found')
  assert.equal(await call(auth(uid), await mkAlbum(uid, { deletedAt: new Date() })), 'not-found:event_not_found')
  assert.equal(await call(auth(uid), await mkAlbum(uid, { type: 'party', brand: 'iomixo', accessMode: undefined })), 'permission-denied:not_miolove_album')
  assert.equal(await call(auth(uid), await mkAlbum(uid, { accessMode: 'activated' })), 'failed-precondition:already_activated')
  assert.equal(await call(auth(uid), await mkAlbum(uid, { accessMode: undefined })), 'failed-precondition:album_not_eligible')
  assert.equal(await call(auth(uid), eid, { baseUrl: 'https://www.iomixo.com' }), 'failed-precondition:checkout_unavailable', 'no MIOLOVE origin → no checkout (never an iomixo.com return)')
  assert.equal(await call(auth(uid), eid, CFG, buildPriceTable({})), 'failed-precondition:checkout_unavailable', 'price not configured')
  assert.equal(fs.st.calls.length, 0, 'Stripe was never called')
  // the generic (IOMIXO) checkout cannot be used to buy the album price either
  assert.equal(await reason(createCheckoutSession(db, fs.api, PRICES, CFG, auth(uid), { priceId: P.ALB_EUR, trial: false, eventId: eid })), 'invalid-argument:invalid_price')
})

test('S-webhook-1. verified paid session activates EXACTLY that album (accessMode, activatedAt, audit ids); the redirect / checkout creation never does; payment ledger in MIOLOVE scope', async () => {
  const fs = fakeStripe(); const uid = await mkUser(); const eid = await mkAlbum(uid), eid2 = await mkAlbum(uid)
  await createAlbumCheckoutSession(db, fs.api, PRICES, CFG, auth(uid), { eventId: eid, locale: 'it' })
  assert.equal((await get(`events/${eid}`))!.accessMode, 'trial', 'creating a checkout activates nothing')
  const { s, cust } = paidSession(fs, uid, eid); await seedSet(`stripeCustomers/${cust}`, { uid })
  const r = await deliver(fs, evt('checkout.session.completed', s)); assert.equal(r.status, 200)
  const e = (await get(`events/${eid}`))!
  assert.equal(e.accessMode, 'activated'); assert.ok(e.activatedAt); assert.deepEqual([e.activation.source, e.activation.checkoutSessionId, e.activation.paymentIntentId, e.activation.amountCents, e.activation.currency], ['stripe', s.id, s.payment_intent, 1999, 'eur'])
  assert.equal((await get(`events/${eid2}`))!.accessMode, 'trial', 'the user\'s OTHER album is untouched')
  const pay = (await get(`users/${uid}/payments/${s.payment_intent}`))!; assert.deepEqual([pay.kind, pay.productScope, pay.eventId, pay.amountCents, pay.status], ['album_activation', 'miolove', eid, 1999, 'succeeded'])
  assert.equal((await get(`users/${uid}`))!.plan.tier, 'free', 'no IOMIXO plan was written'); assert.equal((await get(`users/${uid}`))!.miolovePlan, undefined)
  assert.equal(((await db.collection(`users/${uid}/eventPasses`).get()).size), 0); assert.equal(((await db.collection(`users/${uid}/subscriptions`).get()).size), 0)
  assert.equal((await loadEntitlements(db, { uid }, null, NOW)).eventAccess, false, 'an IOMIXO entitlement check is unchanged by the purchase')
})

test('S-webhook-2. idempotent: same event twice, a second event for the same payment, a second payment for an already activated album → one activation, one ledger entry, activatedAt never rewritten', async () => {
  const fs = fakeStripe(); const uid = await mkUser(); const eid = await mkAlbum(uid)
  const { s, cust } = paidSession(fs, uid, eid); await seedSet(`stripeCustomers/${cust}`, { uid })
  const e1 = evt('checkout.session.completed', s)
  assert.equal((await deliver(fs, e1)).status, 200); const first = (await get(`events/${eid}`))!
  assert.deepEqual((await deliver(fs, e1)).body, { received: true, duplicate: true })
  assert.equal((await deliver(fs, evt('checkout.session.async_payment_succeeded', s))).status, 200)
  const again = (await get(`events/${eid}`))!; assert.equal(again.activatedAt.toMillis(), first.activatedAt.toMillis()); assert.equal(again.activation.stripeEventId, first.activation.stripeEventId)
  const dup = paidSession(fs, uid, eid); await seedSet(`stripeCustomers/${dup.cust}`, { uid })
  assert.equal((await deliver(fs, evt('checkout.session.completed', dup.s))).status, 200)
  assert.equal((await get(`events/${eid}`))!.activation.checkoutSessionId, s.id, 'the first payment stays the activation record')
  assert.equal((await get(`users/${uid}/payments/${dup.s.payment_intent}`))!.activation, 'already_activated', 'the extra payment is recorded for a human, nothing else changes')
  assert.equal((await db.collection(`users/${uid}/payments`).get()).size, 2)
})

test('S-webhook-3. invalid signature / unpaid / not complete → nothing changes; metadata that disagrees with Firestore activates nothing', async () => {
  const fs = fakeStripe(); const uid = await mkUser(), victim = await mkUser(); const eid = await mkAlbum(uid), vid = await mkAlbum(victim), iomixoEv = await mkAlbum(uid, { type: 'party', brand: 'iomixo', accessMode: undefined })
  const ok = paidSession(fs, uid, eid); await seedSet(`stripeCustomers/${ok.cust}`, { uid })
  assert.equal((await deliver(fs, evt('checkout.session.completed', ok.s), { badSig: true })).status, 400); assert.equal((await get(`events/${eid}`))!.accessMode, 'trial')
  for (const over of [{ payment_status: 'unpaid' }, { status: 'open' }]) {
    const x = paidSession(fs, uid, eid, over); assert.equal((await deliver(fs, evt('checkout.session.completed', x.s))).status, 200); assert.equal((await get(`events/${eid}`))!.accessMode, 'trial', JSON.stringify(over))
  }
  // someone else's album id in the metadata (buyer ≠ owner), an IOMIXO event, a missing event id, wrong portal / product → never activated
  const cases: Array<[string, any]> = [['other owner', paidSession(fs, uid, vid)], ['iomixo event', paidSession(fs, uid, iomixoEv)], ['no event', paidSession(fs, uid, null)],
    ['wrong portal', paidSession(fs, uid, eid, { metadata: { firebaseUid: uid, portal: 'iomixo', product: 'album_activation', eventId: eid } })], ['wrong product', paidSession(fs, uid, eid, { metadata: { firebaseUid: uid, portal: 'miolove', product: 'x', eventId: eid } })]]
  for (const [label, c] of cases) { assert.equal((await deliver(fs, evt('checkout.session.completed', c.s))).status, 200, label) }
  for (const x of [eid, vid, iomixoEv]) assert.notEqual((await get(`events/${x}`))!.accessMode, 'activated', x)
  assert.equal((await get(`events/${iomixoEv}`))!.accessMode ?? null, null)
})

test('S-webhook-4. ISOLATION: an IOMIXO price (Event Pass) never activates a MIOLOVE album, an album payment never creates an IOMIXO pass; unknown price is an explicit failure', async () => {
  const fs = fakeStripe(); const uid = await mkUser(); const eid = await mkAlbum(uid); const cust = id('cus_'); await seedSet(`stripeCustomers/${cust}`, { uid })
  // an Event Pass bought for this very user, carrying MIOLOVE-looking metadata: it is an Event Pass (price decides), the album stays a trial
  const pass = { id: id('cs_'), object: 'checkout.session', mode: 'payment', status: 'complete', payment_status: 'paid', customer: cust, payment_intent: id('pi_'), amount_total: 799, currency: 'eur',
    metadata: { firebaseUid: uid, portal: 'miolove', product: 'album_activation', eventId: eid } }
  fs.st.lineItems.set(pass.id, [P.PASS]); assert.equal((await deliver(fs, evt('checkout.session.completed', pass))).status, 200)
  assert.equal((await get(`events/${eid}`))!.accessMode, 'trial'); assert.equal((await get(`users/${uid}/eventPasses/${pass.payment_intent}`))!.productScope, 'iomixo')
  const alb = paidSession(fs, uid, eid); await seedSet(`stripeCustomers/${alb.cust}`, { uid }); await deliver(fs, evt('checkout.session.completed', alb.s))
  assert.equal((await db.doc(`users/${uid}/eventPasses/${alb.s.payment_intent}`).get()).exists, false, 'no pass from an album payment'); assert.equal((await get(`events/${eid}`))!.accessMode, 'activated')
  const rogue = paidSession(fs, uid, eid, {}, P.ROGUE); assert.equal((await deliver(fs, evt('checkout.session.completed', rogue.s))).status, 500)
})

test('S-webhook-5. after activation the MIOLOVE server rules see an ACTIVATED album (unlimited media, archives) and an IOMIXO event of the same account is not touched', async () => {
  const fs = fakeStripe(); const uid = await mkUser(); const eid = await mkAlbum(uid); const dj = await mkAlbum(uid, { type: 'party', brand: 'iomixo', accessMode: undefined, title: 'DJ night' })
  const { s, cust } = paidSession(fs, uid, eid); await seedSet(`stripeCustomers/${cust}`, { uid }); await deliver(fs, evt('checkout.session.completed', s))
  const { isTrialAlbum } = await import('../../../../firebase/functions/src/photos/trialQuota')
  assert.equal(isTrialAlbum((await get(`events/${eid}`))!), false); assert.equal((await get(`events/${dj}`))!.title, 'DJ night'); assert.equal((await get(`events/${dj}`))!.accessMode, undefined)
})
