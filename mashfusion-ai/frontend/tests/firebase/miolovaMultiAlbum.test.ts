import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { seedSet, eventFields } from './seed'
import { buildMiolovePriceTable } from '../../../../firebase/functions/src/billing/prices'
import { createAlbumCheckoutSession, parseAlbumCheckoutInput } from '../../../../firebase/functions/src/billing/albumCheckout'
import { handleMioloveWebhook } from '../../../../firebase/functions/src/billing/mioloveWebhook'
import type { AuthLike } from '../../../../firebase/functions/src/billing/checkout'
import { createEvent, parseCreateEventInput, restoreEvent, deleteEvent } from '../../../../firebase/functions/src/owner/sessions'
import { createPhotoUpload, parseCreatePhotoUploadInput } from '../../../../firebase/functions/src/photos/photos'
import { requestAlbumExport, parseRequestExportInput } from '../../../../firebase/functions/src/photos/exports'
import { getPublicEvent } from '../../../../firebase/functions/src/owner/publicEvent'
import { purgeAlbum, purgeExpiredAlbums } from '../../../../firebase/functions/src/albums/purge'
import { newClient, closeClient, denied } from './helpers'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { backfillAlbumExpiry } from '../../../../firebase/functions/src/albums/backfill'

/**
 * MIOLOVE multi-album lifecycle: one account, many albums, ONE free trial per account, €19.99 and 365 days PER album, trial recovery window, daily purge.
 * Admin-SDK logic against the real Firestore + Storage emulators, FAKE Stripe, REAL webhook signatures. The server clock is injected (`now`), so months pass in a test.
 */
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'; process.env.STORAGE_EMULATOR_HOST = 'http://127.0.0.1:9199'; process.env.GCLOUD_PROJECT = 'demo-iomixo'
const fnReq = createRequire(__dirname + '/../../../../firebase/functions/package.json')
const { initializeApp, getApps } = fnReq('firebase-admin/app')
const { getFirestore, Timestamp } = fnReq('firebase-admin/firestore')
const { getStorage } = fnReq('firebase-admin/storage')
const Stripe = fnReq('stripe')
if (!getApps().length) initializeApp({ projectId: 'demo-iomixo' })
const db = getFirestore()
const bucket = getStorage().bucket('demo-iomixo.firebasestorage.app')

const DAY = 86_400_000
const MIO_SECRET = 'whsec_miolove_secret'
const P = { ALB_EUR: 'price_ALBEUR000001', ALB_USD: 'price_ALBUSD000001' }
const MPRICES = buildMiolovePriceTable({ STRIPE_PRICE_MIOLOVE_ALBUM_EUR: P.ALB_EUR, STRIPE_PRICE_MIOLOVE_ALBUM_USD: P.ALB_USD })
const CFG = { baseUrl: 'https://www.iomixo.com', coupleBaseUrl: 'https://miolovealbum.com' }
let n = 0
const id = (p: string) => `${p}${Date.now().toString(36)}${n++}`
const iso = (d: Date) => d.toISOString()
const ago = (now: Date, days: number) => new Date(now.getTime() - days * DAY)

const req = (uid: string): AuthLike & { auth: AuthLike } => { const a = { uid, token: { email: `${uid}@example.com`, firebase: { sign_in_provider: 'password' } } }; return { ...a, auth: a } }
const auth = (uid: string, provider = 'password'): AuthLike => ({ uid, token: { email: `${uid}@example.com`, firebase: { sign_in_provider: provider } } })
async function mkUser(accountType: 'couple' | 'dj' = 'couple') {
  const uid = id('ma'); await seedSet(`users/${uid}`, { uid, email: `${uid}@example.com`, accountType, plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
  return uid
}
const album = (uid: string, over: Record<string, unknown> = {}) =>
  createEvent(db, req(uid), parseCreateEventInput({ requestId: id('r'), title: 'Album', type: 'wedding', brand: 'miolove', occasionType: 'birthday', ...over }))
const get = async (path: string) => (await db.doc(path).get()).data()
const reason = async (p: Promise<unknown>) => { try { await p; return 'ok' } catch (e: any) { return `${e.code}:${e.details?.reason ?? ''}` } }
/** Plants an album directly (a state the callables cannot produce at will: dates in the past/future). */
async function plant(ownerUid: string, over: Record<string, unknown>) {
  const eid = id('pl'); await seedSet(`events/${eid}`, eventFields(ownerUid, `slug${eid}`, { type: 'wedding', brand: 'miolove', ...over })); await seedSet(`eventSlugs/slug${eid}`, { eventId: eid })
  return eid
}
/** One run of the daily job. The emulator is shared with every other test file, so the page cap is lifted: leftovers of other tests must never hide the album under test. */
const run = (now: Date, extra: Record<string, unknown> = {}) => purgeExpiredAlbums(db, now, { maxAlbums: 5000, pageSize: 50, ...extra })
const upload = (uid: string, eventId: string, now: Date) => createPhotoUpload(db, uid, parseCreatePhotoUploadInput({ eventId, ext: 'jpg', size: 1000, source: 'live_booth', guestName: 'G' }), () => now.getTime())

// ── fake Stripe + signed webhook (same shape as miolovaStripe.test.ts) ──
function fakeStripe() {
  const st = { lineItems: new Map<string, string[]>(), created: [] as any[], calls: [] as string[], refunds: new Map<string, any>(), refundCalls: 0, failRefund: false }
  const api = { refunds: { create: async (p: any, o: any) => {
    st.refundCalls++; if (st.failRefund) throw Object.assign(new Error('stripe down'), { code: 'api_connection_error' })
    const key = o?.idempotencyKey as string; if (!st.refunds.has(key)) st.refunds.set(key, { id: `re_${st.refunds.size + 1}`, status: 'succeeded', params: p }); return st.refunds.get(key)
  } }, checkout: { sessions: {
    create: async (p: any) => { st.calls.push('create'); st.created.push(p); return { id: id('cs_'), url: 'https://checkout.stripe.test/c/pay' } },
    listLineItems: async (sid: string) => ({ data: (st.lineItems.get(sid) ?? []).map((p) => ({ price: { id: p } })) }),
  } } }
  return { st, api: api as any }
}
let evNo = 0
const evt = (type: string, object: any, createdAt: Date) => ({ id: `evt_${Date.now().toString(36)}${evNo++}`, object: 'event', type, created: Math.floor(createdAt.getTime() / 1000), livemode: false, data: { object } })
const deliver = (fs: ReturnType<typeof fakeStripe>, e: any, now: Date) => {
  const payload = JSON.stringify(e), signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: MIO_SECRET })
  return handleMioloveWebhook({ db, stripe: fs.api, prices: MPRICES, now: () => now }, { rawBody: Buffer.from(payload), signature, secret: MIO_SECRET })
}
const paid = (fs: ReturnType<typeof fakeStripe>, uid: string, eventId: string | null, over: Record<string, unknown> = {}) => {
  const s = { id: id('cs_'), object: 'checkout.session', mode: 'payment', status: 'complete', payment_status: 'paid', customer: id('cus_'), payment_intent: id('pi_'), amount_total: 1999, currency: 'eur',
    metadata: { firebaseUid: uid, ownerUid: uid, portal: 'miolove', product: 'album_activation', productScope: 'miolove', eventId }, ...over }
  fs.st.lineItems.set(s.id, [P.ALB_EUR]); return s
}
const pay = (fs: ReturnType<typeof fakeStripe>, uid: string, eventId: string, now: Date) => deliver(fs, evt('checkout.session.completed', paid(fs, uid, eventId), now), now)

// ═══════════════════════════ creation ═══════════════════════════

test('MA-A. FIRST album of the account: trial — 7 days, 50 contents, purge scheduled 30 days after the trial end', async () => {
  const uid = await mkUser(); const before = Date.now()
  const a = await album(uid); const e = (await get(`events/${a.eventId}`))!
  assert.deepEqual([e.accessMode, e.brand, e.type, e.trialPhotoLimit, e.trialPhotoCount], ['trial', 'miolove', 'wedding', 50, 0])
  const start = e.trialStartsAt.toMillis(), end = e.trialExpiresAt.toMillis()
  assert.equal(end - start, 7 * DAY, 'exactly 7 days'); assert.ok(start >= before - 1000 && start <= Date.now() + 1000, 'measured from the SERVER clock')
  assert.equal(e.purgeAfter.toMillis() - end, 30 * DAY, 'trial end + 30 days recovery window')
  assert.equal((await get(`trialAlbums/${uid}`))!.eventId, a.eventId)
})

test('MA-B. SECOND, THIRD… album: created freely, state "pending", NO second trial, no trial fields; owner data kept; no uploads, no archive before payment', async () => {
  const uid = await mkUser(); const a = await album(uid)
  const b = await album(uid, { title: 'Compleanno Luca', coupleNames: 'Luca', weddingDate: '2026-12-05', venueName: 'Villa Rosa', occasionType: 'birthday' })
  const c = await album(uid, { title: 'Battesimo', occasionType: 'baptism' })
  const e = (await get(`events/${b.eventId}`))!
  assert.equal((await get(`events/${a.eventId}`))!.accessMode, 'trial'); assert.equal(e.accessMode, 'pending'); assert.equal((await get(`events/${c.eventId}`))!.accessMode, 'pending')
  assert.deepEqual([e.title, e.coupleNames, e.weddingDate, e.venueName, e.occasionType], ['Compleanno Luca', 'Luca', '2026-12-05', 'Villa Rosa', 'birthday'])
  for (const f of ['trialExpiresAt', 'trialStartsAt', 'trialPhotoLimit', 'activatedAt', 'expiresAt', 'purgeAfter']) assert.equal((e as any)[f], undefined, f)
  // before payment: no guest upload, no archive
  assert.equal(await reason(upload('guest1', b.eventId, new Date())), 'failed-precondition:miolove_album_not_activated')
  assert.equal(await reason(requestAlbumExport(db, req(uid), parseRequestExportInput({ eventId: b.eventId }))), 'permission-denied:export_requires_album')
  // …and the pending album does not use up anything of the first one
  assert.equal((await get(`events/${a.eventId}`))!.trialPhotoCount, 0)
  assert.equal((await get(`trialAlbums/${uid}`))!.eventId, a.eventId, 'the single reservation still names the trial album')
})

test('MA-B2. public payload of a pending album: closed to uploads, phase says why; an IOMIXO account is unaffected by any of this', async () => {
  const uid = await mkUser(); await album(uid); const b = await album(uid)
  const slug = (await get(`events/${b.eventId}`))!.slug
  const pub = await getPublicEvent(db, slug)
  assert.deepEqual([pub.session.access_mode, pub.session.album_phase, pub.session.uploads_closed, pub.session.expires_at], ['pending', 'pending', true, null])
  const dj = await mkUser('dj')
  assert.equal(await reason(createEvent(db, req(dj), parseCreateEventInput({ requestId: id('r'), title: 'Night', type: 'wedding', brand: 'iomixo' }))), 'permission-denied:event_access_required')
})

// ═══════════════════════════ payment per album, independent dates ═══════════════════════════

test('MA-C/D. paying album B activates ONLY B: accessMode, activatedAt = payment instant, expiresAt = +365 days exactly, audit ids; album A untouched', async () => {
  const fs = fakeStripe(); const uid = await mkUser(); const a = await album(uid); const b = await album(uid)
  const NOW = new Date('2026-10-23T09:00:00Z')
  const before = JSON.stringify(await get(`events/${a.eventId}`))
  const s = paid(fs, uid, b.eventId); assert.equal((await deliver(fs, evt('checkout.session.completed', s, NOW), NOW)).status, 200)
  const e = (await get(`events/${b.eventId}`))!
  assert.equal(e.accessMode, 'activated'); assert.equal(iso(e.activatedAt.toDate()), '2026-10-23T09:00:00.000Z'); assert.equal(iso(e.expiresAt.toDate()), '2027-10-23T09:00:00.000Z')
  assert.equal(e.expiresAt.toMillis() - e.activatedAt.toMillis(), 365 * DAY); assert.equal(e.purgeAfter.toMillis(), e.expiresAt.toMillis(), 'the scheduler finds it at expiresAt')
  assert.deepEqual([e.activation.source, e.activation.checkoutSessionId, e.activation.paymentIntentId, e.activation.amountCents, e.activation.currency], ['stripe', s.id, s.payment_intent, 1999, 'eur'])
  assert.ok(e.activation.stripeEventId); assert.deepEqual(e.retention, { days: 365, reminders: {} }, 'data model ready for the 30/7/1-day reminder e-mails')
  assert.equal(JSON.stringify(await get(`events/${a.eventId}`)), before, 'album A is byte-for-byte unchanged')
  assert.equal((await get(`users/${uid}`))!.plan.tier, 'free'); assert.equal((await get(`users/${uid}`))!.miolovePlan, undefined, 'no account-level premium state')
  const p = (await get(`users/${uid}/payments/${s.payment_intent}`))!; assert.deepEqual([p.kind, p.eventId, p.amountCents, p.status], ['album_activation', b.eventId, 1999, 'succeeded'])
  // replay: still one activation, activatedAt never rewritten
  const later = new Date(NOW.getTime() + 5 * DAY)
  assert.deepEqual((await deliver(fs, evt('checkout.session.completed', s, NOW), later)).body.received, true)
  const dup = paid(fs, uid, b.eventId); await deliver(fs, evt('checkout.session.completed', dup, later), later)
  const again = (await get(`events/${b.eventId}`))!; assert.equal(again.activatedAt.toMillis(), e.activatedAt.toMillis()); assert.equal(again.expiresAt.toMillis(), e.expiresAt.toMillis())
  assert.equal((await get(`users/${uid}/payments/${dup.payment_intent}`))!.activation, 'already_activated')
  assert.deepEqual([...fs.st.refunds.keys()], [`miolove-refund-${dup.payment_intent}`], 'ONLY the extra payment is refunded; the payment that activated the album (replayed) never is')
  assert.equal((await get(`users/${uid}/payments/${dup.payment_intent}`))!.status, 'refunded'); assert.equal((await get(`users/${uid}/payments/${s.payment_intent}`))!.status, 'succeeded')
})

test('MA-E. album C created months later: its own payment, its own 365 days — A and B keep theirs', async () => {
  const fs = fakeStripe(); const uid = await mkUser(); const a = await album(uid); const b = await album(uid)
  const T1 = new Date('2026-10-23T09:00:00Z'), T2 = new Date('2027-04-23T18:30:00Z')
  await pay(fs, uid, a.eventId, T1)                                                       // trial album paid during its trial: it becomes a normal paid album
  const c = await album(uid); await pay(fs, uid, c.eventId, T2)
  const [ea, eb, ec] = await Promise.all([a, b, c].map(async (x) => (await get(`events/${x.eventId}`))!))
  assert.equal(iso(ea.expiresAt.toDate()), '2027-10-23T09:00:00.000Z'); assert.equal(iso(ec.expiresAt.toDate()), '2028-04-22T18:30:00.000Z', '365 days after ITS payment')
  assert.equal(eb.accessMode, 'pending', 'B was never paid and is not affected'); assert.equal(eb.expiresAt, undefined)
  assert.notEqual(ea.expiresAt.toMillis(), ec.expiresAt.toMillis())
})

// ═══════════════════════════ expiry ═══════════════════════════

test('MA-F. expiry at now >= expiresAt: uploads denied (reason album_expired); the public payload closes; /screen + /booth + /live read the same flags; an open album still uploads', async () => {
  const uid = await mkUser(); const NOW = new Date('2027-11-01T10:00:00Z')
  const open = await plant(uid, { accessMode: 'activated', activatedAt: ago(NOW, 100), expiresAt: new Date(NOW.getTime() + 265 * DAY), status: 'live' })
  const gone = await plant(uid, { accessMode: 'activated', activatedAt: ago(NOW, 366), expiresAt: ago(NOW, 1), status: 'live' })
  const edge = await plant(uid, { accessMode: 'activated', activatedAt: ago(NOW, 365), expiresAt: NOW, status: 'live' })
  assert.ok((await upload('g1', open, NOW)).photoId, 'inside its 365 days it uploads')
  assert.equal(await reason(upload('g2', gone, NOW)), 'failed-precondition:miolove_album_expired')
  assert.equal(await reason(upload('g3', edge, NOW)), 'failed-precondition:miolove_album_expired', 'the instant expiresAt is reached')
  const pub = await getPublicEvent(db, (await get(`events/${gone}`))!.slug, NOW)
  assert.deepEqual([pub.session.album_phase, pub.session.uploads_closed, pub.session.access_mode], ['expired', true, 'activated']); assert.ok(pub.session.expires_at)
  const pubOpen = await getPublicEvent(db, (await get(`events/${open}`))!.slug, NOW); assert.deepEqual([pubOpen.session.album_phase, pubOpen.session.uploads_closed], ['active', false])
})

// ═══════════════════════════ purge ═══════════════════════════

const put = (path: string, data = 'x') => bucket.file(path).save(Buffer.from(data), { contentType: 'application/octet-stream' })
const exists = async (path: string) => (await bucket.file(path).exists())[0]
const prefixCount = async (eid: string) => (await bucket.getFiles({ prefix: `events/${eid}/` }))[0].length
/** A rich album: 3 media (original + optimized + thumb), an export ZIP, a winner photo, a temp file, request/dedication docs, a guest anti-spam doc. */
async function richAlbum(uid: string, over: Record<string, unknown>) {
  const eid = await plant(uid, { title: 'Nozze Anna e Marco', description: 'private', guestConfig: { live_booth: true }, status: 'live', ...over })
  for (let i = 0; i < 3; i++) {
    const pid = `ph${i}`
    await seedSet(`events/${eid}/photos/${pid}`, { guestUid: 'g', status: 'approved', storagePath: `events/${eid}/photos/${pid}/original.jpg`, optimizedPath: `events/${eid}/photos/${pid}/optimized.jpg`, thumbPath: `events/${eid}/photos/${pid}/thumb.jpg`, mediaType: 'photo' })
    for (const f of ['original.jpg', 'optimized.jpg', 'thumb.jpg']) await put(`events/${eid}/photos/${pid}/${f}`)
  }
  await put(`events/${eid}/exports/x1/album.zip`); await put(`events/${eid}/winner/bride-abcdefghijkl.jpg`); await put(`events/${eid}/tmp/leftover.bin`)
  await seedSet(`events/${eid}/exports/x1`, { status: 'ready', zipPath: `events/${eid}/exports/x1/album.zip` }); await seedSet(`events/${eid}/photoGuests/g`, { count: 3 })
  await seedSet(`events/${eid}/requests/r1`, { trackTitle: 'x' }); await seedSet(`events/${eid}/dedications/d1`, { message: 'hello' })
  return eid
}
const counts = async (eid: string) => Object.fromEntries(await Promise.all(['photos', 'exports', 'photoGuests', 'requests', 'dedications'].map(async (c) => [c, (await db.collection(`events/${eid}/${c}`).get()).size])))

test('MA-G. PURGE of a paid album at 365 days: EVERY Storage object and EVERY Firestore subcollection goes; payments / audit / reservation stay; tombstone is hidden; idempotent', async () => {
  const fs = fakeStripe(); const uid = await mkUser(); const NOW = new Date('2027-10-24T03:30:00Z')
  const a = await album(uid)
  const act = new Date('2026-10-23T09:00:00Z'); await pay(fs, uid, a.eventId, act)                                 // real activation → real expiresAt 2027-10-23T09:00Z
  const eid = a.eventId; const slug = (await get(`events/${eid}`))!.slug
  for (let i = 0; i < 3; i++) {
    const pid = `ph${i}`
    await seedSet(`events/${eid}/photos/${pid}`, { guestUid: 'g', status: 'approved', storagePath: `events/${eid}/photos/${pid}/original.jpg`, optimizedPath: `events/${eid}/photos/${pid}/optimized.jpg`, thumbPath: `events/${eid}/photos/${pid}/thumb.jpg` })
    for (const f of ['original.jpg', 'optimized.jpg', 'thumb.jpg']) await put(`events/${eid}/photos/${pid}/${f}`)
  }
  await put(`events/${eid}/exports/x1/album.zip`); await put(`events/${eid}/winner/bride-abcdefghijkl.jpg`); await put(`events/${eid}/tmp/leftover.bin`)
  await seedSet(`events/${eid}/exports/x1`, { status: 'ready' }); await seedSet(`events/${eid}/requests/r1`, { trackTitle: 'x' }); await seedSet(`events/${eid}/photoGuests/g`, { count: 3 })
  const other = await richAlbum(uid, { accessMode: 'activated', activatedAt: new Date(), expiresAt: new Date(NOW.getTime() + 100 * DAY), purgeAfter: new Date(NOW.getTime() + 100 * DAY) })   // a LIVE album of the same account
  assert.equal(await prefixCount(eid), 3 * 3 + 3, 'fixture: 12 objects')

  // one day before: nothing
  await run(new Date('2027-10-23T08:59:59Z')); assert.equal(await prefixCount(eid), 12); assert.equal((await get(`events/${eid}`))!.accessMode, 'activated', 'one second before expiresAt: untouched')
  const sum = await run(NOW)
  assert.ok(sum.purged >= 1 && sum.failed === 0, JSON.stringify(sum))
  assert.equal(await prefixCount(eid), 0, 'originals, optimized, thumbnails, ZIP, winner photo and temp file are ALL gone from Storage')
  assert.deepEqual(await counts(eid), { photos: 0, exports: 0, photoGuests: 0, requests: 0, dedications: 0 }, 'media docs and every other subcollection are gone')
  const t = (await get(`events/${eid}`))!
  assert.deepEqual([t.accessMode, t.status, t.deletedBy, t.ownerUid, t.brand], ['purged', 'ended', 'system:purge', uid, 'miolove'])
  assert.ok(t.purgedAt && t.deletedAt, 'hidden from the owner\'s list (deletedAt) and marked purged')
  for (const f of ['title', 'description', 'coupleNames', 'venueName', 'weddingDate', 'guestConfig', 'screenConfig', 'purgeAfter', 'expiresAt', 'slug']) assert.equal((t as any)[f], undefined, `tombstone keeps no ${f}`)
  assert.ok(t.activation.paymentIntentId && t.activatedAt, 'activation proof kept'); assert.equal(t.purge.state, 'done'); assert.equal(t.purge.reason, 'album_expired'); assert.equal(iso(t.purge.expiresAt.toDate()), '2027-10-23T09:00:00.000Z')
  assert.equal((await db.doc(`eventSlugs/${slug}`).get()).exists, false, 'the public link / QR no longer resolves')
  await assert.rejects(getPublicEvent(db, slug), (e: any) => e.details?.reason === 'event_not_found')
  // administrative data survives
  assert.equal((await db.collection(`users/${uid}/payments`).get()).size, 1, 'payment record kept'); assert.ok((await db.collection('mioloveStripeEvents').get()).size >= 1, 'Stripe event ledger kept'); assert.equal((await get(`trialAlbums/${uid}`))!.eventId, eid)
  // the live album of the same account is untouched
  assert.equal(await prefixCount(other), 12); assert.equal((await counts(other)).photos, 3); assert.equal((await get(`events/${other}`))!.accessMode, 'activated')
  // idempotent: a second run / a direct second call does nothing and does not throw
  const second = await run(new Date(NOW.getTime() + DAY)); assert.equal(second.failed, 0)
  assert.equal(await purgeAlbum(db, db.doc(`events/${eid}`), NOW), 'skipped'); assert.equal((await get(`events/${eid}`))!.purge.state, 'done')
  // a purged album can never be restored, bought again or re-opened
  assert.equal(await reason(restoreEvent(db, req(uid), { eventId: eid })), 'not-found:event_not_found')
  const fs2 = fakeStripe()
  assert.equal(await reason(createAlbumCheckoutSession(db, fs2.api, MPRICES, CFG, auth(uid), { eventId: eid, locale: 'it' })), 'not-found:event_not_found')
  assert.equal(await reason(upload('g', eid, NOW)), 'not-found:event_not_found')
})

test('MA-G2. PARTIAL FAILURE: a Storage failure leaves the album un-purged and retryable; a busy lease is respected; the next run resumes and finishes', async () => {
  const uid = await mkUser(); const NOW = new Date('2027-10-24T03:30:00Z')
  const eid = await richAlbum(uid, { accessMode: 'activated', activatedAt: ago(NOW, 366), expiresAt: ago(NOW, 1), purgeAfter: ago(NOW, 1) })
  const broken = { deletePrefix: async (prefix: string) => { const [files] = await bucket.getFiles({ prefix }); await files[0].delete(); throw new Error('storage_unavailable') }, countPrefix: async () => 99 }
  const r1 = await run(NOW, { storage: broken }); assert.equal(r1.failed >= 1, true, JSON.stringify(r1))
  let e = (await get(`events/${eid}`))!
  assert.equal(e.accessMode, 'activated', 'NOT marked purged while files are left'); assert.equal(e.purge.state, 'failed'); assert.equal(e.purge.error, 'storage_unavailable'); assert.equal(e.title, 'Nozze Anna e Marco', 'content still described, nothing half-hidden')
  assert.equal(await prefixCount(eid) > 0, true); assert.equal((await counts(eid)).photos, 3, 'Firestore is only touched AFTER Storage succeeded')
  assert.equal(await reason(createAlbumCheckoutSession(db, fakeStripe().api, MPRICES, CFG, auth(uid), { eventId: eid, locale: 'it' })), 'not-found:event_not_found', 'an album being purged cannot be bought')
  // a live lease (another run in progress) is respected
  await db.doc(`events/${eid}`).update({ purge: { state: 'running', lockedUntil: new Date(NOW.getTime() + 600_000), attempts: 1 } })
  assert.equal(await purgeAlbum(db, db.doc(`events/${eid}`), NOW), 'busy'); assert.equal((await counts(eid)).photos, 3)
  // lease expired (crashed run): the next run resumes and completes
  await db.doc(`events/${eid}`).update({ 'purge.lockedUntil': new Date(NOW.getTime() - 1000) })
  const r2 = await run(new Date(NOW.getTime() + DAY)); assert.equal(r2.purged >= 1, true, JSON.stringify(r2))
  e = (await get(`events/${eid}`))!; assert.deepEqual([e.accessMode, e.purge.state], ['purged', 'done']); assert.equal(await prefixCount(eid), 0); assert.deepEqual(await counts(eid), { photos: 0, exports: 0, photoGuests: 0, requests: 0, dedications: 0 })
})

// ═══════════════════════════ trial: pause, 30-day recovery, purge ═══════════════════════════

test('MA-H1. trial over: uploads closed, album paused (media kept), still purchasable for 30 days; paying inside the window KEEPS the media and starts the 365 days at payment time', async () => {
  const fs = fakeStripe(); const uid = await mkUser(); const a = await album(uid)
  const e0 = (await get(`events/${a.eventId}`))!; const end = e0.trialExpiresAt.toDate()
  const T8 = new Date(end.getTime() + 1 * DAY)                                                    // day 8: trial over
  assert.equal(await reason(upload('g', a.eventId, T8)), 'failed-precondition:miolove_trial_expired')
  const pub = await getPublicEvent(db, e0.slug, T8); assert.deepEqual([pub.session.album_phase, pub.session.uploads_closed, pub.session.trial_expired], ['trial_ended', true, true])
  await seedSet(`events/${a.eventId}/photos/keep1`, { guestUid: 'g', status: 'approved', storagePath: `events/${a.eventId}/photos/keep1/original.jpg` }); await put(`events/${a.eventId}/photos/keep1/original.jpg`)
  // purge job at day 8 and day 36 (still inside 30 days after the end): nothing
  for (const t of [T8, new Date(end.getTime() + 29 * DAY)]) { await run(t); assert.equal(await prefixCount(a.eventId), 1, 'media kept during the recovery window') }
  // checkout still allowed (owner), then the webhook inside the window activates and KEEPS everything
  assert.equal(await reason(createAlbumCheckoutSession(db, fs.api, MPRICES, CFG, auth(uid), { eventId: a.eventId, locale: 'it' }, () => new Date(end.getTime() + 20 * DAY))), 'ok')
  const payAt = new Date(end.getTime() + 20 * DAY); await pay(fs, uid, a.eventId, payAt)
  const e = (await get(`events/${a.eventId}`))!
  assert.equal(e.accessMode, 'activated'); assert.equal(e.activatedAt.toMillis(), payAt.getTime(), 'activatedAt = the moment of payment'); assert.equal(e.expiresAt.toMillis(), payAt.getTime() + 365 * DAY)
  assert.equal(e.purgeAfter.toMillis(), e.expiresAt.toMillis(), 'the trial purge date is replaced by the album\'s'); assert.equal(await prefixCount(a.eventId), 1); assert.ok((await get(`events/${a.eventId}/photos/keep1`)))
  // long after the trial's own purge date it is NOT purged: it is a paid album now
  await run(new Date(end.getTime() + 60 * DAY)); assert.equal(await prefixCount(a.eventId), 1); assert.equal((await get(`events/${a.eventId}`))!.accessMode, 'activated')
  assert.ok((await upload('g', a.eventId, new Date(end.getTime() + 60 * DAY))).photoId, 'and it takes uploads again')
})

test('MA-H2. trial NOT activated within 30 days: media and album content are deleted for good; a late / stale payment cannot revive it', async () => {
  const fs = fakeStripe(); const uid = await mkUser(); const a = await album(uid); const e0 = (await get(`events/${a.eventId}`))!; const end = e0.trialExpiresAt.toDate()
  await put(`events/${a.eventId}/photos/t1/original.jpg`); await put(`events/${a.eventId}/photos/t1/thumb.jpg`)
  await seedSet(`events/${a.eventId}/photos/t1`, { guestUid: 'g', status: 'approved', storagePath: `events/${a.eventId}/photos/t1/original.jpg`, thumbPath: `events/${a.eventId}/photos/t1/thumb.jpg` })
  const day31 = new Date(end.getTime() + 30 * DAY)                                                // exactly end + 30 days: due
  // a stale Checkout Session paid after the window: blocked, recorded, nothing activated
  assert.equal(await reason(createAlbumCheckoutSession(db, fs.api, MPRICES, CFG, auth(uid), { eventId: a.eventId, locale: 'it' }, () => new Date(day31.getTime() + 1000))), 'failed-precondition:album_not_eligible')
  const late = paid(fs, uid, a.eventId); await deliver(fs, evt('checkout.session.completed', late, day31), new Date(day31.getTime() + 1000))
  assert.equal((await get(`events/${a.eventId}`))!.accessMode, 'trial'); assert.match(String((await get(`users/${uid}/payments/${late.payment_intent}`))!.activation), /blocked:album_not_eligible/)
  // …and the money goes back, once: full refund, idempotency key from the payment, replay / retry never refunds twice, a Stripe failure is retried (500) and recorded
  const lp = (await get(`users/${uid}/payments/${late.payment_intent}`))!; assert.deepEqual([lp.status, lp.refund.status, fs.st.refunds.size], ['refunded', 'succeeded', 1])
  assert.deepEqual([...fs.st.refunds.keys()], [`miolove-refund-${late.payment_intent}`]); assert.equal(fs.st.refunds.get(`miolove-refund-${late.payment_intent}`).params.payment_intent, late.payment_intent)
  await deliver(fs, evt('checkout.session.completed', late, day31), new Date(day31.getTime() + 2000)); assert.equal(fs.st.refunds.size, 1, 'another event for the same payment: still one refund')
  fs.st.failRefund = true; const late2 = paid(fs, uid, a.eventId)
  assert.equal((await deliver(fs, evt('checkout.session.completed', late2, day31), new Date(day31.getTime() + 3000))).status, 500, 'refund failure → Stripe retries')
  assert.equal((await get(`users/${uid}/payments/${late2.payment_intent}`))!.refund.status, 'failed'); fs.st.failRefund = false
  const retry = evt('checkout.session.completed', late2, day31); assert.equal((await deliver(fs, retry, new Date(day31.getTime() + 4000))).status, 200)
  assert.equal((await get(`users/${uid}/payments/${late2.payment_intent}`))!.status, 'refunded'); assert.equal(fs.st.refunds.size, 2)
  const sum = await run(day31); assert.ok(sum.purged >= 1, JSON.stringify(sum))
  const t = (await get(`events/${a.eventId}`))!; assert.deepEqual([t.accessMode, t.purge.reason, t.deletedBy], ['purged', 'trial_lapsed', 'system:purge'])
  assert.equal(await prefixCount(a.eventId), 0); assert.equal((await counts(a.eventId)).photos, 0)
  assert.equal((await get(`trialAlbums/${uid}`))!.eventId, a.eventId, 'the account\'s one trial stays consumed: a new album is pending')
  assert.equal((await get(`events/${(await album(uid)).eventId}`))!.accessMode, 'pending')
  assert.equal((await db.collection(`users/${uid}/payments`).get()).size, 2, 'the blocked payments stay in the ledger, marked refunded')
  // the owner\'s list never shows it
  const listed = (await db.collection('events').where('ownerUid', '==', uid).get()).docs.filter((d: any) => !d.data().deletedAt)
  assert.equal(listed.some((d: any) => d.id === a.eventId), false)
})

// ═══════════════════════════ security ═══════════════════════════

test('MA-I. security: only the owner buys, only their own album; anonymous / non-owner / missing / activated / purged / IOMIXO are all refused and Stripe is never called', async () => {
  const fs = fakeStripe(); const uid = await mkUser(), other = await mkUser(); const a = await album(uid); const b = await album(uid)
  const call = (u: AuthLike | undefined, eventId: string) => reason(createAlbumCheckoutSession(db, fs.api, MPRICES, CFG, u, parseAlbumCheckoutInput({ eventId, locale: 'it' })))
  assert.equal(await call(undefined, b.eventId), 'unauthenticated:account_required'); assert.equal(await call(auth(uid, 'anonymous'), b.eventId), 'unauthenticated:account_required')
  assert.equal(await call(auth(other), b.eventId), 'not-found:event_not_found'); assert.equal(await call(auth(uid), 'nope'), 'not-found:event_not_found')
  const act = await plant(uid, { accessMode: 'activated', activatedAt: new Date(), expiresAt: new Date(Date.now() + DAY) })
  assert.equal(await call(auth(uid), act), 'failed-precondition:already_activated', 'an active album cannot be bought twice by accident')
  const expiredPaid = await plant(uid, { accessMode: 'activated', activatedAt: ago(new Date(), 400), expiresAt: ago(new Date(), 35) })
  assert.equal(await call(auth(uid), expiredPaid), 'failed-precondition:already_activated', 'an expired paid album is not re-sold here')
  const purged = await plant(uid, { accessMode: 'purged', purgedAt: new Date(), deletedAt: new Date() }); assert.equal(await call(auth(uid), purged), 'not-found:event_not_found')
  const io = await plant(uid, { type: 'party', brand: 'iomixo', accessMode: undefined }); assert.equal(await call(auth(uid), io), 'permission-denied:not_miolove_album')
  assert.equal(fs.st.calls.length, 0, 'Stripe was never reached by a refused call')
  // the allowed one: exactly this album, its id in the metadata and the success URL
  assert.equal(await call(auth(uid), b.eventId), 'ok'); const p = fs.st.created[0]
  assert.deepEqual([p.metadata.eventId, p.client_reference_id, p.mode], [b.eventId, b.eventId, 'payment']); assert.match(p.success_url, new RegExp(`/sessions/${b.eventId}\\?payment=success`))
  // webhook: metadata naming somebody else's album / an album of another uid activates nothing
  const NOW = new Date('2026-10-23T09:00:00Z'); const victim = await mkUser(); const va = await album(victim)
  await deliver(fs, evt('checkout.session.completed', paid(fs, uid, va.eventId), NOW), NOW)
  assert.equal((await get(`events/${va.eventId}`))!.accessMode, 'trial', 'buyer ≠ owner: nothing activated'); assert.equal(fs.st.refundCalls, 1, 'the payer is refunded (nothing activated); an inconsistent / unknown buyer is left to a human instead')
  await deliver(fs, evt('checkout.session.completed', paid(fs, uid, 'doesnotexist'), NOW), NOW)
  await deliver(fs, evt('checkout.session.completed', paid(fs, uid, purged), NOW), NOW); assert.equal((await get(`events/${purged}`))!.accessMode, 'purged', 'a stale Checkout Session cannot bring a purged album back')
  assert.equal((await get(`events/${a.eventId}`))!.accessMode, 'trial')
})

test('MA-J. IOMIXO is never purged, backfilled or expired by the album lifecycle, whatever date fields it carries', async () => {
  const uid = await mkUser('dj'); const NOW = new Date('2030-01-01T00:00:00Z')
  const party = await plant(uid, { type: 'party', brand: 'iomixo', accessMode: undefined, expiresAt: ago(NOW, 500), purgeAfter: ago(NOW, 500), activatedAt: ago(NOW, 900) })
  const djWedding = await plant(uid, { type: 'wedding', brand: 'iomixo', accessMode: 'activated', expiresAt: ago(NOW, 500), purgeAfter: ago(NOW, 500), activatedAt: ago(NOW, 900) })
  const std = await plant(uid, { type: 'standard', brand: 'iomixo', accessMode: undefined, purgeAfter: ago(NOW, 10) })
  await put(`events/${party}/photos/p/original.jpg`); await seedSet(`events/${party}/requests/r1`, { trackTitle: 'x' })
  await run(NOW)
  for (const e of [party, djWedding, std]) { const d = (await get(`events/${e}`))!; assert.equal(d.purgedAt, undefined, e); assert.equal(d.deletedAt, undefined); assert.equal(d.status, 'live') }
  assert.equal(await exists(`events/${party}/photos/p/original.jpg`), true); assert.equal((await get(`events/${party}/requests/r1`))!.trackTitle, 'x')
  const rep = await backfillAlbumExpiry(db, { apply: true }); assert.equal(rep.changes.some((c) => [party, djWedding, std].includes(c.id)), false)
  assert.equal((await get(`events/${djWedding}`))!.expiresAt.toMillis(), ago(NOW, 500).getTime(), 'untouched')
})

// ═══════════════════════════ existing production data ═══════════════════════════

test('MA-K. BACKFILL: an activated album with activatedAt and no expiresAt gets activatedAt + 365 days (NOT today); trial albums get their purge date; dry-run writes nothing; unknown dates are reported, never invented', async () => {
  const uid = await mkUser(); const act = new Date('2026-03-10T08:00:00Z')
  const old = await plant(uid, { accessMode: 'activated', activatedAt: act })
  const noDate = await plant(uid, { accessMode: 'activated' })
  const done = await plant(uid, { accessMode: 'activated', activatedAt: act, expiresAt: new Date('2027-03-10T08:00:00Z'), purgeAfter: new Date('2027-03-10T08:00:00Z') })
  const tEnd = new Date('2026-09-01T00:00:00Z'); const trialOld = await plant(uid, { accessMode: 'trial', trialExpiresAt: tEnd, trialPhotoCount: 2 })
  const trialLegacy = await plant(uid, { accessMode: 'trial', trialPhotoCount: 2 })
  const dry = await backfillAlbumExpiry(db); assert.equal(dry.applied, false)
  assert.equal((await get(`events/${old}`))!.expiresAt, undefined, 'dry run writes nothing'); assert.ok(dry.changes.some((c) => c.id === old))
  const rep = await backfillAlbumExpiry(db, { apply: true })
  const e = (await get(`events/${old}`))!
  assert.equal(iso(e.expiresAt.toDate()), '2027-03-10T08:00:00.000Z', 'activatedAt + 365 days'); assert.equal(e.purgeAfter.toMillis(), e.expiresAt.toMillis())
  assert.equal(iso((await get(`events/${trialOld}`))!.purgeAfter.toDate()), '2026-10-01T00:00:00.000Z', 'trial end + 30 days')
  assert.equal((await get(`events/${trialLegacy}`))!.purgeAfter, undefined, 'a trial without an end date never expires')
  assert.equal((await get(`events/${noDate}`))!.expiresAt, undefined); assert.ok(rep.activatedWithoutDate.includes(noDate))
  assert.equal((await get(`events/${done}`))!.expiresAt.toMillis(), new Date('2027-03-10T08:00:00Z').getTime(), 'already filled: untouched')
  const again = await backfillAlbumExpiry(db, { apply: true }); assert.equal(again.changes.filter((c) => [old, trialOld].includes(c.id)).length, 0, 'idempotent')
})

// ═══════════════════════════ Firestore rules ═══════════════════════════

test('MA-L. rules: the owner lists ALL their albums (trial + pending + paid); a guest can open a pending album\'s public doc but never write; a purged tombstone is unreadable by everyone', async () => {
  const owner = await newClient('account'), guest = await newClient('anonymous'), stranger = await newClient('account')
  try {
    await seedSet(`users/${owner.uid}`, { uid: owner.uid, email: owner.email, accountType: 'couple', plan: { tier: 'free', source: 'default' } })
    const a = await album(owner.uid), b = await album(owner.uid); const paidId = await plant(owner.uid, { accessMode: 'activated', activatedAt: new Date(), expiresAt: new Date(Date.now() + DAY) })
    const mine = await getDocs(query(collection(owner.db, 'events'), where('ownerUid', '==', owner.uid)))
    assert.deepEqual(mine.docs.map((d) => d.data().accessMode).sort(), ['activated', 'pending', 'trial'])
    assert.equal((await getDoc(doc(guest.db, 'events', b.eventId))).data()!.accessMode, 'pending', 'public doc of a pending album')
    assert.ok(await denied(getDocs(collection(guest.db, 'events', b.eventId, 'photos'))), 'guests list only approved media (no filter = denied)')
    assert.ok(await denied(getDocs(query(collection(stranger.db, 'events'), where('ownerUid', '==', owner.uid)))), 'a stranger cannot list somebody else\'s albums')
    // purge one → tombstone
    const T = new Date(Date.now() + 800 * DAY); await db.doc(`events/${paidId}`).update({ expiresAt: new Date(Date.now() - DAY), purgeAfter: new Date(Date.now() - DAY) })
    await run(T)
    assert.equal((await get(`events/${paidId}`))!.accessMode, 'purged')
    assert.ok(await denied(getDoc(doc(owner.db, 'events', paidId))), 'owner cannot read the tombstone'); assert.ok(await denied(getDoc(doc(guest.db, 'events', paidId))))
    void a
  } finally { await Promise.all([owner, guest, stranger].map(closeClient)) }
})
