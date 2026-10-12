/**
 * CLOUD SMOKE of the event-lifecycle + games callables (createEvent, deleteEvent, restoreEvent, ownerGameAction, setGameConfig, updateEventConfig),
 * on iomixo-494817, SYNTHETIC data only (throw-away owner `lc-owner-*`, events titled `TEST LC`, everything deleted at the end).
 *
 *   NODE_PATH=../backend/node_modules FIREBASE_PROJECT_ID=iomixo-494817 node scripts/cloud-smoke-lifecycle.cjs
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

const PROJECT = 'iomixo-494817', PORT = 9336, PREFIX = 'firebase-test-lc-'
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


async function seed() {
  const stamp = Date.now().toString(36), ownerUid = `lc-owner-${stamp}`
  await db.doc(`users/${ownerUid}`).set({ uid: ownerUid, plan: { tier: 'wedding', source: 'legacy' }, testData: true, createdAt: new Date(), updatedAt: new Date() }); created.owners.push(ownerUid)
  const email = `${ownerUid}@example.invalid`, password = `Pw-${stamp}-${Math.random().toString(36).slice(2)}!`
  await auth.createUser({ uid: ownerUid, email, password, emailVerified: true }); created.authUsers.push(ownerUid)
  return { ownerUid, email, password, requestId: `lc${stamp}` }
}

async function cdp(url) {
  const ws = new WebSocket(url); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0; const pending = new Map(), events = []
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } else events.push(d) }
  return { send: (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) }), events, close: () => ws.close() }
}

const PAGE_SCRIPT = (cfg, key, S) => `(async () => {
  const V = '11.10.0', base = 'https://www.gstatic.com/firebasejs/' + V + '/'
  const [{ initializeApp }, { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken }, { getAuth, signInWithEmailAndPassword, signInAnonymously, signOut }, { getFunctions, httpsCallable }, { getFirestore, doc, getDoc, getDocs, collection }] = await Promise.all([
    import(base + 'firebase-app.js'), import(base + 'firebase-app-check.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-functions.js'), import(base + 'firebase-firestore.js')])
  const app = initializeApp(${JSON.stringify(cfg)})
  const ac = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(${JSON.stringify(key)}), isTokenAutoRefreshEnabled: false })
  const tok = await getToken(ac, false)
  const auth = getAuth(app), fns = getFunctions(app, 'europe-west1'), db = getFirestore(app)
  const call = async (name, data) => { try { const r = await httpsCallable(fns, name)(data); return { ok: true, data: r.data } } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason } } }
  const read = async (fn) => { try { const s = await fn(); return { ok: true, exists: s.exists ? s.exists() : undefined, data: s.data ? s.data() : undefined, size: s.size } } catch (e) { return { ok: false, code: e.code } } }
  const S = ${JSON.stringify(S)}, out = { origin: location.origin, token: !!tok.token }
  await signInWithEmailAndPassword(auth, S.email, S.password)
  out.create = await call('createEvent', { requestId: S.requestId, title: 'TEST LC', type: 'wedding', djName: 'test', coupleNames: 'A & B', weddingDate: '2026-09-12', venueName: 'Sala', screenModeEnabled: true, ownerUid: 'attacker' })
  out.replay = await call('createEvent', { requestId: S.requestId, title: 'TEST LC' })
  const id = out.create.data && out.create.data.eventId, slug = out.create.data && out.create.data.slug
  out.update = await call('updateEventConfig', { eventId: id, eventFields: { title: 'TEST LC v2', djName: 'dj2' }, screenConfig: { show_polls: true } })
  out.cfg = await call('setGameConfig', { eventId: id, roulettePenitenze: [{ label: 'Penitenza LC', category: 'soft', enabled: true }], shoeGameQuestions: ['LC uno?', 'LC due?'] })
  out.rStart = await call('ownerGameAction', { eventId: id, game: 'roulette', action: 'start', categories: ['soft'] })
  out.rSpin = await call('ownerGameAction', { eventId: id, game: 'roulette', action: 'spin' })
  out.sStart = await call('ownerGameAction', { eventId: id, game: 'shoe', action: 'start' })
  out.sNext = await call('ownerGameAction', { eventId: id, game: 'shoe', action: 'next' })
  out.ownerPrivate = await read(() => getDoc(doc(db, 'events', id, 'private', 'gameConfig')))
  out.ownerEvent = await read(() => getDoc(doc(db, 'events', id)))
  await signOut(auth); const g = await signInAnonymously(auth); out.guestUid = g.user.uid
  out.guestPrivate = await read(() => getDoc(doc(db, 'events', id, 'private', 'gameConfig')))
  out.guestEventBefore = await read(() => getDoc(doc(db, 'events', id)))
  out.guestGames = await read(() => getDocs(collection(db, 'events', id, 'games')))
  out.guestPublicBefore = await call('getPublicEvent', { slug })
  out.guestCannotCreate = await call('createEvent', { requestId: S.requestId + 'g', title: 'x' })
  out.guestCannotGame = await call('ownerGameAction', { eventId: id, game: 'shoe', action: 'start' })
  await signOut(auth); await signInWithEmailAndPassword(auth, S.email, S.password)
  out.del = await call('deleteEvent', { eventId: id })
  out.delAgain = await call('deleteEvent', { eventId: id })
  out.ownerUpdateDeleted = await call('updateEventConfig', { eventId: id, eventFields: { title: 'zombie' } })
  await signOut(auth); await signInAnonymously(auth)
  out.guestEventAfter = await read(() => getDoc(doc(db, 'events', id)))
  out.guestSlugAfter = await read(() => getDoc(doc(db, 'eventSlugs', slug)))
  out.guestPublicAfter = await call('getPublicEvent', { slug })
  await signOut(auth); await signInWithEmailAndPassword(auth, S.email, S.password)
  out.restore = await call('restoreEvent', { eventId: id })
  out.slugBack = await read(() => getDoc(doc(db, 'eventSlugs', slug)))
  return JSON.stringify(out)
})()`

async function run() {
  const S = await seed(); const startedAt = new Date(Date.now() - 5000).toISOString()
  runStartedMs = Date.now() - 5000
  // eventIdFor(uid, requestId) is deterministic: watch the event document through the WHOLE run (create → edit → delete → restore).
  const watchId = 'e' + require('node:crypto').createHash('sha256').update(`${S.ownerUid}:${S.requestId}`).digest('hex').slice(0, 24)
  const history = []; const unwatch = db.doc(`events/${watchId}`).onSnapshot((snap) => history.push(snap.exists ? snap.data() : null))
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
  const id = out.create.data && out.create.data.eventId, slug = out.create.data && out.create.data.slug
  if (id) created.events.push(id)
  check('real origin https://www.iomixo.com + App Check token obtained', out.origin === 'https://www.iomixo.com' && out.token === true)
  check('createEvent (Advance owner): event + slug returned', out.create.ok && !!id && /^[a-z0-9]{10,}$/.test(slug), rsn(out.create))
  check('createEvent replay with the same requestId is idempotent (same event, created=false)', out.replay.ok && out.replay.data.eventId === id && out.replay.data.created === false, rsn(out.replay))
  unwatch()
  const ev = history.find((d) => d)
  check('event doc at creation: ownerUid from the token (not the payload), origin firebase, no Supabase id, wedding fields, live', id === watchId && ev.ownerUid === S.ownerUid && ev.origin === 'firebase' && !('legacySupabaseId' in ev) && ev.type === 'wedding' && ev.coupleNames === 'A & B' && ev.venueName === 'Sala' && ev.screenModeEnabled === true && ev.status === 'live' && ev.guestConfig === null && ev.screenConfig === null)
  check('eventSlugs/{slug} points to the event (atomic)', (await db.doc(`eventSlugs/${slug}`).get()).data()?.eventId === id)
  check('updateEventConfig: core fields + screenConfig written', out.update.ok && out.update.data.updated.includes('title'), rsn(out.update))
  check('setGameConfig + private/gameConfig stored', out.cfg.ok && (await db.doc(`events/${id}/private/gameConfig`).get()).data()?.roulettePenitenze?.[0]?.label === 'Penitenza LC', rsn(out.cfg))
  check('roulette start + spin (uses the custom penalty)', out.rStart.ok && out.rSpin.ok && out.rSpin.data.status === 'completed', `${rsn(out.rStart)} / ${rsn(out.rSpin)}`)
  const games = (await db.collection(`events/${id}/games`).get()).docs.map((d) => d.data())
  const roulette = games.find((g) => g.type === 'wedding_roulette'), shoe = games.find((g) => g.type === 'shoe_game')
  check('roulette round: result.slot_label = custom penalty, status completed', roulette?.status === 'completed' && roulette.result?.slot_label === 'Penitenza LC')
  check('shoe start + next: custom questions, current_index 1, still running', out.sStart.ok && out.sNext.ok && shoe?.config?.questions?.join('|') === 'LC uno?|LC due?' && shoe.config.current_index === 1 && shoe.status === 'running', `${rsn(out.sStart)} / ${rsn(out.sNext)}`)
  check('owner CAN read events/{id}/private/gameConfig', out.ownerPrivate.ok && out.ownerPrivate.exists === true && out.ownerPrivate.data.shoeGameQuestions.length === 2, rsn(out.ownerPrivate))
  check('guest CANNOT read private/gameConfig (permission-denied)', !out.guestPrivate.ok && out.guestPrivate.code === 'permission-denied', JSON.stringify(out.guestPrivate).slice(0, 80))
  check('guest can read the live event and its game rounds (TV / guest page)', out.guestEventBefore.ok && out.guestEventBefore.exists === true && out.guestGames.ok && out.guestGames.size === 2 && out.guestPublicBefore.ok)
  check('guest cannot create events or run games (account_required)', !out.guestCannotCreate.ok && out.guestCannotCreate.reason === 'account_required' && !out.guestCannotGame.ok && out.guestCannotGame.reason === 'account_required')
  check('deleteEvent: ok, then idempotent (deleted=false)', out.del.ok && out.del.data.deleted === true && out.delAgain.ok && out.delAgain.data.deleted === false, `${rsn(out.del)} / ${rsn(out.delAgain)}`)
  const del = history.find((d) => d && d.deletedAt)
  check('soft delete (observed in the doc history): deletedAt/deletedBy set, status ended; the games subcollection is still there afterwards', !!del && del.deletedBy === S.ownerUid && del.status === 'ended' && (await db.collection(`events/${id}/games`).get()).size === 2)
  check('DELETED event NOT readable by a guest (rules): permission-denied', !out.guestEventAfter.ok && out.guestEventAfter.code === 'permission-denied', JSON.stringify(out.guestEventAfter).slice(0, 80))
  check('deleted event: slug no longer resolves; getPublicEvent not-found; owner edit not-found', out.guestSlugAfter.ok && out.guestSlugAfter.exists === false && !out.guestPublicAfter.ok && out.guestPublicAfter.reason === 'event_not_found' && !out.ownerUpdateDeleted.ok && out.ownerUpdateDeleted.reason === 'event_not_found')
  check('restoreEvent: ok, slug back, deletedAt cleared (event comes back as ended)', out.restore.ok && out.restore.data.restored === true && out.slugBack.exists === true && !('deletedAt' in (await db.doc(`events/${id}`).get()).data()) && (await db.doc(`events/${id}`).get()).data().status === 'ended', rsn(out.restore))

  // App Check without a token → still served (enforcement=false for owner callables) and LOGGED as absent: proves there is no bypass flag, only the observe-only parameter.
  const idTokenRes = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${webConfig.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: S.email, password: S.password, returnSecureToken: true }) })).json()
  const raw = await (await fetch(`https://europe-west1-${PROJECT}.cloudfunctions.net/restoreEvent`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idTokenRes.idToken}` }, body: JSON.stringify({ data: { eventId: id } }) })).json()
  check('call WITHOUT an App Check token is accepted (owner enforcement=false) and is a harmless no-op', raw.result?.restored === false)

  await sleep(8000)
  const logs = (fn, filter) => JSON.parse(execSync(`gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="${fn.toLowerCase()}" AND timestamp>="${startedAt}" AND ${filter}' --project=${PROJECT} --format=json --limit=60`, { maxBuffer: 20_000_000 }).toString() || '[]').map((l) => l.jsonPayload ?? {})
  for (const fn of ['createEvent', 'deleteEvent', 'restoreEvent', 'ownerGameAction', 'setGameConfig', 'updateEventConfig']) {
    let ac = []; for (let i = 0; i < 10; i++) { ac = logs(fn, 'jsonPayload.message="app_check"'); if (ac.length) break; await sleep(4000) }
    const valid = ac.filter((l) => l.appCheck === 'valid').length, absent = ac.filter((l) => l.appCheck === 'absent').length
    const authed = ac.filter((l) => l.anonymous === false || fn === 'ownerGameAction')
    check(`${fn}: app_check logged, enforcement=false, valid tokens present`, ac.length > 0 && valid > 0 && ac.every((l) => l.enforcement === false), `valid=${valid} absent=${absent} total=${ac.length}${fn === 'restoreEvent' ? ' (absent=1 is the deliberate token-less call)' : ''}`)
    void authed
    const bridge = logs(fn, 'jsonPayload.message:"legacy_bridge"')
    check(`${fn}: no legacy bridge / Supabase activity`, bridge.length === 0, `entries=${bridge.length}`)
    const errs = JSON.parse(execSync(`gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="${fn.toLowerCase()}" AND timestamp>="${startedAt}" AND severity>=ERROR' --project=${PROJECT} --format=json --limit=20`, { maxBuffer: 20_000_000 }).toString() || '[]')
    check(`${fn}: no ERROR-level log during the run`, errs.length === 0, `errors=${errs.length}`)
  }
}

async function cleanup() {
  const owned = []
  for (const uid of created.owners) { const q = await db.collection('events').where('ownerUid', '==', uid).get(); q.docs.forEach((d) => owned.push(d)) }
  for (const d of owned) { const slug = d.data().slug; await db.recursiveDelete(d.ref); if (slug) { const s = db.doc(`eventSlugs/${slug}`); if ((await s.get()).data()?.eventId === d.id) await s.delete() } }
  for (const id of created.owners) await db.doc(`users/${id}`).delete()
  for (const u of (await auth.listUsers(1000)).users) if (u.providerData.length === 0 && !u.email && new Date(u.metadata.creationTime).getTime() >= runStartedMs) created.authUsers.push(u.uid)   // every anonymous guest this run created
  for (const uid of created.authUsers) await auth.deleteUser(uid).catch((e) => { if (e.code !== 'auth/user-not-found') throw e })
  const strayEvents = (await db.collection('events').where('title', 'in', ['TEST LC', 'TEST LC v2']).get()).size
  const strayUsers = (await db.collection('users').listDocuments()).filter((r) => r.id.startsWith('lc-owner-')).length
  const authLeft = (await auth.listUsers(1000)).users.filter((u) => u.providerData.length === 0 || /@example\.invalid$/.test(u.email || '')).length
  console.log(JSON.stringify({ testEventsLeft: strayEvents, strayTestOwnerDocs: strayUsers, testOrAnonymousAuthUsersLeft: authLeft }))
  check('cleanup: 0 test events, 0 test owner docs, 0 test/anonymous Auth users', strayEvents === 0 && strayUsers === 0 && authLeft === 0)
}

;(async () => { try { await run() } catch (e) { results.push(false); console.error('FATAL', e && e.message ? e.message : e) } finally { await cleanup() } console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1) })()
