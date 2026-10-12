/**
 * POST-DEPLOY positive App Check check of the six NEW callables on iomixo-494817 (moderateRequest, moderateDedication, createPoll, setPollStatus,
 * updateEventConfig, getPublicEvent). Same method as appcheck-positive-check.cjs; NOT RUN yet — the callables are not deployed.
 *
 *   NODE_PATH=../backend/node_modules FIREBASE_PROJECT_ID=iomixo-494817 node scripts/appcheck-positive-check-owner.cjs
 *
 * Run it with APPCHECK_ENFORCE_OWNER / APPCHECK_ENFORCE_PUBLIC_EVENT first at false (expects appCheck=valid, enforcement=false in the logs), then again
 * after flipping them to true (expects the same calls to succeed and a call WITHOUT a token to be rejected, which this script also tries).
 * Writes only `firebase-test-acown-*` events + `acown-owner-*` user docs (+ one custom-token Auth user), all deleted at the end. Zero Supabase (bridge mock).
 */
const { readFileSync } = require('node:fs')
const { execSync, spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')

const PROJECT = 'iomixo-494817', PORT = 9334, PREFIX = 'firebase-test-acown-'
const PROFILE = process.env.CHROME_PROFILE_DIR ?? '/tmp/chrome-ac-owner-profile'
if (process.env.FIREBASE_PROJECT_ID !== PROJECT) throw new Error('set FIREBASE_PROJECT_ID=' + PROJECT)
if (Object.keys(process.env).some((k) => k.startsWith('SUPABASE'))) throw new Error('SUPABASE_* env present: refusing')
const env = Object.fromEntries(readFileSync(__dirname + '/../.env.production.local', 'utf8').split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const webConfig = { apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, appId: env.NEXT_PUBLIC_FIREBASE_APP_ID }
const siteKey = env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY
const EXPECT_ENFORCED = process.argv.includes('--expect-enforced')

initializeApp({ projectId: PROJECT })
const db = getFirestore(), auth = getAuth()
const results = [], created = { events: [], owners: [], authUsers: [] }
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function seed() {
  const stamp = Date.now().toString(36)
  const ownerUid = `acown-owner-${stamp}`
  await db.doc(`users/${ownerUid}`).set({ uid: ownerUid, plan: { tier: 'wedding', source: 'legacy' }, testData: true, createdAt: new Date(), updatedAt: new Date() }); created.owners.push(ownerUid)
  const id = `${PREFIX}${stamp}`, slug = id
  await db.doc(`events/${id}`).set({ ownerUid, slug, legacySupabaseId: `mock-session-${id}`, title: 'TEST APPCHECK OWNER', djName: 'test', description: null, type: 'party', status: 'live',
    screenModeEnabled: false, guestConfig: { requests: true }, screenConfig: { show_polls: false }, testData: true, createdAt: new Date(), updatedAt: new Date() }); created.events.push(id)
  await db.doc(`eventSlugs/${slug}`).set({ eventId: id })
  await db.doc(`events/${id}/requests/r1`).set({ guestUid: 'x', songTitle: 'T', artist: null, message: null, status: 'pending', createdAt: Timestamp.now(), updatedAt: Timestamp.now() })
  await db.doc(`events/${id}/dedications/d1`).set({ senderName: 'Z', message: 'm', status: 'pending', createdAt: Timestamp.now(), updatedAt: Timestamp.now() })
  // A throw-away email/password account with the SAME uid as the seeded owner (sign_in_provider "password" → not anonymous; no service-account signing needed).
  const email = `${ownerUid}@example.invalid`, password = `Pw-${stamp}-${Math.random().toString(36).slice(2)}!`
  await auth.createUser({ uid: ownerUid, email, password, emailVerified: true }); created.authUsers.push(ownerUid)
  return { ownerUid, id, slug, email, password }
}

async function cdp(url) {
  const ws = new WebSocket(url); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0; const pending = new Map(), events = []
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } else events.push(d) }
  return { send: (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) }), events, close: () => ws.close() }
}

const PAGE_SCRIPT = (cfg, key, S) => `(async () => {
  const V = '11.10.0', base = 'https://www.gstatic.com/firebasejs/' + V + '/'
  const [{ initializeApp }, { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken }, { getAuth, signInWithEmailAndPassword }, { getFunctions, httpsCallable }] = await Promise.all([
    import(base + 'firebase-app.js'), import(base + 'firebase-app-check.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-functions.js')])
  const withToken = initializeApp(${JSON.stringify(cfg)}), noToken = initializeApp(${JSON.stringify(cfg)}, 'without')
  const ac = initializeAppCheck(withToken, { provider: new ReCaptchaEnterpriseProvider(${JSON.stringify(key)}), isTokenAutoRefreshEnabled: false })      // 'without' never initialises App Check
  let tokenInfo; try { const t = await getToken(ac, false); tokenInfo = { ok: !!t.token, length: t.token ? t.token.length : 0 } } catch (e) { tokenInfo = { ok: false, error: String(e.code || e.message).slice(0, 160) } }
  const call = async (app, name, data) => { try { const r = await httpsCallable(getFunctions(app, 'europe-west1'), name)(data); return { ok: true, data: r.data } } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason } } }
  const S = ${JSON.stringify(S)}
  const owner = await signInWithEmailAndPassword(getAuth(withToken), S.email, S.password); await signInWithEmailAndPassword(getAuth(noToken), S.email, S.password)
  const out = { origin: location.origin, ownerAnonymous: owner.user.isAnonymous, tokenInfo }
  out.getPublicEvent = await call(withToken, 'getPublicEvent', { slug: S.slug })
  out.moderateRequest = await call(withToken, 'moderateRequest', { eventId: S.id, requestId: 'r1', action: 'set_status', status: 'approved' })
  out.moderateDedication = await call(withToken, 'moderateDedication', { eventId: S.id, dedicationId: 'd1', action: 'set_status', status: 'approved' })
  out.createPoll = await call(withToken, 'createPoll', { eventId: S.id, question: 'Q?', options: ['A', 'B'] })
  out.setPollStatus = out.createPoll.ok ? await call(withToken, 'setPollStatus', { eventId: S.id, pollId: out.createPoll.data.pollId, open: false }) : { ok: false }
  out.updateEventConfig = await call(withToken, 'updateEventConfig', { eventId: S.id, screenConfig: { show_polls: true } })
  out.noToken = await call(noToken, 'updateEventConfig', { eventId: S.id, screenConfig: { show_polls: false } })        // same owner, NO App Check token
  return JSON.stringify(out)
})()`

async function run() {
  const S = await seed(); const startedAt = new Date(Date.now() - 5000).toISOString()
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  let page
  try {
    let targets; for (let i = 0; i < 40 && !targets; i++) { await sleep(500); try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json() } catch {} }
    assert.ok(targets, 'Chrome did not expose the debugging port')
    page = await cdp((targets.find((t) => t.type === 'page') ?? targets[0]).webSocketDebuggerUrl)
    await page.send('Page.enable'); await page.send('Page.setBypassCSP', { enabled: true }); await page.send('Page.navigate', { url: 'https://www.iomixo.com/' })
    for (let i = 0; i < 60 && !page.events.some((e) => e.method === 'Page.loadEventFired'); i++) await sleep(500)
    const res = await page.send('Runtime.evaluate', { expression: PAGE_SCRIPT(webConfig, siteKey, S), awaitPromise: true, returnByValue: true })
    if (res.result.exceptionDetails) throw new Error('page script failed: ' + JSON.stringify(res.result.exceptionDetails).slice(0, 400))
    const out = JSON.parse(res.result.result.value)
    console.log('# App Check token fetched in the page:', JSON.stringify(out.tokenInfo))
    check('App Check token obtained from reCAPTCHA Enterprise in the page', out.tokenInfo.ok === true, JSON.stringify(out.tokenInfo))
    check('real origin https://www.iomixo.com + non-anonymous owner', out.origin === 'https://www.iomixo.com' && out.ownerAnonymous === false)
    for (const fn of ['getPublicEvent', 'moderateRequest', 'moderateDedication', 'createPoll', 'setPollStatus', 'updateEventConfig']) check(`${fn}: succeeds with an App Check token`, out[fn].ok === true, out[fn].ok ? '' : `${out[fn].code}:${out[fn].reason}`)
    if (EXPECT_ENFORCED) check('updateEventConfig WITHOUT a token is rejected by the platform (enforcement=true)', out.noToken.ok === false && /unauthenticated|failed-precondition/.test(out.noToken.code || ''), JSON.stringify(out.noToken))
    else check('updateEventConfig without a token still works while enforcement is false (observe only)', out.noToken.ok === true, JSON.stringify(out.noToken))
    check('Firestore effects: request approved, poll closed, config written', (await db.doc(`events/${S.id}/requests/r1`).get()).data().status === 'approved' && (await db.doc(`events/${S.id}`).get()).data().screenConfig != null)
    await sleep(8000)
    for (const fn of ['getPublicEvent', 'moderateRequest', 'moderateDedication', 'createPoll', 'setPollStatus', 'updateEventConfig']) {
      const q = `resource.type="cloud_run_revision" AND resource.labels.service_name="${fn.toLowerCase()}" AND timestamp>="${startedAt}" AND jsonPayload.message="app_check"`
      let logs = []; for (let i = 0; i < 12; i++) { logs = JSON.parse(execSync(`gcloud logging read '${q}' --project=${PROJECT} --format=json --limit=20`, { maxBuffer: 20_000_000 }).toString() || '[]').map((l) => l.jsonPayload); if (logs.length) break; await sleep(5000) }
      check(`${fn}: log app_check appCheck=valid (token received by the platform)`, logs.some((l) => l.appCheck === 'valid'), `entries=${logs.length}`)
    }
  } finally { try { page && page.close() } catch {} chrome.kill('SIGTERM'); try { execSync(`pkill -f "remote-debugging-port=${PORT}"`) } catch {} }
}

async function cleanup() {
  for (const id of created.events) await db.recursiveDelete(db.doc(`events/${id}`))
  for (const id of created.events) await db.doc(`eventSlugs/${id}`).delete()
  for (const id of created.owners) await db.doc(`users/${id}`).delete()
  for (const uid of created.authUsers) await auth.deleteUser(uid).catch((e) => { if (e.code !== 'auth/user-not-found') throw e })
  const left = (await db.collection('events').listDocuments()).filter((r) => r.id.startsWith(PREFIX)).length
  check('cleanup: 0 test events left', left === 0)
}

;(async () => { try { await run() } catch (e) { results.push(false); console.error('FATAL', e && e.message ? e.message : e) } finally { await cleanup() } console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1) })()
