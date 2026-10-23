import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { seedSet, eventFields } from './seed'
import { buildMiolovePriceTable } from '../../../../firebase/functions/src/billing/prices'
import { handleMioloveWebhook } from '../../../../firebase/functions/src/billing/mioloveWebhook'
import { createEvent, parseCreateEventInput } from '../../../../firebase/functions/src/owner/sessions'
import { purgeAlbum } from '../../../../firebase/functions/src/albums/purge'
import { OUTBOX, BACKOFF_MS, LEASE_MS, MAX_ATTEMPTS, drainOutbox, enqueueMioloveMail, enqueueMioloveMailSafe, processOutboxItem, scanMailTriggers, type OutboxDeps } from '../../../../firebase/functions/src/mail/miolove/outbox'
import { setMailLocale, parseSetMailLocaleInput } from '../../../../firebase/functions/src/mail/miolove/locale'
import { MailError, dryRunTransport, resendTransport, type MailMessage, type MailTransport } from '../../../../firebase/functions/src/mail/transport'
import { newClient, closeClient, denied } from './helpers'
import { collection, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore'

/**
 * MIOLOVE automatic e-mails against the real Firestore + Auth emulators. NOTHING is sent: transports are the in-memory dry-run / scripted fakes, Resend itself is tested with a fake fetch.
 * Covers queuing (trial / activation / purge / daily scan), idempotency, retries, leases, per-album isolation, IOMIXO separation, languages and the locale callable.
 */
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'; process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'; process.env.GCLOUD_PROJECT = 'demo-iomixo'
const fnReq = createRequire(__dirname + '/../../../../firebase/functions/package.json')
const { initializeApp, getApps } = fnReq('firebase-admin/app')
const { getFirestore, Timestamp } = fnReq('firebase-admin/firestore')
const { getAuth } = fnReq('firebase-admin/auth')
const Stripe = fnReq('stripe')
if (!getApps().length) initializeApp({ projectId: 'demo-iomixo' })
const db = getFirestore(), adminAuth = getAuth()

const DAY = 86_400_000
const MIO_SECRET = 'whsec_miolove_secret'
const P = { ALB_EUR: 'price_ALBEUR000001', ALB_USD: 'price_ALBUSD000001' }
const MPRICES = buildMiolovePriceTable({ STRIPE_PRICE_MIOLOVE_ALBUM_EUR: P.ALB_EUR, STRIPE_PRICE_MIOLOVE_ALBUM_USD: P.ALB_USD })
let n = 0
const id = (p: string) => `${p}${Date.now().toString(36)}${n++}`
const req = (uid: string) => ({ auth: { uid, token: { email: `${uid}@example.com`, firebase: { sign_in_provider: 'password' } } } })
const get = async (path: string) => (await db.doc(path).get()).data()
/** A real Auth user + its account document (the e-mail address is read from Auth, as in production). */
async function mkUser(locale?: string) {
  const uid = id('mu'); await adminAuth.createUser({ uid, email: `${uid}@example.com` })
  await seedSet(`users/${uid}`, { uid, email: `${uid}@example.com`, accountType: 'couple', plan: { tier: 'free', source: 'default' }, ...(locale ? { locale } : {}), createdAt: new Date(), updatedAt: new Date() })
  return uid
}
async function plant(ownerUid: string, over: Record<string, unknown>) {
  const eid = id('pl'); await seedSet(`events/${eid}`, eventFields(ownerUid, `slug${eid}`, { type: 'wedding', brand: 'miolove', title: `Album ${eid}`, ...over })); await seedSet(`eventSlugs/slug${eid}`, { eventId: eid })
  return eid
}
const resolveRecipient = async (uid: string) => (await adminAuth.getUser(uid).catch(() => null))?.email ?? null
const deps = (transport: MailTransport, now: Date = new Date()): OutboxDeps => ({ db, transport, resolveRecipient, baseUrl: 'https://miolovealbum.com', now: () => now })
const box = async (key: string) => get(`${OUTBOX}/${key}`)
const boxOf = async (eventId: string) => (await db.collection(OUTBOX).where('eventId', '==', eventId).get()).docs.map((d) => ({ id: d.id, ...d.data() })) as any[]
const scripted = (results: Array<'ok' | MailError>) => { const sent: MailMessage[] = []; let i = 0; return { sent, calls: () => i, async send(m: MailMessage) { const r = results[Math.min(i++, results.length - 1)]; if (r !== 'ok') throw r; sent.push(m); return { id: `re_${sent.length}` } } } }
const albumOf = (uid: string, over: Record<string, unknown> = {}) => createEvent(db, req(uid) as any, parseCreateEventInput({ requestId: id('r'), title: 'Album', type: 'wedding', brand: 'miolove', occasionType: 'birthday', ...over }))

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

// ═══════════════════════════ queuing ═══════════════════════════

test('MF-1. creating the FIRST album (trial) queues "trial started" for that album and stores the owner\'s language; a second (pending) album and an IOMIXO event queue nothing', async () => {
  const uid = await mkUser()
  const a = await albumOf(uid, { locale: 'fr', title: 'Mariage Léa' })
  assert.equal((await get(`users/${uid}`))!.locale, 'fr')
  const q = await box(`trial_started_${a.eventId}`)
  assert.deepEqual([q!.status, q!.kind, q!.eventId, q!.ownerUid, q!.vars.title], ['pending', 'trial_started', a.eventId, uid, 'Mariage Léa']); assert.ok(q!.vars.trialEndsAtMs > Date.now() + 6 * DAY)
  assert.equal(JSON.stringify(q).includes('@'), false, 'no e-mail address is stored in the outbox')
  const b = await albumOf(uid, { title: 'Second' }); assert.equal((await get(`events/${b.eventId}`))!.accessMode, 'pending'); assert.deepEqual(await boxOf(b.eventId), [], 'a pending album has no trial e-mail')
  const dj = await mkUser(); const iomixo = await createEvent(db, req(dj) as any, parseCreateEventInput({ requestId: id('r'), title: 'Club night', type: 'standard', brand: 'iomixo' }))
  assert.deepEqual(await boxOf(iomixo.eventId), [], 'IOMIXO never produces a MIOLOVE e-mail')
  assert.equal(await enqueueMioloveMailSafe(db, 'album_activated', iomixo.eventId), 'ignored')
})

test('MF-2. a paid activation queues "album activated" for THAT album only; a replayed webhook / double queue never makes a second e-mail', async () => {
  const uid = await mkUser(), fs = fakeStripe(), now = new Date()
  const a = await plant(uid, { accessMode: 'pending' }), other = await plant(uid, { accessMode: 'pending' })
  const e = evt('checkout.session.completed', paid(fs, uid, a), now)
  assert.equal((await deliver(fs, e, now)).status, 200)
  assert.equal((await box(`album_activated_${a}`))!.status, 'pending'); assert.deepEqual(await boxOf(other), [])
  assert.ok((await box(`album_activated_${a}`))!.vars.expiresAtMs > now.getTime() + 364 * DAY)
  await deliver(fs, e, now); await deliver(fs, evt('checkout.session.completed', paid(fs, uid, a), now), now)           // replay + a second payment for the same album
  assert.equal((await boxOf(a)).length, 1)
  assert.equal(await enqueueMioloveMail(db, { kind: 'album_activated', eventId: a, ownerUid: uid, vars: { title: 'x' } }), 'exists')
})

test('MF-2b. the activation e-mail carries what the VERIFIED Stripe session says was paid (EUR and USD); an unreliable amount leaves the figure out; nothing changes in the payment logic', async () => {
  const fs = fakeStripe(), now = new Date(), uid = await mkUser('en')
  const run = async (over: Record<string, unknown>) => { const a = await plant(uid, { accessMode: 'pending' }); assert.equal((await deliver(fs, evt('checkout.session.completed', paid(fs, uid, a, over), now), now)).status, 200); return a }
  const usd = await run({ amount_total: 1999, currency: 'usd' }), eur = await run({ amount_total: 1999, currency: 'eur' }), none = await run({ amount_total: null }), free = await run({ amount_total: 0, currency: 'eur', payment_status: 'no_payment_required' }), odd = await run({ amount_total: 19.99, currency: 'eur' })
  assert.deepEqual([(await box(`album_activated_${usd}`))!.vars.amountCents, (await box(`album_activated_${usd}`))!.vars.currency], [1999, 'usd'])
  assert.deepEqual([(await box(`album_activated_${eur}`))!.vars.amountCents, (await box(`album_activated_${eur}`))!.vars.currency], [1999, 'eur'])
  for (const a of [none, free, odd]) { const v = (await box(`album_activated_${a}`))!.vars; assert.equal(v.amountCents, undefined, 'no reliable amount'); assert.equal(v.currency, undefined) }
  for (const a of [usd, eur, none]) assert.equal((await get(`events/${a}`))!.accessMode, 'activated', 'activation itself is untouched')
  const t = dryRunTransport(), d = deps(t, now)
  for (const a of [usd, eur, none]) assert.equal(await processOutboxItem(d, `album_activated_${a}`), 'sent')
  const [mUsd, mEur, mNone] = t.sent.map((m) => (m.text + m.html).replace(/[\u00a0\u202f]/g, ' '))
  assert.match(mUsd, /Amount paid: \$19\.99\./); assert.match(mEur, /Amount paid: €19\.99\./); assert.doesNotMatch(mNone, /Amount paid/)
})

test('MF-3. the purge queues "album deleted" / "trial deleted" with the album\'s own title (the tombstone keeps none); an album the owner had already deleted gets no e-mail', async () => {
  const uid = await mkUser('es'), now = new Date()
  const paidOld = await plant(uid, { title: 'Boda de Ana', accessMode: 'activated', activatedAt: new Date(now.getTime() - 400 * DAY), expiresAt: new Date(now.getTime() - DAY), purgeAfter: new Date(now.getTime() - DAY) })
  const trialOld = await plant(uid, { title: 'Prueba', accessMode: 'trial', trialStartsAt: new Date(now.getTime() - 60 * DAY), trialExpiresAt: new Date(now.getTime() - 40 * DAY), purgeAfter: new Date(now.getTime() - 10 * DAY) })
  const mine = await plant(uid, { title: 'Borrado por mí', accessMode: 'activated', deletedAt: new Date(now.getTime() - 5 * DAY), activatedAt: new Date(now.getTime() - 400 * DAY), expiresAt: new Date(now.getTime() - DAY), purgeAfter: new Date(now.getTime() - DAY) })
  const noStorage = { deletePrefix: async () => 0, countPrefix: async () => 0 }
  for (const e of [paidOld, trialOld, mine]) assert.equal(await purgeAlbum(db, db.doc(`events/${e}`), now, noStorage), 'purged')
  assert.equal((await box(`album_deleted_${paidOld}`))!.vars.title, 'Boda de Ana'); assert.equal((await box(`trial_deleted_${trialOld}`))!.vars.title, 'Prueba'); assert.deepEqual(await boxOf(mine), [])
  const t = dryRunTransport(); assert.equal(await processOutboxItem(deps(t, now), `album_deleted_${paidOld}`), 'sent')
  assert.match(t.sent[0].subject, /Boda de Ana.*eliminado/); assert.match(t.sent[0].html, /lang="es"/)
})

// ═══════════════════════════ sending ═══════════════════════════

test('MF-4. sending: recipient from Auth, MIOLOVE sender + reply-to, the account\'s language (it by default), marked sent once; a second pass is a no-op', async () => {
  const fr = await mkUser('fr'), it = await mkUser()
  const a = await plant(fr, { accessMode: 'activated', title: 'Mariage', activatedAt: new Date(), expiresAt: new Date(Date.now() + 365 * DAY), purgeAfter: new Date(Date.now() + 365 * DAY) })
  const b = await plant(it, { accessMode: 'activated', title: 'Nozze', activatedAt: new Date(), expiresAt: new Date(Date.now() + 365 * DAY), purgeAfter: new Date(Date.now() + 365 * DAY) })
  await enqueueMioloveMailSafe(db, 'album_activated', a); await enqueueMioloveMailSafe(db, 'album_activated', b)
  const t = dryRunTransport(), d = deps(t)
  assert.equal(await processOutboxItem(d, `album_activated_${a}`), 'sent'); assert.equal(await processOutboxItem(d, `album_activated_${b}`), 'sent')
  const [m1, m2] = t.sent
  assert.equal(m1.to, `${fr}@example.com`); assert.equal(m1.from, 'MIOLOVE Album <info@miolovealbum.com>'); assert.equal(m1.replyTo, 'info@miolovealbum.com'); assert.equal(m1.idempotencyKey, `album_activated_${a}`)
  assert.match(m1.html, /lang="fr"/); assert.match(m1.subject, /est actif/); assert.match(m2.html, /lang="it"/); assert.match(m2.subject, /è attivo/); assert.match(m1.html, new RegExp(`/sessions/${a}\\?`)); assert.doesNotMatch(m1.html, new RegExp(b))
  const q = await box(`album_activated_${a}`); assert.deepEqual([q!.status, q!.attempts, q!.nextAttemptAt, q!.locale, q!.providerId], ['sent', 1, undefined, 'fr', 'dry-1'])
  assert.equal(await processOutboxItem(d, `album_activated_${a}`), 'noop'); assert.equal(t.sent.length, 2)
})

test('MF-5. concurrent workers (trigger + scheduler + retries) send ONE e-mail; a live lease is respected, an expired one is taken over', async () => {
  const uid = await mkUser(); const a = await plant(uid, { accessMode: 'activated', activatedAt: new Date(), expiresAt: new Date(Date.now() + 365 * DAY), purgeAfter: new Date(Date.now() + 365 * DAY) })
  await enqueueMioloveMailSafe(db, 'album_activated', a)
  const t = dryRunTransport(), key = `album_activated_${a}`
  const r = await Promise.all(Array.from({ length: 6 }, () => processOutboxItem(deps(t), key)))
  assert.equal(r.filter((x) => x === 'sent').length, 1); assert.equal(t.sent.length, 1)
  // a worker that died after claiming: lease alive → busy; lease over → resent (the provider drops it by idempotency key if it had gone out)
  const b = await plant(uid, { accessMode: 'activated', activatedAt: new Date(), expiresAt: new Date(Date.now() + 365 * DAY), purgeAfter: new Date(Date.now() + 365 * DAY) })
  await enqueueMioloveMailSafe(db, 'album_activated', b); const kb = `album_activated_${b}`, now = new Date()
  await db.doc(`${OUTBOX}/${kb}`).update({ status: 'sending', attempts: 1, nextAttemptAt: Timestamp.fromMillis(now.getTime() + 3 * 60_000) })
  assert.equal(await processOutboxItem(deps(t, now), kb), 'busy'); assert.equal(t.sent.length, 1)
  assert.equal(await processOutboxItem(deps(t, new Date(now.getTime() + LEASE_MS + 1000)), kb), 'sent'); assert.equal((await box(kb))!.attempts, 2)
})

test('MF-6. failures: retryable errors back off (5 min, 15 min, 1 h...) and finally succeed; a permanent error fails at once; after 6 attempts it is failed; never a duplicate', async () => {
  const uid = await mkUser(); const mk = async () => { const a = await plant(uid, { accessMode: 'activated', activatedAt: new Date(), expiresAt: new Date(Date.now() + 365 * DAY), purgeAfter: new Date(Date.now() + 365 * DAY) }); await enqueueMioloveMailSafe(db, 'album_activated', a); return `album_activated_${a}` }
  // transient: 429, then network, then ok
  const k1 = await mk(), t1 = scripted([new MailError('x', true, 'http_429'), new MailError('x', true, 'network'), 'ok']); let now = new Date()
  assert.equal(await processOutboxItem(deps(t1, now), k1), 'retry'); let q = (await box(k1))!
  assert.deepEqual([q.status, q.attempts, q.lastError, q.nextAttemptAt.toMillis() - now.getTime()], ['pending', 1, 'http_429', BACKOFF_MS[0]])
  assert.equal(await processOutboxItem(deps(t1, new Date(now.getTime() + 60_000)), k1), 'noop', 'not due yet')
  now = new Date(now.getTime() + BACKOFF_MS[0] + 1); assert.equal(await processOutboxItem(deps(t1, now), k1), 'retry'); q = (await box(k1))!; assert.equal(q.nextAttemptAt.toMillis() - now.getTime(), BACKOFF_MS[1])
  now = new Date(now.getTime() + BACKOFF_MS[1] + 1); assert.equal(await processOutboxItem(deps(t1, now), k1), 'sent'); q = (await box(k1))!; assert.deepEqual([q.status, q.attempts, q.lastError], ['sent', 3, undefined]); assert.equal(t1.sent.length, 1)
  // permanent (invalid address / payload): failed at the first attempt
  const k2 = await mk(), t2 = scripted([new MailError('x', false, 'http_422')]); assert.equal(await processOutboxItem(deps(t2), k2), 'failed'); q = (await box(k2))!; assert.deepEqual([q.status, q.lastError, q.nextAttemptAt, t2.calls()], ['failed', 'http_422', undefined, 1])
  assert.equal(await processOutboxItem(deps(t2, new Date(Date.now() + 99 * DAY)), k2), 'noop')
  // always failing: stops at MAX_ATTEMPTS
  const k3 = await mk(), t3 = scripted([new MailError('x', true, 'http_503')]); now = new Date(); let last = ''
  for (let i = 0; i < MAX_ATTEMPTS + 2; i++) { last = await processOutboxItem(deps(t3, now), k3); now = new Date(now.getTime() + 25 * 3_600_000) }
  q = (await box(k3))!; assert.deepEqual([q.status, q.attempts, t3.calls()], ['failed', MAX_ATTEMPTS, MAX_ATTEMPTS]); assert.equal(last, 'noop')
  // an unexpected (non-mail) error is retried too
  const k4 = await mk(), boom: OutboxDeps = { ...deps(dryRunTransport()), resolveRecipient: async () => { throw new Error('auth down') } }
  assert.equal(await processOutboxItem(boom, k4), 'retry'); assert.equal((await box(k4))!.status, 'pending')
})

test('MF-7. nothing to send to / nothing left to say: no e-mail address, trial paid meanwhile, album deleted by the owner → skipped (with the reason), never sent', async () => {
  const ghost = id('ghost'); await seedSet(`users/${ghost}`, { uid: ghost, accountType: 'couple', plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })      // no Auth account
  const uid = await mkUser(), t = dryRunTransport(), now = new Date()
  const g = await plant(ghost, { accessMode: 'activated', activatedAt: now, expiresAt: new Date(now.getTime() + 365 * DAY), purgeAfter: new Date(now.getTime() + 365 * DAY) }); await enqueueMioloveMailSafe(db, 'album_activated', g)
  assert.equal(await processOutboxItem(deps(t), `album_activated_${g}`), 'skipped'); assert.equal((await box(`album_activated_${g}`))!.skipReason, 'no_email')
  const tr = await plant(uid, { accessMode: 'trial', trialStartsAt: now, trialExpiresAt: new Date(now.getTime() + DAY), purgeAfter: new Date(now.getTime() + 31 * DAY) }); await enqueueMioloveMailSafe(db, 'trial_ending', tr)
  await db.doc(`events/${tr}`).update({ accessMode: 'activated' })                                                  // paid in the meantime
  assert.equal(await processOutboxItem(deps(t), `trial_ending_${tr}`), 'skipped'); assert.equal((await box(`trial_ending_${tr}`))!.skipReason, 'state_changed')
  const del = await plant(uid, { accessMode: 'activated', activatedAt: now, expiresAt: new Date(now.getTime() + 5 * DAY), purgeAfter: new Date(now.getTime() + 5 * DAY) }); await enqueueMioloveMailSafe(db, 'album_expiry_7', del)
  await db.doc(`events/${del}`).update({ deletedAt: new Date() })
  assert.equal(await processOutboxItem(deps(t), `album_expiry_7_${del}`), 'skipped'); assert.equal((await box(`album_expiry_7_${del}`))!.skipReason, 'album_gone'); assert.equal(t.sent.length, 0)
})

test('MF-8. drain: a pass over the queue sends what is due (including retries and expired leases) and leaves what is not', async () => {
  const uid = await mkUser(), now = new Date(); const ids: string[] = []
  for (let i = 0; i < 3; i++) { const a = await plant(uid, { accessMode: 'activated', activatedAt: now, expiresAt: new Date(now.getTime() + 365 * DAY), purgeAfter: new Date(now.getTime() + 365 * DAY) }); await enqueueMioloveMailSafe(db, 'album_activated', a, { now }); ids.push(a) }
  await db.doc(`${OUTBOX}/album_activated_${ids[2]}`).update({ nextAttemptAt: Timestamp.fromMillis(now.getTime() + 3_600_000) })           // backing off
  const t = dryRunTransport(); const sum = await drainOutbox(deps(t, now), 5000)
  assert.ok(sum.sent >= 2); const sentIds = t.sent.map((m) => m.idempotencyKey)
  assert.ok(sentIds.includes(`album_activated_${ids[0]}`) && sentIds.includes(`album_activated_${ids[1]}`)); assert.ok(!sentIds.includes(`album_activated_${ids[2]}`))
  assert.equal((await box(`album_activated_${ids[2]}`))!.status, 'pending')
  const later = await drainOutbox(deps(t, new Date(now.getTime() + 2 * 3_600_000)), 5000); assert.ok(sentIds.length < t.sent.length || later.sent >= 1); assert.equal((await box(`album_activated_${ids[2]}`))!.status, 'sent')
})

// ═══════════════════════════ daily scan ═══════════════════════════

test('MF-9. daily scan: every album gets ITS OWN reminder (30 / 7 / 1 days, trial end / deletion), stamped on the album, nothing for pending / IOMIXO / far-away albums, and a rerun queues nothing', async () => {
  const uid = await mkUser(), now = new Date('2027-03-10T07:00:00Z')
  const inDays = (d: number) => new Date(now.getTime() + d * DAY)
  const pa = (d: number, title: string) => plant(uid, { title, accessMode: 'activated', activatedAt: inDays(d - 365), expiresAt: inDays(d), purgeAfter: inDays(d) })
  const a30 = await pa(29, 'A30'), a7 = await pa(6, 'A7'), a1 = await pa(0.5, 'A1'), far = await pa(120, 'FAR'), a30b = await pa(25, 'A30B')
  const trEnding = await plant(uid, { title: 'T1', accessMode: 'trial', trialStartsAt: inDays(-5), trialExpiresAt: inDays(1.5), purgeAfter: inDays(31.5) })
  const trEnded = await plant(uid, { title: 'T2', accessMode: 'trial', trialStartsAt: inDays(-12), trialExpiresAt: inDays(-5), purgeAfter: inDays(25) })
  const trPurge = await plant(uid, { title: 'T3', accessMode: 'trial', trialStartsAt: inDays(-30), trialExpiresAt: inDays(-24), purgeAfter: inDays(6) })
  const pending = await plant(uid, { title: 'P', accessMode: 'pending' })
  const dj = await mkUser(); const djEv = await plant(dj, { title: 'DJ', brand: 'iomixo', type: 'party', accessMode: undefined, purgeAfter: inDays(3) })
  const r1 = await scanMailTriggers(db, now, { maxAlbums: 20_000, pageSize: 100 })
  assert.ok(r1.queued >= 7)
  const kinds = async (e: string) => (await boxOf(e)).map((x) => x.kind)
  assert.deepEqual(await kinds(a30), ['album_expiry_30']); assert.deepEqual(await kinds(a30b), ['album_expiry_30'], 'two albums of one owner: two independent e-mails')
  assert.deepEqual(await kinds(a7), ['album_expiry_7']); assert.deepEqual(await kinds(a1), ['album_expiry_1'])
  assert.deepEqual(await kinds(trEnding), ['trial_ending']); assert.deepEqual(await kinds(trEnded), ['trial_ended']); assert.deepEqual(await kinds(trPurge), ['trial_purge_soon'])
  for (const e of [far, pending, djEv]) assert.deepEqual(await boxOf(e), [], 'nothing due')
  assert.equal((await boxOf(a30))[0].vars.title, 'A30'); assert.equal((await boxOf(a30))[0].eventId, a30)
  assert.ok((await get(`events/${a30}`))!.retention.reminders.d30, 'stamped on the album'); assert.ok((await get(`events/${a1}`))!.retention.reminders.d1)
  const r2 = await scanMailTriggers(db, now, { maxAlbums: 20_000, pageSize: 100 }); assert.equal(r2.queued, 0, 'idempotent')
  // a week later the album moves into the next window: the 7-day e-mail (a new document), the 30-day one is untouched
  const week = new Date(now.getTime() + 22 * DAY); await scanMailTriggers(db, week, { maxAlbums: 20_000, pageSize: 100 })
  assert.deepEqual((await kinds(a30)).sort(), ['album_expiry_30', 'album_expiry_7'])
  // and the e-mail of one album reaches its owner with that album's link and the download tab
  const t = dryRunTransport(); await processOutboxItem(deps(t, now), `album_expiry_30_${a30}`)
  assert.match(t.sent[0].html, new RegExp(`/sessions/${a30}\\?tab=photos`)); assert.match(t.sent[0].subject, /A30/)
})

// ═══════════════════════════ locale callable + rules ═══════════════════════════

test('MF-10. setMailLocale: saves it/en/fr/es for the signed-in account only; garbage, anonymous callers and a missing account document are handled; clients can neither write the language nor read the outbox', async () => {
  const uid = await mkUser()
  for (const l of ['it', 'en', 'fr', 'es']) { assert.deepEqual(await setMailLocale(db, req(uid) as any, parseSetMailLocaleInput({ locale: l })), { saved: true }); assert.equal((await get(`users/${uid}`))!.locale, l) }
  for (const bad of [{ locale: 'de' }, { locale: '' }, {}, null, { locale: ['fr'] }]) assert.throws(() => parseSetMailLocaleInput(bad), /invalid locale/)
  await assert.rejects(setMailLocale(db, { auth: { uid, token: { firebase: { sign_in_provider: 'anonymous' } } } } as any, { locale: 'fr' }), /Account required/)
  await assert.rejects(setMailLocale(db, {} as any, { locale: 'fr' }), /Sign in/)
  assert.deepEqual(await setMailLocale(db, req(id('nodoc')) as any, { locale: 'fr' }), { saved: false }); assert.equal((await db.doc(`users/${id('nodoc')}`).get()).exists, false)
  const c = await newClient('account')
  try {
    await seedSet(`users/${c.uid}`, { uid: c.uid, email: c.email, accountType: 'couple', plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })
    assert.ok(await denied(updateDoc(doc(c.db, `users/${c.uid}`), { locale: 'fr', updatedAt: new Date() })), 'the language is server-written')
    assert.ok(await denied(getDocs(collection(c.db, OUTBOX))), 'outbox is server-only'); assert.ok(await denied(getDoc(doc(c.db, `${OUTBOX}/x`))))
  } finally { await closeClient(c) }
})

// ═══════════════════════════ Resend transport (fake fetch) ═══════════════════════════

test('MF-11. Resend transport: REST call with bearer key + idempotency key + MIOLOVE sender; maps the provider id; 5xx / 429 / 401 / 403 / network are retryable, other 4xx are final', async () => {
  const calls: any[] = []
  const mk = (status: number, body: unknown = {}) => resendTransport('re_test_key', (async (url: string, init: any) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status }) }) as any)
  const msg: MailMessage = { to: 'a@example.com', from: 'MIOLOVE Album <info@miolovealbum.com>', replyTo: 'info@miolovealbum.com', subject: 'S', html: '<p>h</p>', text: 't', idempotencyKey: 'album_activated_e1', tags: [{ name: 'brand', value: 'miolove' }] }
  assert.deepEqual(await mk(200, { id: 're_123' }).send(msg), { id: 're_123' })
  assert.equal(calls[0].url, 'https://api.resend.com/emails'); assert.equal(calls[0].init.headers.authorization, 'Bearer re_test_key'); assert.equal(calls[0].init.headers['idempotency-key'], 'album_activated_e1')
  const body = JSON.parse(calls[0].init.body); assert.deepEqual([body.from, body.to, body.reply_to, body.subject], ['MIOLOVE Album <info@miolovealbum.com>', ['a@example.com'], 'info@miolovealbum.com', 'S'])
  for (const [status, retry] of [[500, true], [503, true], [429, true], [401, true], [403, true], [400, false], [422, false], [404, false]] as const) {
    await assert.rejects(mk(status).send(msg), (e: any) => e instanceof MailError && e.retryable === retry && e.code === `http_${status}`, String(status))
  }
  await assert.rejects(resendTransport('k', (async () => { throw new Error('ECONNRESET') }) as any).send(msg), (e: any) => e instanceof MailError && e.retryable && e.code === 'network')
})

test('MF-13. allowlist (staging): only the allowed address is mailed; every other e-mail is HELD untouched (still pending, no attempt used, never skipped / sent) and goes out once the filter is lifted — even stale ones are not dropped meanwhile', async () => {
  const mine = await mkUser('it'), real = await mkUser('fr'), now = new Date()
  const act = { accessMode: 'activated', activatedAt: now, expiresAt: new Date(now.getTime() + 365 * DAY), purgeAfter: new Date(now.getTime() + 365 * DAY) }
  const a = await plant(mine, act), b = await plant(real, act), stale = await plant(real, { accessMode: 'trial', trialStartsAt: now, trialExpiresAt: new Date(now.getTime() + DAY), purgeAfter: new Date(now.getTime() + 31 * DAY) })
  for (const e of [a, b]) await enqueueMioloveMailSafe(db, 'album_activated', e, { now }); await enqueueMioloveMailSafe(db, 'trial_ending', stale, { now })
  await db.doc(`events/${stale}`).update({ accessMode: 'activated' })                                          // would be "skipped: state_changed" if it were looked at
  const t = dryRunTransport(), filtered: OutboxDeps = { ...deps(t, now), allowRecipient: (e) => e === `${mine}@example.com` }
  assert.equal(await processOutboxItem(filtered, `album_activated_${a}`), 'sent')
  assert.equal(await processOutboxItem(filtered, `album_activated_${b}`), 'held'); assert.equal(await processOutboxItem(filtered, `trial_ending_${stale}`), 'held')
  assert.deepEqual(t.sent.map((m) => m.to), [`${mine}@example.com`])
  for (const k of [`album_activated_${b}`, `trial_ending_${stale}`]) { const q = (await box(k))!; assert.deepEqual([q.status, q.attempts, q.skipReason, q.heldReason, q.nextAttemptAt.toMillis() - now.getTime()], ['pending', 0, undefined, 'recipient_not_allowed', 3_600_000], k) }
  assert.equal(await processOutboxItem(filtered, `album_activated_${b}`), 'noop', 'held: not looked at again before the hold is over')
  const sum = await drainOutbox(filtered, 5000); assert.equal(sum.sent, 0, 'a drain with the filter on sends nothing to anyone else'); assert.equal(t.sent.length, 1)
  // filter lifted (later): the held e-mails are processed normally — the real one is sent, the stale one is now correctly skipped
  const later = new Date(now.getTime() + 2 * 3_600_000), open = deps(t, later)
  assert.equal(await processOutboxItem(open, `album_activated_${b}`), 'sent'); assert.equal(t.sent[1].to, `${real}@example.com`)
  assert.equal(await processOutboxItem(open, `trial_ending_${stale}`), 'skipped'); assert.equal((await box(`trial_ending_${stale}`))!.skipReason, 'state_changed')
})

// ═══════════════════════════ the deployed trigger (functions emulator, MIOLOVE_MAIL_MODE=dry) ═══════════════════════════

test('MF-12. the Firestore trigger sends a freshly queued e-mail by itself (dry mode: nothing leaves); runs only when the emulator was started with MIOLOVE_MAIL_MODE=dry', { skip: process.env.MIOLOVE_MAIL_MODE !== 'dry' }, async () => {
  const uid = await mkUser('en'); const a = await albumOf(uid, { title: 'Trigger album' })
  const key = `trial_started_${a.eventId}`; let q: any
  for (let i = 0; i < 60; i++) { q = await box(key); if (q?.status === 'sent') break; await new Promise((r) => setTimeout(r, 500)) }
  assert.deepEqual([q.status, q.locale, String(q.providerId).startsWith('dry-'), q.nextAttemptAt], ['sent', 'en', true, undefined])
})
