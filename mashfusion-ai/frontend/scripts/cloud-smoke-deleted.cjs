/**
 * CLOUD SMOKE of soft delete / restore across the 8 pre-existing callables that share the "deleted event = not found" logic, on iomixo-494817.
 * SYNTHETIC data only (throw-away owner `del-owner-*`, event `firebase-test-del-*` titled `TEST DEL`); everything is deleted at the end.
 *
 *   NODE_PATH=../backend/node_modules FIREBASE_PROJECT_ID=iomixo-494817 node scripts/cloud-smoke-deleted.cjs
 *
 * Stages (one real Chrome on https://www.iomixo.com, ONE Firebase app with App Check, so enforced callables get a valid token):
 *   1 live baseline      every callable works            2 deleteEvent
 *   3 deleted            the 8 callables MUST fail with event_not_found (a slug is re-created by the script to prove getPublicEvent checks deletedAt itself)
 *   4 restored (ended)   owner paths + getPublicEvent work again, guest writes are refused with event_ended (the event is closed, not deleted)
 *   5 reopened (live)    guest writes work again
 */
const { readFileSync } = require('node:fs')
const { execSync, spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')

const PROJECT = 'iomixo-494817', PORT = 9337, PREFIX = 'firebase-test-del-'
const PROFILE = process.env.CHROME_PROFILE_DIR ?? '/tmp/chrome-smoke-profile'
if (process.env.FIREBASE_PROJECT_ID !== PROJECT) throw new Error('set FIREBASE_PROJECT_ID=' + PROJECT)
if (Object.keys(process.env).some((k) => k.startsWith('SUPABASE'))) throw new Error('SUPABASE_* env present: refusing')
const env = Object.fromEntries(readFileSync(__dirname + '/../.env.production.local', 'utf8').split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const webConfig = { apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, appId: env.NEXT_PUBLIC_FIREBASE_APP_ID }
const siteKey = env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY

initializeApp({ projectId: PROJECT })
const db = getFirestore(), auth = getAuth()
let runStartedMs = Date.now()
const results = [], created = { events: [], owners: [], authUsers: [] }
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))



const EXPECTED_REVISIONS = process.env.EXPECTED_REVISIONS ? JSON.parse(process.env.EXPECTED_REVISIONS) : null

async function seed() {
  const stamp = Date.now().toString(36), ownerUid = `del-owner-${stamp}`, id = `${PREFIX}${stamp}`
  await db.doc(`users/${ownerUid}`).set({ uid: ownerUid, plan: { tier: 'wedding', source: 'legacy' }, testData: true, createdAt: new Date(), updatedAt: new Date() }); created.owners.push(ownerUid)
  await db.doc(`events/${id}`).set({ ownerUid, slug: id, legacySupabaseId: `mock-session-${id}`, title: 'TEST DEL', djName: 'test', description: null, type: 'party', status: 'live',
    screenModeEnabled: false, guestConfig: { requests: true }, requestLimit: 30, dedicationsEnabled: true, testData: true, createdAt: new Date(), updatedAt: new Date() }); created.events.push(id)
  await db.doc(`eventSlugs/${id}`).set({ eventId: id })
  await db.doc(`events/${id}/requests/r1`).set({ guestUid: 'x', songTitle: 'Smoke 1', artist: null, message: null, status: 'pending', createdAt: Timestamp.now(), updatedAt: Timestamp.now() })
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

// Stage 0 installs window.__h; every later stage is a small script run in the same page (same App Check, same app).
const INIT = (cfg, key) => `(async () => {
  const V = '11.10.0', base = 'https://www.gstatic.com/firebasejs/' + V + '/'
  const [{ initializeApp }, { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken }, { getAuth, signInWithEmailAndPassword, signInAnonymously, signOut }, { getFunctions, httpsCallable }] = await Promise.all([
    import(base + 'firebase-app.js'), import(base + 'firebase-app-check.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-functions.js')])
  const app = initializeApp(${JSON.stringify(cfg)})
  const ac = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(${JSON.stringify(key)}), isTokenAutoRefreshEnabled: false })
  const tok = await getToken(ac, false)
  const auth = getAuth(app), fns = getFunctions(app, 'europe-west1')
  window.__h = {
    call: async (name, data) => { try { const r = await httpsCallable(fns, name)(data); return { ok: true, data: r.data } } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason } } },
    owner: async (S) => { await signOut(auth); await signInWithEmailAndPassword(auth, S.email, S.password) },
    guest: async () => { await signOut(auth); const g = await signInAnonymously(auth); return g.user.uid },
  }
  return JSON.stringify({ origin: location.origin, token: !!tok.token })
})()`
const STAGE = (body) => `(async () => { const h = window.__h, out = {}; ${body}; return JSON.stringify(out) })()`

const S1 = (S) => STAGE(`
  await h.owner(${JSON.stringify(S)})
  out.createPoll = await h.call('createPoll', { eventId: ${JSON.stringify(S.id)}, question: 'Smoke DEL?', options: ['A', 'B'] })
  const poll = out.createPoll.data && out.createPoll.data.pollId; out.poll = poll
  out.guest = await h.guest()
  out.createMusicRequest = await h.call('createMusicRequest', { eventId: ${JSON.stringify(S.id)}, songTitle: 'Baseline song' })
  out.createDedication = await h.call('createDedication', { eventId: ${JSON.stringify(S.id)}, senderName: 'G', message: 'baseline' })
  out.votePoll = await h.call('votePoll', { eventId: ${JSON.stringify(S.id)}, pollId: poll, optionIndex: 0 })
  out.getPublicEvent = await h.call('getPublicEvent', { slug: ${JSON.stringify(S.slug)} })
  await h.owner(${JSON.stringify(S)})
  out.moderateRequest = await h.call('moderateRequest', { eventId: ${JSON.stringify(S.id)}, requestId: 'r1', action: 'set_status', status: 'approved' })
  out.moderateDedication = await h.call('moderateDedication', { eventId: ${JSON.stringify(S.id)}, dedicationId: 'd1', action: 'set_status', status: 'approved' })
  out.setPollStatus = await h.call('setPollStatus', { eventId: ${JSON.stringify(S.id)}, pollId: poll, open: false })`)
const S2 = (S) => STAGE(`await h.owner(${JSON.stringify(S)}); out.deleteEvent = await h.call('deleteEvent', { eventId: ${JSON.stringify(S.id)} })`)
const S3 = (S, poll) => STAGE(`
  out.guest = await h.guest()
  out.createMusicRequest = await h.call('createMusicRequest', { eventId: ${JSON.stringify(S.id)}, songTitle: 'After delete' })
  out.createDedication = await h.call('createDedication', { eventId: ${JSON.stringify(S.id)}, senderName: 'G', message: 'after delete' })
  out.votePoll = await h.call('votePoll', { eventId: ${JSON.stringify(S.id)}, pollId: ${JSON.stringify(poll)}, optionIndex: 1 })
  out.getPublicEvent = await h.call('getPublicEvent', { slug: ${JSON.stringify(S.slug)} })
  await h.owner(${JSON.stringify(S)})
  out.moderateRequest = await h.call('moderateRequest', { eventId: ${JSON.stringify(S.id)}, requestId: 'r1', action: 'set_status', status: 'rejected' })
  out.moderateDedication = await h.call('moderateDedication', { eventId: ${JSON.stringify(S.id)}, dedicationId: 'd1', action: 'set_status', status: 'rejected' })
  out.createPoll = await h.call('createPoll', { eventId: ${JSON.stringify(S.id)}, question: 'After delete?', options: ['A', 'B'] })
  out.setPollStatus = await h.call('setPollStatus', { eventId: ${JSON.stringify(S.id)}, pollId: ${JSON.stringify(poll)}, open: true })
  out.updateEventConfig = await h.call('updateEventConfig', { eventId: ${JSON.stringify(S.id)}, eventFields: { title: 'zombie' } })`)
const S4 = (S, poll) => STAGE(`
  await h.owner(${JSON.stringify(S)})
  out.restoreEvent = await h.call('restoreEvent', { eventId: ${JSON.stringify(S.id)} })
  out.guest = await h.guest()
  out.createMusicRequest = await h.call('createMusicRequest', { eventId: ${JSON.stringify(S.id)}, songTitle: 'Restored but ended' })
  out.createDedication = await h.call('createDedication', { eventId: ${JSON.stringify(S.id)}, senderName: 'G', message: 'restored but ended' })
  out.votePoll = await h.call('votePoll', { eventId: ${JSON.stringify(S.id)}, pollId: ${JSON.stringify(poll)}, optionIndex: 1 })
  out.getPublicEvent = await h.call('getPublicEvent', { slug: ${JSON.stringify(S.slug)} })
  await h.owner(${JSON.stringify(S)})
  out.moderateRequest = await h.call('moderateRequest', { eventId: ${JSON.stringify(S.id)}, requestId: 'r1', action: 'set_status', status: 'pending' })
  out.moderateDedication = await h.call('moderateDedication', { eventId: ${JSON.stringify(S.id)}, dedicationId: 'd1', action: 'set_status', status: 'pending' })
  out.createPoll = await h.call('createPoll', { eventId: ${JSON.stringify(S.id)}, question: 'After restore?', options: ['A', 'B'] })
  out.poll2 = out.createPoll.data && out.createPoll.data.pollId
  out.setPollStatus = await h.call('setPollStatus', { eventId: ${JSON.stringify(S.id)}, pollId: out.poll2, open: true })
  out.reopen = await h.call('updateEventConfig', { eventId: ${JSON.stringify(S.id)}, eventFields: { status: 'live' } })`)
const S5 = (S, poll2) => STAGE(`
  out.guest = await h.guest()
  out.createMusicRequest = await h.call('createMusicRequest', { eventId: ${JSON.stringify(S.id)}, songTitle: 'Reopened song' })
  out.createDedication = await h.call('createDedication', { eventId: ${JSON.stringify(S.id)}, senderName: 'G', message: 'reopened' })
  out.votePoll = await h.call('votePoll', { eventId: ${JSON.stringify(S.id)}, pollId: ${JSON.stringify(poll2)}, optionIndex: 1 })
  out.getPublicEvent = await h.call('getPublicEvent', { slug: ${JSON.stringify(S.slug)} })`)

async function run() {
  const S = await seed(); runStartedMs = Date.now() - 5000; const startedAt = new Date(runStartedMs).toISOString()
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  let page; const R = {}, T = {}, A = {}
  const ev = async (expr) => { const res = await page.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (res.result.exceptionDetails) throw new Error('page script failed: ' + JSON.stringify(res.result.exceptionDetails).slice(0, 400)); return JSON.parse(res.result.result.value) }
  try {
    let targets; for (let i = 0; i < 40 && !targets; i++) { await sleep(500); try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json() } catch {} }
    assert.ok(targets, 'Chrome did not expose the debugging port')
    page = await cdp((targets.find((t) => t.type === 'page') ?? targets[0]).webSocketDebuggerUrl)
    await page.send('Page.enable'); await page.send('Page.setBypassCSP', { enabled: true }); await page.send('Page.navigate', { url: 'https://www.iomixo.com/' })
    for (let i = 0; i < 60 && !page.events.some((e) => e.method === 'Page.loadEventFired'); i++) await sleep(500)
    R.init = await ev(INIT(webConfig, siteKey))
    R.s1 = await ev(S1(S)); created.authUsers.push(R.s1.guest)
    T.delete = new Date().toISOString()
    R.s2 = await ev(S2(S))
    // The script re-creates the slug of the DELETED event: getPublicEvent must still say not-found because it checks deletedAt itself (old code would serve it).
    await db.doc(`eventSlugs/${S.slug}`).set({ eventId: S.id })
    T.deleted = new Date().toISOString()
    R.s3 = await ev(S3(S, R.s1.poll)); created.authUsers.push(R.s3.guest)
    const count = async (c) => (await db.collection(`events/${S.id}/${c}`).get()).size
    A.deletedDoc = (await db.doc(`events/${S.id}`).get()).data()                   // state WHILE deleted, before the restore
    A.r1 = (await db.doc(`events/${S.id}/requests/r1`).get()).data().status; A.d1 = (await db.doc(`events/${S.id}/dedications/d1`).get()).data().status
    A.counts3 = { requests: await count('requests'), dedications: await count('dedications'), polls: await count('polls') }
    T.restore = new Date().toISOString()
    await db.doc(`eventSlugs/${S.slug}`).delete()                                   // back to the real state of a deleted event before restoring
    R.s4 = await ev(S4(S, R.s1.poll)); created.authUsers.push(R.s4.guest)
    A.counts4 = { requests: await count('requests'), dedications: await count('dedications'), polls: await count('polls') }   // after restore (still ended)
    T.reopened = new Date().toISOString()
    R.s5 = await ev(S5(S, R.s4.poll2)); created.authUsers.push(R.s5.guest)
    T.end = new Date().toISOString()
    A.counts5 = { requests: await count('requests'), dedications: await count('dedications'), polls: await count('polls') }
  } finally { try { page && page.close() } catch {} chrome.kill('SIGTERM'); try { execSync(`pkill -f "remote-debugging-port=${PORT}"`) } catch {} }

  const rsn = (r) => (r.ok ? 'ok' : `${r.code}:${r.reason}`)
  const notFound = (r) => !r.ok && r.code === 'functions/not-found' && r.reason === 'event_not_found'
  const ended = (r) => !r.ok && r.reason === 'event_ended'
  check('real origin https://www.iomixo.com + App Check token obtained', R.init.origin === 'https://www.iomixo.com' && R.init.token === true)

  // 1. baseline: every path works while the event is live
  for (const fn of ['createPoll', 'createMusicRequest', 'createDedication', 'votePoll', 'getPublicEvent', 'moderateRequest', 'moderateDedication', 'setPollStatus']) check(`[live] ${fn} works`, R.s1[fn].ok, rsn(R.s1[fn]))
  // 2. deleteEvent
  check('deleteEvent ok', R.s2.deleteEvent.ok && R.s2.deleteEvent.data.deleted === true, rsn(R.s2.deleteEvent))
  const d = A.deletedDoc
  check('soft delete markers (read while deleted): deletedAt + deletedBy, status ended; subcollections kept', !!d.deletedAt && d.deletedBy === S.ownerUid && d.status === 'ended' && A.counts3.requests >= 2 && A.counts3.dedications >= 2)
  // 3. every one of the 8 must fail with event_not_found (the slug was re-created: getPublicEvent proves the deletedAt check is live code)
  for (const fn of ['createMusicRequest', 'createDedication', 'votePoll', 'getPublicEvent', 'moderateRequest', 'moderateDedication', 'createPoll', 'setPollStatus']) check(`[DELETED] ${fn} fails with event_not_found`, notFound(R.s3[fn]), rsn(R.s3[fn]))
  check('[DELETED] updateEventConfig fails with event_not_found as well', notFound(R.s3.updateEventConfig), rsn(R.s3.updateEventConfig))
  check('nothing was written while deleted: r1 / d1 keep the status set before the delete (approved)', A.r1 === 'approved' && A.d1 === 'approved')
  check('no request / dedication / poll was created while deleted (counts equal the live baseline)', A.counts3.requests === 2 && A.counts3.dedications === 2 && A.counts3.polls === 1, JSON.stringify(A.counts3))
  // 4. restored (ended): owner paths work, public lookup works, guest writes are refused because the event is CLOSED, not because it is deleted
  check('restoreEvent ok', R.s4.restoreEvent.ok && R.s4.restoreEvent.data.restored === true, rsn(R.s4.restoreEvent))
  check('[restored, ended] getPublicEvent works again (is_active=false)', R.s4.getPublicEvent.ok && R.s4.getPublicEvent.data.session.is_active === false, rsn(R.s4.getPublicEvent))
  for (const fn of ['moderateRequest', 'moderateDedication', 'createPoll', 'setPollStatus']) check(`[restored, ended] owner ${fn} works again`, R.s4[fn].ok, rsn(R.s4[fn]))
  for (const fn of ['createMusicRequest', 'createDedication', 'votePoll']) check(`[restored, ended] guest ${fn} refused with event_ended (closed, no longer "deleted")`, ended(R.s4[fn]), rsn(R.s4[fn]))
  // 5. reopened: everything works
  check('owner reopens the event (status live)', R.s4.reopen.ok, rsn(R.s4.reopen))
  for (const fn of ['createMusicRequest', 'createDedication', 'votePoll', 'getPublicEvent']) check(`[reopened] ${fn} works`, R.s5[fn].ok, rsn(R.s5[fn]))
  check('guest writes after the restore (event ended) created nothing; after reopening: exactly +1 request +1 dedication', A.counts4.requests === 2 && A.counts4.dedications === 2 && A.counts5.requests === 3 && A.counts5.dedications === 3, JSON.stringify({ ended: A.counts4, reopened: A.counts5 }))

  // logs: new revisions served, App Check valid, no bridge call while deleted, no ERROR
  await sleep(10000)
  const read = (fn, filter, from = startedAt, to = new Date().toISOString()) => JSON.parse(execSync(`gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="${fn.toLowerCase()}" AND timestamp>="${from}" AND timestamp<="${to}" AND ${filter}' --project=${PROJECT} --format=json --limit=80`, { maxBuffer: 20_000_000 }).toString() || '[]')
  for (const fn of ['createMusicRequest', 'createDedication', 'votePoll', 'getPublicEvent', 'moderateRequest', 'moderateDedication', 'createPoll', 'setPollStatus']) {
    let ac = []; for (let i = 0; i < 8; i++) { ac = read(fn, 'jsonPayload.message="app_check"'); if (ac.length) break; await sleep(4000) }
    const valid = ac.filter((l) => l.jsonPayload.appCheck === 'valid').length
    const revs = [...new Set(ac.map((l) => l.resource.labels.revision_name))]
    const enf = [...new Set(ac.map((l) => l.jsonPayload.enforcement))]
    const okRev = !EXPECTED_REVISIONS || (revs.length === 1 && revs[0] === EXPECTED_REVISIONS[fn])
    check(`${fn}: app_check valid on every call, served by the NEW revision`, ac.length > 0 && valid === ac.length && okRev, `calls=${ac.length} valid=${valid} enforcement=${enf} revision=${revs}`)
    const errs = read(fn, 'severity>=ERROR')
    check(`${fn}: no ERROR log during the run`, errs.length === 0, `errors=${errs.length}`)
  }
  for (const fn of ['createMusicRequest', 'createDedication', 'votePoll']) {
    const during = read(fn, 'jsonPayload.message:"legacy_bridge"', T.deleted, T.restore)
    check(`${fn}: no legacy bridge / Supabase activity while the event was deleted`, during.length === 0, `entries=${during.length}`)
  }
}

async function cleanup() {
  const owned = []
  for (const uid of created.owners) { const q = await db.collection('events').where('ownerUid', '==', uid).get(); q.docs.forEach((d) => owned.push(d)) }
  for (const d of owned) { const slug = d.data().slug; await db.recursiveDelete(d.ref); if (slug) { const s = db.doc(`eventSlugs/${slug}`); if ((await s.get()).exists) await s.delete() } }
  for (const id of created.owners) await db.doc(`users/${id}`).delete()
  for (const u of (await auth.listUsers(1000)).users) if (u.providerData.length === 0 && !u.email && new Date(u.metadata.creationTime).getTime() >= runStartedMs) created.authUsers.push(u.uid)
  for (const uid of created.authUsers) await auth.deleteUser(uid).catch((e) => { if (e.code !== 'auth/user-not-found') throw e })
  const strayEvents = (await db.collection('events').where('title', 'in', ['TEST DEL', 'zombie']).get()).size
  const strayUsers = (await db.collection('users').listDocuments()).filter((r) => r.id.startsWith('del-owner-')).length
  const slugs = (await db.collection('eventSlugs').listDocuments()).filter((r) => r.id.startsWith(PREFIX)).length
  const authLeft = (await auth.listUsers(1000)).users.filter((u) => u.providerData.length === 0 || /@example\.invalid$/.test(u.email || '')).length
  console.log(JSON.stringify({ testEventsLeft: strayEvents, strayTestOwnerDocs: strayUsers, strayTestSlugs: slugs, testOrAnonymousAuthUsersLeft: authLeft }))
  check('cleanup: 0 test events, 0 owner docs, 0 slugs, 0 test/anonymous Auth users', strayEvents === 0 && strayUsers === 0 && slugs === 0 && authLeft === 0)
}

;(async () => { try { await run() } catch (e) { results.push(false); console.error('FATAL', e && e.message ? e.message : e) } finally { await cleanup() } console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1) })()
