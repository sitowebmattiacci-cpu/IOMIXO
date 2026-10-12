/**
 * CLOUD SMOKE of the owner callables + votePoll on a Firestore-only poll, on iomixo-494817, with SYNTHETIC data only (prefix `firebase-test-smk-`).
 *
 *   NODE_PATH=../backend/node_modules FIREBASE_PROJECT_ID=iomixo-494817 node scripts/cloud-smoke-owner.cjs
 *
 * One real Chrome session on https://www.iomixo.com (the reCAPTCHA Enterprise origin), ONE Firebase app with App Check; the page signs in as a throw-away
 * owner (email/password), calls the callables, signs in anonymously as a guest and votes (votePoll has enforcement=true: a valid token is required).
 * Results are verified in Firestore and in Cloud Logging (no Supabase / no legacy bridge for the native poll). Everything it creates is deleted.
 */
const { readFileSync } = require('node:fs')
const { execSync, spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')

const PROJECT = 'iomixo-494817', PORT = 9335, PREFIX = 'firebase-test-smk-'
const PROFILE = process.env.CHROME_PROFILE_DIR ?? '/tmp/chrome-smoke-profile'
if (process.env.FIREBASE_PROJECT_ID !== PROJECT) throw new Error('set FIREBASE_PROJECT_ID=' + PROJECT)
if (Object.keys(process.env).some((k) => k.startsWith('SUPABASE'))) throw new Error('SUPABASE_* env present: refusing')
const env = Object.fromEntries(readFileSync(__dirname + '/../.env.production.local', 'utf8').split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const webConfig = { apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, appId: env.NEXT_PUBLIC_FIREBASE_APP_ID }
const siteKey = env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY

initializeApp({ projectId: PROJECT })
const db = getFirestore(), auth = getAuth()
const results = [], created = { events: [], owners: [], authUsers: [] }
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function seed() {
  const stamp = Date.now().toString(36), ownerUid = `smk-owner-${stamp}`, id = `${PREFIX}${stamp}`
  await db.doc(`users/${ownerUid}`).set({ uid: ownerUid, plan: { tier: 'wedding', source: 'legacy' }, testData: true, createdAt: new Date(), updatedAt: new Date() }); created.owners.push(ownerUid)
  await db.doc(`events/${id}`).set({ ownerUid, slug: id, legacySupabaseId: `mock-session-${id}`, title: 'TEST SMOKE', djName: 'test', description: null, type: 'party', status: 'live',
    screenModeEnabled: false, guestConfig: { requests: true }, testData: true, createdAt: new Date(), updatedAt: new Date() }); created.events.push(id)
  await db.doc(`eventSlugs/${id}`).set({ eventId: id })
  await db.doc(`events/${id}/state/requests`).set({ total: 2 })
  await db.doc(`events/${id}/requests/r1`).set({ guestUid: 'x', songTitle: 'Smoke 1', artist: null, message: null, status: 'pending', createdAt: Timestamp.now(), updatedAt: Timestamp.now() })
  await db.doc(`events/${id}/requests/r2`).set({ guestUid: 'x', songTitle: 'Smoke 2', artist: null, message: null, status: 'pending', createdAt: Timestamp.now(), updatedAt: Timestamp.now() })
  await db.doc(`events/${id}/dedications/d1`).set({ senderName: 'Z', message: 'smoke', status: 'pending', createdAt: Timestamp.now(), updatedAt: Timestamp.now() })
  const email = `${ownerUid}@example.invalid`, password = `Pw-${stamp}-${Math.random().toString(36).slice(2)}!`
  await auth.createUser({ uid: ownerUid, email, password, emailVerified: true }); created.authUsers.push(ownerUid)
  return { ownerUid, id, slug: id, email, password }
}

async function cdp(url) {
  const ws = new WebSocket(url); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0; const pending = new Map(), events = []
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } else events.push(d) }
  return { send: (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) }), events, close: () => ws.close() }
}

const PAGE_SCRIPT = (cfg, key, S) => `(async () => {
  const V = '11.10.0', base = 'https://www.gstatic.com/firebasejs/' + V + '/'
  const [{ initializeApp }, { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken }, { getAuth, signInWithEmailAndPassword, signInAnonymously, signOut }, { getFunctions, httpsCallable }] = await Promise.all([
    import(base + 'firebase-app.js'), import(base + 'firebase-app-check.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-functions.js')])
  const app = initializeApp(${JSON.stringify(cfg)})
  const ac = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(${JSON.stringify(key)}), isTokenAutoRefreshEnabled: false })
  const tok = await getToken(ac, false)
  const auth = getAuth(app), fns = getFunctions(app, 'europe-west1')
  const call = async (name, data) => { try { const r = await httpsCallable(fns, name)(data); return { ok: true, data: r.data } } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason } } }
  const S = ${JSON.stringify(S)}, out = { origin: location.origin, token: !!tok.token }
  await signInWithEmailAndPassword(auth, S.email, S.password)
  out.createPoll = await call('createPoll', { eventId: S.id, question: 'Smoke: A o B?', options: ['A', 'B', 'C'] })
  out.updateEventConfig = await call('updateEventConfig', { eventId: S.id, screenConfig: { show_polls: true }, guestConfig: { requests: true, music_battle: true }, eventFields: { title: 'TEST SMOKE v2' } })
  await signOut(auth); const g = await signInAnonymously(auth); out.guestUid = g.user.uid
  out.publicAsGuest = await call('getPublicEvent', { slug: S.slug })
  out.vote = await call('votePoll', { eventId: S.id, pollId: out.createPoll.data && out.createPoll.data.pollId, optionIndex: 1 })
  out.voteAgain = await call('votePoll', { eventId: S.id, pollId: out.createPoll.data && out.createPoll.data.pollId, optionIndex: 1 })
  out.guestCannotModerate = await call('moderateRequest', { eventId: S.id, requestId: 'r1', action: 'set_status', status: 'approved' })
  await signOut(auth); await signInWithEmailAndPassword(auth, S.email, S.password)
  out.approveReq = await call('moderateRequest', { eventId: S.id, requestId: 'r1', action: 'set_status', status: 'approved' })
  out.deleteReq = await call('moderateRequest', { eventId: S.id, requestId: 'r2', action: 'delete' })
  out.approveDed = await call('moderateDedication', { eventId: S.id, dedicationId: 'd1', action: 'set_status', status: 'approved' })
  out.closePoll = await call('setPollStatus', { eventId: S.id, pollId: out.createPoll.data && out.createPoll.data.pollId, open: false })
  out.publicAsOwner = await call('getPublicEvent', { slug: S.slug })
  return JSON.stringify(out)
})()`

async function run() {
  const S = await seed(); const startedAt = new Date(Date.now() - 5000).toISOString()
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  let page, out
  try {
    let targets; for (let i = 0; i < 40 && !targets; i++) { await sleep(500); try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json() } catch {} }
    assert.ok(targets, 'Chrome did not expose the debugging port')
    page = await cdp((targets.find((t) => t.type === 'page') ?? targets[0]).webSocketDebuggerUrl)
    await page.send('Page.enable'); await page.send('Page.setBypassCSP', { enabled: true }); await page.send('Page.navigate', { url: 'https://www.iomixo.com/' })
    for (let i = 0; i < 60 && !page.events.some((e) => e.method === 'Page.loadEventFired'); i++) await sleep(500)
    const res = await page.send('Runtime.evaluate', { expression: PAGE_SCRIPT(webConfig, siteKey, S), awaitPromise: true, returnByValue: true })
    if (res.result.exceptionDetails) throw new Error('page script failed: ' + JSON.stringify(res.result.exceptionDetails).slice(0, 400))
    out = JSON.parse(res.result.result.value); created.authUsers.push(out.guestUid)
  } finally { try { page && page.close() } catch {} chrome.kill('SIGTERM'); try { execSync(`pkill -f "remote-debugging-port=${PORT}"`) } catch {} }

  const rsn = (r) => (r.ok ? 'ok' : `${r.code}:${r.reason}`)
  check('real origin https://www.iomixo.com + App Check token obtained', out.origin === 'https://www.iomixo.com' && out.token === true)
  check('createPoll (owner, Advance via Firestore entitlement): poll created', out.createPoll.ok && !!out.createPoll.data.pollId, rsn(out.createPoll))
  const pollId = out.createPoll.data && out.createPoll.data.pollId
  const poll = (await db.doc(`events/${S.id}/polls/${pollId}`).get()).data()
  check('poll is Firestore-only: 3 options, NO legacySupabaseId (final state closed: the script closed it last)', poll?.status === 'closed' && poll.options.length === 3 && !('legacySupabaseId' in poll))
  check('updateEventConfig: config + guest config + mirrored title written', out.updateEventConfig.ok, rsn(out.updateEventConfig))
  const ev = (await db.doc(`events/${S.id}`).get()).data()
  check('event doc: screenConfig, guestConfig, title updated; ownerUid / type / status untouched', ev.screenConfig?.show_polls === true && ev.guestConfig?.music_battle === true && ev.title === 'TEST SMOKE v2' && ev.ownerUid === S.ownerUid && ev.type === 'party' && ev.status === 'live')
  check('getPublicEvent as anonymous guest: legacy payload shape (plan wedding, features, session)', out.publicAsGuest.ok && out.publicAsGuest.data.eventId === S.id && out.publicAsGuest.data.plan === 'wedding' && out.publicAsGuest.data.session.event_name === 'TEST SMOKE v2' && out.publicAsGuest.data.features.livePolls === true, rsn(out.publicAsGuest))
  check('votePoll on the Firestore-only poll (guest, enforce=true, valid token): vote accepted', out.vote.ok && out.vote.data.optionIndex === 1 && out.vote.data.changed === false, rsn(out.vote))
  check('votePoll again with the same option: idempotent (alreadyVoted)', out.voteAgain.ok && out.voteAgain.data.alreadyVoted === true, rsn(out.voteAgain))
  const vote = (await db.doc(`events/${S.id}/polls/${pollId}/votes/${out.guestUid}`).get()).data()
  const shards = (await db.collection(`events/${S.id}/polls/${pollId}/tally`).get()).docs.map((d) => d.data().counts ?? {})
  const sum = (k) => shards.reduce((a, c) => a + (c[k] ?? 0), 0)
  check('vote doc keyed by the guest token uid; tally [0,1,0]', vote?.optionIndex === 1 && sum('o0') === 0 && sum('o1') === 1 && sum('o2') === 0)
  check('a guest cannot moderate (account_required), and the request was still pending when the owner approved it afterwards', !out.guestCannotModerate.ok && out.guestCannotModerate.reason === 'account_required' && out.approveReq.data && out.approveReq.data.changed === true, rsn(out.guestCannotModerate))
  check('moderateRequest approve (owner)', out.approveReq.ok && out.approveReq.data.status === 'approved' && (await db.doc(`events/${S.id}/requests/r1`).get()).data().status === 'approved', rsn(out.approveReq))
  check('moderateRequest delete (owner): doc removed, counter 2 → 1', out.deleteReq.ok && !(await db.doc(`events/${S.id}/requests/r2`).get()).exists && (await db.doc(`events/${S.id}/state/requests`).get()).data().total === 1, rsn(out.deleteReq))
  check('moderateDedication approve (owner)', out.approveDed.ok && (await db.doc(`events/${S.id}/dedications/d1`).get()).data().status === 'approved', rsn(out.approveDed))
  check('setPollStatus close (owner)', out.closePoll.ok && (await db.doc(`events/${S.id}/polls/${pollId}`).get()).data().status === 'closed', rsn(out.closePoll))
  check('getPublicEvent as owner: ok', out.publicAsOwner.ok, rsn(out.publicAsOwner))

  await sleep(8000)
  const logs = (fn, filter) => JSON.parse(execSync(`gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="${fn.toLowerCase()}" AND timestamp>="${startedAt}" AND ${filter}' --project=${PROJECT} --format=json --limit=50`, { maxBuffer: 20_000_000 }).toString() || '[]').map((l) => l.jsonPayload ?? {})
  for (const fn of ['createPoll', 'updateEventConfig', 'getPublicEvent', 'votePoll', 'moderateRequest', 'moderateDedication', 'setPollStatus']) {
    let ac = []; for (let i = 0; i < 10; i++) { ac = logs(fn, 'jsonPayload.message="app_check"'); if (ac.length) break; await sleep(4000) }
    const valid = ac.filter((l) => l.appCheck === 'valid').length
    check(`${fn}: app_check logs all valid`, ac.length > 0 && valid === ac.length, `valid=${valid}/${ac.length} enforcement=${[...new Set(ac.map((l) => l.enforcement))]}`)
  }
  const bridge = logs('votePoll', 'jsonPayload.message="legacy_bridge_mock"')
  check('votePoll on the native poll: no legacy bridge call at all (no Supabase, not even the mock)', bridge.length === 0, `entries=${bridge.length}`)
}

async function cleanup() {
  for (const id of created.events) { await db.recursiveDelete(db.doc(`events/${id}`)); await db.doc(`eventSlugs/${id}`).delete() }
  for (const id of created.owners) await db.doc(`users/${id}`).delete()
  for (const uid of created.authUsers) await auth.deleteUser(uid).catch((e) => { if (e.code !== 'auth/user-not-found') throw e })
  const left = (await db.collection('events').listDocuments()).filter((r) => r.id.startsWith(PREFIX)).length
  const strayUsers = (await db.collection('users').listDocuments()).filter((r) => r.id.startsWith('smk-owner-') || r.id.startsWith('acown-owner-')).length
  const slugs = (await db.collection('eventSlugs').listDocuments()).filter((r) => r.id.startsWith(PREFIX) || r.id.startsWith('firebase-test-acown-')).length
  const authLeft = (await auth.listUsers(1000)).users.filter((u) => u.providerData.length === 0 || /@example\.invalid$/.test(u.email || '')).length
  console.log(JSON.stringify({ testEventsLeft: left, strayTestOwnerDocs: strayUsers, strayTestSlugs: slugs, testOrAnonymousAuthUsersLeft: authLeft }))
  check('cleanup: 0 test events, 0 test owner docs, 0 test slugs, 0 test/anonymous Auth users', left === 0 && strayUsers === 0 && slugs === 0 && authLeft === 0)
}

;(async () => { try { await run() } catch (e) { results.push(false); console.error('FATAL', e && e.message ? e.message : e) } finally { await cleanup() } console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1) })()
