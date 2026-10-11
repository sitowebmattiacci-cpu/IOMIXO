/**
 * POSITIVE App Check check of the three guest callables on iomixo-494817 (enforcement = true), from the REAL origin.
 *
 *   NODE_PATH=../backend/node_modules FIREBASE_PROJECT_ID=iomixo-494817 node scripts/appcheck-positive-check.cjs
 *
 * How it works (nothing is deployed, the production frontend is not touched):
 *   1. Admin SDK (ADC) seeds `firebase-test-ac-*` events + test owner plans (users docs `ac-owner-*`).
 *   2. A local Chrome (isolated profile, remote debugging) opens https://www.iomixo.com/ — the origin the reCAPTCHA Enterprise key
 *      is registered for — and, inside that page, loads the Firebase Web SDK, initialises App Check with the registered
 *      site key (ReCaptchaEnterpriseProvider), signs in anonymously and calls the three callables. CSP is bypassed for THIS
 *      debug session only (Page.setBypassCSP) so the SDK can be imported.
 *   3. Results are verified in Firestore and in Cloud Logging (app_check: valid / enforcement / anonymous, entitlement source).
 *   4. Cleanup: events (recursive), owner docs, the anonymous Auth users it created. Zero Supabase: LEGACY_BRIDGE=mock on the functions.
 * Public web config only (read from .env.production.local); no secret is read, printed or stored.
 */
const { readFileSync } = require('node:fs')
const { execSync, spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')

const PROJECT = 'iomixo-494817', PORT = 9333, PREFIX = 'firebase-test-ac-'
const PROFILE = '/private/tmp/claude-501/-Users-macbookpro-Desktop-IOMIXO/eee91d8e-1adb-48c2-a62c-24de758c3a0a/scratchpad/chrome-ac-profile'
if (process.env.FIREBASE_PROJECT_ID !== PROJECT) throw new Error('set FIREBASE_PROJECT_ID=' + PROJECT)
if (Object.keys(process.env).some((k) => k.startsWith('SUPABASE'))) throw new Error('SUPABASE_* env present: refusing')
const env = Object.fromEntries(readFileSync(__dirname + '/../.env.production.local', 'utf8').split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const webConfig = { apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, appId: env.NEXT_PUBLIC_FIREBASE_APP_ID }
const siteKey = env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY

initializeApp({ projectId: PROJECT })
const db = getFirestore(), auth = getAuth()
const results = []
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const created = { events: [], owners: [], anon: [] }
const H = 3600_000

let n = 0
async function seed() {
  const stamp = Date.now().toString(36)
  const mkOwner = async (tier, source) => { const id = `ac-owner-${stamp}-${n++}`; await db.doc(`users/${id}`).set({ uid: id, email: `${id}@example.invalid`, plan: { tier, source }, testData: true, createdAt: new Date(), updatedAt: new Date() }); created.owners.push(id); return id }
  const mkEvent = async (name, ownerUid, type, extra = {}) => {
    const id = `${PREFIX}${stamp}-${name}`
    await db.doc(`events/${id}`).set({ ownerUid, slug: id, legacySupabaseId: `mock-session-${id}`, title: 'TEST APPCHECK', djName: 'test', description: null, type, status: 'live',
      screenModeEnabled: false, guestConfig: { requests: true }, testData: true, createdAt: new Date(), updatedAt: new Date(), ...extra })
    created.events.push(id); return id
  }
  const freeOwner = await mkOwner('free', 'legacy'), weddingOwner = await mkOwner('wedding', 'legacy'), legacyOwner = await mkOwner('free', 'default')
  const E = {
    poll: await mkEvent('poll', freeOwner, 'party'),                                   // free owner, NO pass: a guest must still be able to vote (legacy semantics)
    dedFs: await mkEvent('ded-fs', weddingOwner, 'wedding', { dedicationsEnabled: false }),     // firestore entitlement says yes, legacy field says no → firestore is final
    dedFb: await mkEvent('ded-fb', legacyOwner, 'party', { dedicationsEnabled: true }),         // no server plan → legacy projected field decides
    reqFs: await mkEvent('req-fs', freeOwner, 'party', { requestLimit: null }),                 // free → limit 30 (legacy field says unlimited and must be ignored)
    reqFsFull: await mkEvent('req-fs-full', freeOwner, 'party', { requestLimit: null }),
    reqFb: await mkEvent('req-fb', legacyOwner, 'party', { requestLimit: 30 }),
  }
  await db.doc(`events/${E.reqFs}/state/requests`).set({ total: 29 })        // 30th request fits
  await db.doc(`events/${E.reqFsFull}/state/requests`).set({ total: 30 })    // 31st does not
  await db.doc(`events/${E.reqFb}/state/requests`).set({ total: 29 })
  const pollId = 'poll1'
  await db.doc(`events/${E.poll}/polls/${pollId}`).set({ question: 'Q?', options: ['A', 'B', 'C'], status: 'open', legacySupabaseId: `lp-${E.poll}`, createdAt: new Date(), updatedAt: new Date() })
  return { E, pollId }
}

// ── minimal CDP client over the global WebSocket (Node 22) ──
async function cdp(url) {
  const ws = new WebSocket(url); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0; const pending = new Map(), events = []
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } else events.push(d) }
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  return { send, events, close: () => ws.close() }
}

const PAGE_SCRIPT = (cfg, siteKey, E, pollId) => `(async () => {
  const V = '11.10.0', base = 'https://www.gstatic.com/firebasejs/' + V + '/'
  const [{ initializeApp }, { initializeAppCheck, ReCaptchaEnterpriseProvider }, { getAuth, signInAnonymously }, { getFunctions, httpsCallable }] = await Promise.all([
    import(base + 'firebase-app.js'), import(base + 'firebase-app-check.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-functions.js')])
  const app = initializeApp(${JSON.stringify(cfg)})
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(${JSON.stringify(siteKey)}), isTokenAutoRefreshEnabled: false })
  const cred = await signInAnonymously(getAuth(app))
  const fns = getFunctions(app, 'europe-west1')
  const call = async (name, data) => { try { const r = await httpsCallable(fns, name)(data); return { ok: true, data: r.data } } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason, message: String(e.message).slice(0, 120) } } }
  const E = ${JSON.stringify(E)}
  const out = { origin: location.origin, uid: cred.user.uid, isAnonymous: cred.user.isAnonymous }
  out.vote = await call('votePoll', { eventId: E.poll, pollId: ${JSON.stringify(pollId)}, optionIndex: 1 })
  out.dedFs = await call('createDedication', { eventId: E.dedFs, senderName: 'Test', message: 'Auguri firestore' })
  out.dedFb = await call('createDedication', { eventId: E.dedFb, senderName: 'Test', message: 'Auguri fallback' })
  out.reqFs = await call('createMusicRequest', { eventId: E.reqFs, songTitle: 'Test Song' })
  out.reqFsFull = await call('createMusicRequest', { eventId: E.reqFsFull, songTitle: 'Test Song' })
  out.reqFb = await call('createMusicRequest', { eventId: E.reqFb, songTitle: 'Test Song' })
  return JSON.stringify(out)
})()`

async function run() {
  const { E, pollId } = await seed()
  console.log('# events:', Object.values(E).join(', '))
  const startedAt = new Date(Date.now() - 5000).toISOString()
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--window-size=900,700', 'about:blank'], { stdio: 'ignore', detached: false })
  let page
  try {
    let targets
    for (let i = 0; i < 40 && !targets; i++) { await sleep(500); try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json() } catch {} }
    assert.ok(targets, 'Chrome did not expose the debugging port')
    const tgt = targets.find((t) => t.type === 'page') ?? targets[0]
    page = await cdp(tgt.webSocketDebuggerUrl)
    await page.send('Page.enable'); await page.send('Page.setBypassCSP', { enabled: true })
    await page.send('Page.navigate', { url: 'https://www.iomixo.com/' })
    for (let i = 0; i < 60 && !page.events.some((e) => e.method === 'Page.loadEventFired'); i++) await sleep(500)
    const res = await page.send('Runtime.evaluate', { expression: PAGE_SCRIPT(webConfig, siteKey, E, pollId), awaitPromise: true, returnByValue: true })
    if (res.result.exceptionDetails) throw new Error('page script failed: ' + JSON.stringify(res.result.exceptionDetails).slice(0, 400))
    const out = JSON.parse(res.result.result.value); created.anon.push(out.uid)
    console.log('# page origin:', out.origin, '| anonymous:', out.isAnonymous)
    await verify(out, E, pollId, startedAt)
  } finally {
    try { page && page.close() } catch {}
    chrome.kill('SIGTERM'); try { execSync(`pkill -f "remote-debugging-port=${PORT}"`) } catch {}
  }
}

const logs = (fn, filter, startedAt) => {
  const q = `resource.type="cloud_run_revision" AND resource.labels.service_name="${fn.toLowerCase()}" AND timestamp>="${startedAt}" AND ${filter}`
  const raw = execSync(`gcloud logging read '${q}' --project=${PROJECT} --format=json --limit=50`, { maxBuffer: 20_000_000 }).toString()
  return JSON.parse(raw || '[]').map((l) => l.jsonPayload ?? {})
}

async function verify(out, E, pollId, startedAt) {
  check('real origin https://www.iomixo.com + anonymous Firebase Auth', out.origin === 'https://www.iomixo.com' && out.isAnonymous === true)
  const rsn = (r) => (r.ok ? 'ok' : `${r.code}:${r.reason}`)
  // votePoll
  check('votePoll: vote accepted (free owner, no pass, poll already open)', out.vote.ok && out.vote.data.optionIndex === 1 && out.vote.data.changed === false, rsn(out.vote))
  const tally = (await db.collection(`events/${E.poll}/polls/${pollId}/tally`).get()).docs.map((d) => d.data().counts ?? {})
  const sum = (k) => tally.reduce((a, c) => a + (c[k] ?? 0), 0)
  check('votePoll: vote doc keyed by the token uid + tally [0,1,0]', (await db.doc(`events/${E.poll}/polls/${pollId}/votes/${out.uid}`).get()).data()?.optionIndex === 1 && sum('o0') === 0 && sum('o1') === 1 && sum('o2') === 0)
  // createDedication
  check('createDedication (firestore entitlement, legacy field says no): created', out.dedFs.ok && out.dedFs.data.projected === true, rsn(out.dedFs))
  const dFs = out.dedFs.ok ? (await db.doc(`events/${E.dedFs}/dedications/${out.dedFs.data.dedicationId}`).get()).data() : null
  check('createDedication: document pending, mock legacy id, no guest uid', dFs?.status === 'pending' && /^mock-/.test(dFs.legacySupabaseId ?? '') && !('guestUid' in dFs))
  check('createDedication (legacy fallback, dedicationsEnabled=true): created', out.dedFb.ok, rsn(out.dedFb))
  // createMusicRequest
  check('createMusicRequest (free owner, 30th request, legacy field "unlimited" ignored): created', out.reqFs.ok && out.reqFs.data.projected === true, rsn(out.reqFs))
  const rFs = out.reqFs.ok ? (await db.doc(`events/${E.reqFs}/requests/${out.reqFs.data.requestId}`).get()).data() : null
  check('createMusicRequest: request pending, guestUid = token uid, mock legacy id', rFs?.status === 'pending' && rFs.guestUid === out.uid && /^mock-/.test(rFs.legacySupabaseId ?? ''))
  check('createMusicRequest: free limit 30 enforced by the resolver (31st → event_limit)', !out.reqFsFull.ok && out.reqFsFull.code === 'functions/resource-exhausted' && out.reqFsFull.reason === 'event_limit', rsn(out.reqFsFull))
  check('createMusicRequest (legacy fallback, requestLimit 30, 30th): created', out.reqFb.ok, rsn(out.reqFb))

  await sleep(8000)   // let Cloud Logging ingest
  for (const [fn, label] of [['votePoll', 'votePoll'], ['createDedication', 'createDedication'], ['createMusicRequest', 'createMusicRequest']]) {
    const expected = fn === 'createMusicRequest' ? 3 : fn === 'createDedication' ? 2 : 1
    let ac = []
    for (let i = 0; i < 12; i++) { ac = logs(fn, 'jsonPayload.message="app_check"', startedAt).filter((l) => l.fn === fn); if (ac.length >= expected) break; await sleep(5000) }   // Cloud Logging ingestion lag
    const valid = ac.filter((l) => l.appCheck === 'valid' && l.enforcement === true && l.anonymous === true)
    check(`${label}: log app_check appCheck=valid enforcement=true anonymous=true`, valid.length === expected && ac.length === expected && ac.every((l) => l.appCheck === 'valid'), `valid=${valid.length}/${ac.length}`)
    const mock = logs(fn, 'jsonPayload.message="legacy_bridge_mock"', startedAt)
    if (fn !== 'votePoll' || true) check(`${label}: bridge is the MOCK (legacy_bridge_mock logged, no Supabase)`, mock.length >= 1 && mock.every((l) => l.bridge === 'mock'), `entries=${mock.length}`)
  }
  const src = (fn) => logs(fn, 'jsonPayload.message="entitlement"', startedAt).map((l) => `${l.entitlementSource}/${l.outcome}`).sort()
  const dedSrc = src('createDedication'), reqSrc = src('createMusicRequest'), voteSrc = src('votePoll')
  console.log('# entitlement logs — createDedication:', JSON.stringify(dedSrc), '| createMusicRequest:', JSON.stringify(reqSrc), '| votePoll:', JSON.stringify(voteSrc))
  check('entitlementSource: createDedication = firestore/allow + legacy_projected_fallback/allow', dedSrc.join() === 'firestore/allow,legacy_projected_fallback/allow')
  check('entitlementSource: createMusicRequest = firestore ×2 + legacy_projected_fallback ×1', reqSrc.filter((s) => s.startsWith('firestore')).length === 2 && reqSrc.filter((s) => s.startsWith('legacy_projected_fallback')).length === 1)
  check('votePoll logs NO entitlement decision (no premium gate on the guest vote)', voteSrc.length === 0)
  const sensitive = [...logs('createDedication', 'jsonPayload.message="entitlement"', startedAt), ...logs('createMusicRequest', 'jsonPayload.message="entitlement"', startedAt)]
  check('entitlement logs carry only fn / entitlementSource / gate / outcome', sensitive.every((l) => Object.keys(l).filter((k) => !['message', 'fn', 'entitlementSource', 'gate', 'outcome'].includes(k)).length === 0))
}

async function cleanup() {
  const ids = new Set(created.events)
  for (const ref of await db.collection('events').listDocuments()) if (ref.id.startsWith(PREFIX)) ids.add(ref.id)
  for (const id of ids) await db.recursiveDelete(db.doc(`events/${id}`))
  for (const id of created.owners) await db.doc(`users/${id}`).delete()
  for (const uid of created.anon) await auth.deleteUser(uid).catch((e) => { if (e.code !== 'auth/user-not-found') throw e })
  const leftEv = (await db.collection('events').listDocuments()).filter((r) => r.id.startsWith(PREFIX)).length
  const groups = {}
  for (const g of ['requests', 'dedications', 'polls', 'votes', 'tally', 'requestGuests', 'dedicationGuests', 'state']) groups[g] = (await db.collectionGroup(g).count().get()).data().count
  const users = (await auth.listUsers(1000)).users
  const anonLeft = users.filter((u) => u.providerData.length === 0).length
  const strayOwners = (await db.collection('users').listDocuments()).filter((r) => r.id.startsWith('ac-owner-')).length
  const owner = (await db.doc('users/z5EDSZrgFDXMjCrRCB4cMEidoaL2').get()).data()
  console.log(JSON.stringify({ testEventsLeft: leftEv, subcollectionDocs: groups, anonymousAuthUsersLeft: anonLeft, strayTestOwnerDocs: strayOwners, ownerPlan: owner.plan }))
  check('cleanup: 0 test events, 0 requests/dedications/polls/votes/tally/helper docs, 0 anonymous users, owner intact',
    leftEv === 0 && Object.values(groups).every((c) => c === 0) && anonLeft === 0 && strayOwners === 0 && owner.plan.tier === 'wedding' && owner.plan.source === 'legacy')
}

;(async () => {
  try { await run() } catch (e) { results.push(false); console.error('FATAL', e && e.message ? e.message : e) } finally { await cleanup() }
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1)
})()
