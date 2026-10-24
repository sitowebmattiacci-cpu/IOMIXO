import { test as nodeTest } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { seedSet } from './seed'
import { AUTH_MAIL_COLLECTION, RESET_EMAIL_LIMITS, RESET_GLOBAL_LIMITS, RESET_IP_LIMITS, VERIFY_GLOBAL_LIMITS, reserveSlot, RESET_MIN_DURATION_MS, VERIFY_LIMITS, sendMioloveReset, sendMioloveVerification, type AuthMailDeps } from '../../../../firebase/functions/src/mail/miolove/authMail'
import { MAIL_LOCALES } from '../../../../firebase/functions/src/mail/miolove/templates'
import { MailError, dryRunTransport, type MailTransport } from '../../../../firebase/functions/src/mail/transport'

/**
 * MIOLOVE account e-mails (verification + password reset) against the real Auth + Firestore emulators. NOTHING is sent: the transport is the in-memory dry-run.
 * The links are the REAL ones the Admin SDK generates; the one-time code is then redeemed against the Auth emulator exactly as the /auth/action page does.
 */
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'; process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'; process.env.GCLOUD_PROJECT = 'demo-iomixo'
const fnReq = createRequire(__dirname + '/../../../../firebase/functions/package.json')
const { initializeApp, getApps } = fnReq('firebase-admin/app')
const { getFirestore } = fnReq('firebase-admin/firestore')
const { getAuth } = fnReq('firebase-admin/auth')
if (!getApps().length) initializeApp({ projectId: 'demo-iomixo' })
const db = getFirestore(), adminAuth = getAuth()

let n = 0
const clearGlobals = () => Promise.all(['g_verify', 'g_reset'].map((k) => db.collection('mioloveAuthMail').doc(k).delete()))
const test = (name: string, fn: () => Promise<void>) => nodeTest(name, async () => { await clearGlobals(); await fn() })
const id = (p: string) => `${p}${Date.now().toString(36)}${n++}`
const T0 = new Date('2026-10-24T09:00:00Z')
const mk = (over: Partial<AuthMailDeps> = {}, t: () => Date = () => T0) => {
  const transport = dryRunTransport()
  const deps: AuthMailDeps = { db, auth: adminAuth, transport, enabled: true, now: t, sleep: async () => {}, ...over }
  return { deps, transport }
}
async function user(type: 'couple' | 'dj' | 'none' = 'couple', extra: { locale?: string; verified?: boolean; disabled?: boolean } = {}) {
  const uid = id('au'), email = `${uid}@example.com`
  await adminAuth.createUser({ uid, email, password: 'secret123', emailVerified: !!extra.verified, disabled: !!extra.disabled })
  if (type !== 'none') await seedSet(`users/${uid}`, { uid, email, accountType: type, ...(extra.locale ? { locale: extra.locale } : {}), createdAt: new Date() })
  return { uid, email }
}
const identity = (path: string, body: object) => fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/${path}?key=fake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, body: await r.json() as Record<string, unknown> }))
const codeOf = (text: string) => decodeURIComponent(text.match(/oobCode=([^&\s]+)/)![1])
const reason = async (p: Promise<unknown>) => { try { await p } catch (e) { return (e as { details?: { reason?: string } }).details?.reason ?? 'other' } return 'none' }
const limitDocs = async () => (await db.collection(AUTH_MAIL_COLLECTION).get()).docs

test('AUTHMAIL-F1. verification: sent from info@miolovealbum.com in the account language, the link is on miolovealbum.com, and its one-time code really verifies the address — once', async () => {
  for (const locale of MAIL_LOCALES) {
    const u = await user('couple', { locale }), { deps, transport } = mk()
    assert.deepEqual(await sendMioloveVerification(deps, u.uid, undefined), { result: 'sent' })
    const m = transport.sent[0]
    assert.equal(m.to, u.email); assert.equal(m.from, 'MIOLOVE Album <info@miolovealbum.com>'); assert.equal(m.replyTo, 'info@miolovealbum.com')
    assert.match(m.html, new RegExp(`<html lang="${locale}"`)); assert.match(m.text, /https:\/\/miolovealbum\.com\/auth\/action\?mode=verifyEmail&oobCode=[^&\s]+&lang=/)
    assert.doesNotMatch(m.html + m.text, /firebaseapp\.com|127\.0\.0\.1|identitytoolkit/)
    assert.deepEqual(m.tags, [{ name: 'brand', value: 'miolove' }, { name: 'kind', value: 'verify_email' }])
    const code = codeOf(m.text)
    assert.equal((await identity('accounts:update', { oobCode: code })).ok, true); assert.equal((await adminAuth.getUser(u.uid)).emailVerified, true)
    assert.equal((await identity('accounts:update', { oobCode: code })).ok, false, 'a used code is dead')
  }
})

test('AUTHMAIL-F2. the language asked by the browser wins, then the saved one, then Italian', async () => {
  const a = await user('couple', { locale: 'fr' }), b = await user('couple'), { deps, transport } = mk()
  await sendMioloveVerification(deps, a.uid, 'es'); await sendMioloveVerification(deps, b.uid, 'de')
  assert.match(transport.sent[0].html, /<html lang="es"/); assert.match(transport.sent[1].html, /<html lang="it"/)
  const c = await user('couple', { locale: 'fr' }), r = mk(); await sendMioloveVerification(r.deps, c.uid, undefined); assert.match(r.transport.sent[0].html, /<html lang="fr"/)
})

test('AUTHMAIL-F3. who may receive it: an IOMIXO (dj) account or one without a profile is refused; an already-verified one gets nothing; disabled / not-allowed / mail-off send nothing', async () => {
  const dj = await user('dj'), bare = await user('none'), ver = await user('couple', { verified: true }), ok = await user('couple')
  const r = mk()
  assert.equal(await reason(sendMioloveVerification(r.deps, dj.uid, 'it')), 'miolove_account_required')
  assert.equal(await reason(sendMioloveVerification(r.deps, bare.uid, 'it')), 'miolove_account_required')
  assert.deepEqual(await sendMioloveVerification(r.deps, ver.uid, 'it'), { result: 'already_verified' })
  assert.equal(r.transport.sent.length, 0)
  const off = mk({ enabled: false }); assert.equal(await reason(sendMioloveVerification(off.deps, ok.uid, 'it')), 'mail_disabled'); assert.equal(off.transport.sent.length, 0)
  const al = mk({ allowRecipient: () => false }); assert.equal(await reason(sendMioloveVerification(al.deps, ok.uid, 'it')), 'recipient_not_allowed'); assert.equal(al.transport.sent.length, 0)
  const dis = await user('couple', { disabled: true }); assert.equal(await reason(sendMioloveVerification(r.deps, dis.uid, 'it')), 'no_email'); assert.equal(r.transport.sent.length, 0)
})

test('AUTHMAIL-F4. resend limits: not within 60 s, at most 5 per hour, free again later; another account is not affected', async () => {
  const u = await user('couple'), other = await user('couple'); let t = T0.getTime()
  const r = mk({}, () => new Date(t))
  await sendMioloveVerification(r.deps, u.uid, 'it')
  assert.equal(await reason(sendMioloveVerification(r.deps, u.uid, 'it')), 'too_soon'); assert.equal(r.transport.sent.length, 1)
  for (let i = 1; i < VERIFY_LIMITS.maxPerHour; i++) { t += VERIFY_LIMITS.minGapMs + 1; await sendMioloveVerification(r.deps, u.uid, 'it') }
  t += VERIFY_LIMITS.minGapMs + 1
  assert.equal(await reason(sendMioloveVerification(r.deps, u.uid, 'it')), 'too_many'); assert.equal(r.transport.sent.length, VERIFY_LIMITS.maxPerHour)
  await sendMioloveVerification(r.deps, other.uid, 'it'); assert.equal(r.transport.sent.length, VERIFY_LIMITS.maxPerHour + 1)
  t += 3_700_000; await sendMioloveVerification(r.deps, u.uid, 'it'); assert.equal(r.transport.sent.length, VERIFY_LIMITS.maxPerHour + 2, 'the hour passed')
})

test('AUTHMAIL-F5. concurrent clicks send once; a provider failure is a clean, retryable error that leaks nothing', async () => {
  const u = await user('couple'), r = mk()
  const res = await Promise.allSettled([1, 2, 3, 4].map(() => sendMioloveVerification(r.deps, u.uid, 'it')))
  assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1); assert.equal(r.transport.sent.length, 1)
  const boom: MailTransport = { async send() { throw new MailError('resend_403 sk_live_SECRET', true, 'http_403') } }
  const v = await user('couple'), f = mk({ transport: boom })
  try { await sendMioloveVerification(f.deps, v.uid, 'it'); assert.fail('should throw') } catch (e) {
    const err = e as { code: string; message: string; details?: { reason?: string } }
    assert.equal(err.code, 'unavailable'); assert.equal(err.details?.reason, 'send_failed'); assert.doesNotMatch(JSON.stringify(err), /SECRET|resend_403|oobCode/)
  }
  const retry = mk(); assert.deepEqual(await sendMioloveVerification(retry.deps, v.uid, 'it'), { result: 'sent' })      // the failed attempt gave its slot back: the customer can resend at once
})

test('AUTHMAIL-F6. no one-time code or address is ever stored: the limit documents hold timestamps only', async () => {
  const u = await user('couple'), r = mk(); await sendMioloveVerification(r.deps, u.uid, 'it'); await sendMioloveReset(r.deps, { email: u.email, ip: '203.0.113.7' })
  const docs = await limitDocs(); assert.ok(docs.length >= 2)
  for (const d of docs) { const s = JSON.stringify(d.data()) + d.id; assert.doesNotMatch(s, /oobCode|@|example\.com|203\.0\.113/); assert.deepEqual(Object.keys(d.data()).sort(), ['expireAt', 'hits']) }
  assert.equal((await db.collection('mioloveMailOutbox').where('kind', 'in', ['verify_email', 'reset_password']).get()).size, 0)
})

test('AUTHMAIL-F7. password reset: a MIOLOVE account gets the branded e-mail in its language, and the code really changes the password — once', async () => {
  for (const locale of MAIL_LOCALES) {
    const u = await user('couple', { locale }), { deps, transport } = mk()
    assert.deepEqual(await sendMioloveReset(deps, { email: `  ${u.email.toUpperCase()} `, ip: '198.51.100.1' }), { ok: true })
    const m = transport.sent[0]
    assert.equal(m.to, u.email); assert.equal(m.from, 'MIOLOVE Album <info@miolovealbum.com>'); assert.match(m.html, new RegExp(`<html lang="${locale}"`))
    assert.match(m.text, /https:\/\/miolovealbum\.com\/auth\/action\?mode=resetPassword&oobCode=/); assert.doesNotMatch(m.html + m.text, /firebaseapp\.com|127\.0\.0\.1/)
    const code = codeOf(m.text)
    assert.equal((await identity('accounts:resetPassword', { oobCode: code, newPassword: 'brandnew456' })).ok, true)
    assert.equal((await identity('accounts:signInWithPassword', { email: u.email, password: 'brandnew456', returnSecureToken: true })).ok, true)
    assert.equal((await identity('accounts:resetPassword', { oobCode: code, newPassword: 'again789xx' })).ok, false, 'a used code is dead')
  }
})

test('AUTHMAIL-F8. no enumeration: unknown, IOMIXO, disabled, malformed, throttled and provider-down all answer exactly { ok: true }, send nothing, and take the same minimum time', async () => {
  const dj = await user('dj'), dis = await user('couple', { disabled: true }), real = await user('couple')
  const slept: number[] = []; const r = mk({ sleep: async (ms) => { slept.push(ms) } })
  const answers = []
  for (const email of [`ghost${id('g')}@example.com`, dj.email, dis.email, 'not-an-email', '', 42, undefined, 'a'.repeat(300) + '@x.it']) answers.push(await sendMioloveReset(r.deps, { email, ip: null }))
  assert.equal(r.transport.sent.length, 0)
  const boom = mk({ transport: { async send() { throw new MailError('down', true, 'network') } }, sleep: async (ms) => { slept.push(ms) } })
  answers.push(await sendMioloveReset(boom.deps, { email: real.email, ip: null }))
  const off = mk({ enabled: false }); answers.push(await sendMioloveReset(off.deps, { email: real.email, ip: null })); assert.equal(off.transport.sent.length, 0)
  const al = mk({ allowRecipient: () => false }); answers.push(await sendMioloveReset(al.deps, { email: real.email, ip: null })); assert.equal(al.transport.sent.length, 0)
  for (const a of answers) assert.deepEqual(a, { ok: true })
  assert.ok(slept.length >= 9 && slept.every((ms) => ms > 0 && ms <= RESET_MIN_DURATION_MS), 'every call waits out the fixed minimum')
  const real2 = await user('couple'), ok = mk(); await sendMioloveReset(ok.deps, { email: real2.email, ip: null }); assert.equal(ok.transport.sent.length, 1)
})

test('AUTHMAIL-F9. reset throttling: per address (3/hour, 60 s apart) and per IP (20/hour); an unknown address is counted too, so the counter reveals nothing', async () => {
  const u = await user('couple'); let t = T0.getTime(); const r = mk({}, () => new Date(t))
  for (let i = 0; i < 5; i++) { await sendMioloveReset(r.deps, { email: u.email, ip: null }); t += RESET_EMAIL_LIMITS.minGapMs + 1 }
  assert.equal(r.transport.sent.length, RESET_EMAIL_LIMITS.maxPerHour, 'extra requests answer ok but send nothing')
  const ghost = `ghost${id('g')}@example.com`; await sendMioloveReset(r.deps, { email: ghost, ip: null })
  const hashes = (await limitDocs()).filter((d) => d.id.startsWith('r_')).length; assert.ok(hashes >= 2, 'the unknown address has a counter as well')
  const ipR = mk({}, () => new Date(T0.getTime() + 10 * 3_600_000)); const users = await Promise.all(Array.from({ length: RESET_IP_LIMITS.maxPerHour + 3 }, () => user('couple')))
  for (const x of users) await sendMioloveReset(ipR.deps, { email: x.email, ip: '192.0.2.99' })
  assert.equal(ipR.transport.sent.length, RESET_IP_LIMITS.maxPerHour, 'one IP cannot mail more than the cap')
})

test('AUTHMAIL-F10. global reset cap: the hour is capped, only REAL sends count (made-up addresses cannot fill it), the cap answers { ok: true } like everything else, and it never touches verification or other MIOLOVE mail', async () => {
  const t = new Date(T0.getTime() + 30 * 3_600_000); const r = mk({}, () => t)
  for (let i = 0; i < 40; i++) await sendMioloveReset(r.deps, { email: `ghost${id('g')}@example.com`, ip: null })                  // strangers: nothing is sent, nothing counted
  assert.equal(r.transport.sent.length, 0)
  const users = await Promise.all(Array.from({ length: RESET_GLOBAL_LIMITS.maxPerHour + 4 }, () => user('couple')))
  const answers = []; for (const u of users) answers.push(await sendMioloveReset(r.deps, { email: u.email, ip: null }))
  assert.equal(r.transport.sent.length, RESET_GLOBAL_LIMITS.maxPerHour, 'the cap is the cap'); for (const a of answers) assert.deepEqual(a, { ok: true })
  const v = await user('couple'); assert.deepEqual(await sendMioloveVerification(r.deps, v.uid, 'it'), { result: 'sent' })                // verification is a different budget
  const later = mk({}, () => new Date(t.getTime() + 3_700_000)); await sendMioloveReset(later.deps, { email: users[users.length - 1].email, ip: null }); assert.equal(later.transport.sent.length, 1, 'next hour: free again')
})

test('AUTHMAIL-F11. the day cap works on top of the hour cap (a slow drip cannot burn the quota either)', async () => {
  const key = id('dc'), lim = { minGapMs: 0, maxPerHour: 3, maxPerDay: 5 }, base = T0.getTime() + 100 * 3_600_000
  const at = (h: number) => new Date(base + h * 3_600_000)
  for (const h of [0, 0.1, 0.2]) assert.equal(await reserveSlot(db, key, at(h), lim), 'ok')
  assert.equal(await reserveSlot(db, key, at(0.3), lim), 'too_many', 'hour full')
  for (const h of [2, 2.1]) assert.equal(await reserveSlot(db, key, at(h), lim), 'ok')
  assert.equal(await reserveSlot(db, key, at(4), lim), 'too_many', 'day full (5) although the hour is empty')
  assert.equal(await reserveSlot(db, key, at(24.5), lim), 'ok', 'a day later')
})

test('AUTHMAIL-F12. per-IP limit counts an IPv6 /64 as one customer: rotating inside it does not help, another network is untouched', async () => {
  const t = new Date(T0.getTime() + 60 * 3_600_000); const r = mk({}, () => t)
  const users = await Promise.all(Array.from({ length: RESET_IP_LIMITS.maxPerHour + 3 }, () => user('couple')))
  for (let i = 0; i < users.length; i++) await sendMioloveReset(r.deps, { email: users[i].email, ip: `2001:db8:77:5::${(i + 1).toString(16)}` })
  assert.equal(r.transport.sent.length, RESET_IP_LIMITS.maxPerHour, 'one /64 = one bucket')
  const other = await user('couple'); await sendMioloveReset(r.deps, { email: other.email, ip: '2001:db8:77:6::1' }); assert.equal(r.transport.sent.length, RESET_IP_LIMITS.maxPerHour + 1, 'the neighbouring /64 is another customer')
  const v4 = await user('couple'); await sendMioloveReset(r.deps, { email: v4.email, ip: '203.0.113.200' }); assert.equal(r.transport.sent.length, RESET_IP_LIMITS.maxPerHour + 2, 'IPv4 customers unaffected')
})

test('AUTHMAIL-F13. global verification cap (15/h): when it is full the customer gets a clean "busy", keeps their OWN resend budget, nothing is sent, and the cap frees up with the hour', async () => {
  const t = new Date(T0.getTime() + 80 * 3_600_000); const r = mk({}, () => t)
  const users = await Promise.all(Array.from({ length: VERIFY_GLOBAL_LIMITS.maxPerHour + 1 }, () => user('couple')))
  for (const u of users.slice(0, VERIFY_GLOBAL_LIMITS.maxPerHour)) assert.deepEqual(await sendMioloveVerification(r.deps, u.uid, 'it'), { result: 'sent' })
  const last = users[users.length - 1]
  assert.equal(await reason(sendMioloveVerification(r.deps, last.uid, 'it')), 'busy'); assert.equal(r.transport.sent.length, VERIFY_GLOBAL_LIMITS.maxPerHour)
  assert.deepEqual((await db.doc(`${AUTH_MAIL_COLLECTION}/v_${last.uid}`).get()).data()?.hits ?? [], [], 'the refused customer did not burn their own budget')
  await clearGlobals(); assert.deepEqual(await sendMioloveVerification(r.deps, last.uid, 'it'), { result: 'sent' })                  // same minute: not "too_soon"
  const later = mk({}, () => new Date(t.getTime() + 3_700_000)); await sendMioloveVerification(later.deps, users[0].uid, 'it'); assert.equal(later.transport.sent.length, 1, 'next hour: free again')
})

test('AUTHMAIL-F14. the quota is only spent on e-mails that really go out: refused / failed / pointless requests leave both global budgets untouched', async () => {
  const dj = await user('dj'), ver = await user('couple', { verified: true }), dis = await user('couple', { disabled: true }), ok = await user('couple'), r = mk()
  await reason(sendMioloveVerification(r.deps, dj.uid, 'it')); await sendMioloveVerification(r.deps, ver.uid, 'it'); await reason(sendMioloveVerification(r.deps, dis.uid, 'it'))
  await reason(sendMioloveVerification(mk({ allowRecipient: () => false }).deps, ok.uid, 'it')); await reason(sendMioloveVerification(mk({ enabled: false }).deps, ok.uid, 'it'))
  for (const email of [`ghost${id('g')}@example.com`, dj.email, dis.email, 'bad', undefined]) await sendMioloveReset(r.deps, { email, ip: null })
  const g = (k: string) => db.collection('mioloveAuthMail').doc(k).get()
  assert.equal((await g('g_verify')).exists, false, 'no verification budget used'); assert.equal((await g('g_reset')).exists, false, 'no reset budget used')
  const boom: MailTransport = { async send() { throw new MailError('down', true, 'network') } }
  const f = mk({ transport: boom }); await reason(sendMioloveVerification(f.deps, ok.uid, 'it')); await sendMioloveReset(f.deps, { email: (await user('couple')).email, ip: null })
  assert.deepEqual((await g('g_verify')).data()?.hits ?? [], [], 'a failed verification send gives its slot back'); assert.deepEqual((await g('g_reset')).data()?.hits ?? [], [], 'a failed reset send gives its slot back')
  assert.equal((await sendMioloveVerification(r.deps, ok.uid, 'it')).result, 'sent', 'and the customer can resend at once')
  assert.equal((await g('g_verify')).data()?.hits.length, 1)
})

test('AUTHMAIL-F15. TTL safety: a counter document expires only AFTER every hit it holds has left its counting window (hour, or day for the capped global ones), so deleting it can never reset an active limit', async () => {
  const t = new Date(T0.getTime() + 120 * 3_600_000), DAYMS = 86_400_000, HOURMS = 3_600_000
  for (const [key, lim, window] of [[id('ttlh'), { minGapMs: 0, maxPerHour: 3 }, HOURMS], [id('ttld'), RESET_GLOBAL_LIMITS, DAYMS]] as const) {
    await reserveSlot(db, key, t, lim); await reserveSlot(db, key, new Date(t.getTime() + 60_000), lim)
    const d = (await db.doc(`${AUTH_MAIL_COLLECTION}/${key}`).get()).data()!, newest = Math.max(...d.hits as number[])
    assert.ok(d.expireAt.toMillis() >= newest + window, `${key}: expireAt ${(d.expireAt.toMillis() - newest) / 60000} min after the newest hit, window ${window / 60000}`)
    assert.equal(typeof d.expireAt.toMillis, 'function', 'a Firestore Timestamp (what TTL needs)')
  }
})
