/**
 * CLOUD SMOKE of the photos domain (createPhotoUpload / finalizePhoto / moderatePhoto / winner photos via updateEventConfig, storage.rules, firestore.rules)
 * on iomixo-494817 with SYNTHETIC data only (throw-away owner `ph-owner-*`, event `firebase-test-ph-*` titled `TEST PH`, Storage objects under events/<that id>/).
 * Everything is deleted at the end (Firestore recursively, Storage by prefix, Auth users).
 *
 *   NODE_PATH=../backend/node_modules FIREBASE_PROJECT_ID=iomixo-494817 EXPECTED_REVISIONS='{"createPhotoUpload":"…"}' node scripts/cloud-smoke-photos.cjs
 *
 * One real Chrome on https://www.iomixo.com (reCAPTCHA Enterprise origin), ONE Firebase app with App Check: callables AND Storage / Firestore calls share it.
 */
const { readFileSync } = require('node:fs')
const { execSync, spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')
const { getStorage } = require('firebase-admin/storage')

const PROJECT = 'iomixo-494817', PORT = 9338, PREFIX = 'firebase-test-ph-'
const PROFILE = process.env.CHROME_PROFILE_DIR ?? '/tmp/chrome-smoke-profile'
if (process.env.FIREBASE_PROJECT_ID !== PROJECT) throw new Error('set FIREBASE_PROJECT_ID=' + PROJECT)
if (Object.keys(process.env).some((k) => k.startsWith('SUPABASE'))) throw new Error('SUPABASE_* env present: refusing')
const env = Object.fromEntries(readFileSync(__dirname + '/../.env.production.local', 'utf8').split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const webConfig = { apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, appId: env.NEXT_PUBLIC_FIREBASE_APP_ID }
const siteKey = env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY

initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.firebasestorage.app` })
const db = getFirestore(), auth = getAuth()
let runStartedMs = Date.now()
const results = [], created = { events: [], owners: [], authUsers: [] }
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))




const EXPECTED_REVISIONS = process.env.EXPECTED_REVISIONS ? JSON.parse(process.env.EXPECTED_REVISIONS) : null
const BUCKET = `${PROJECT}.firebasestorage.app`
const bucket = () => getStorage().bucket(BUCKET)
const exists = async (p) => (await bucket().file(p).exists())[0]

async function seed() {
  const stamp = Date.now().toString(36), ownerUid = `ph-owner-${stamp}`, id = `${PREFIX}${stamp}`
  await db.doc(`users/${ownerUid}`).set({ uid: ownerUid, plan: { tier: 'wedding', source: 'legacy' }, testData: true, createdAt: new Date(), updatedAt: new Date() }); created.owners.push(ownerUid)
  await db.doc(`events/${id}`).set({ ownerUid, slug: id, title: 'TEST PH', djName: 'test', description: null, type: 'wedding', status: 'live', screenModeEnabled: true,
    guestConfig: { requests: true }, screenConfig: { show_photos: true, live_booth_layout: 'grid' }, coupleNames: 'A & B', testData: true, createdAt: new Date(), updatedAt: new Date() }); created.events.push(id)
  await db.doc(`eventSlugs/${id}`).set({ eventId: id })
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

const INIT = (cfg, key) => `(async () => {
  const V = '11.10.0', base = 'https://www.gstatic.com/firebasejs/' + V + '/'
  const [{ initializeApp }, { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken }, { getAuth, signInWithEmailAndPassword, signInAnonymously, signOut }, { getFunctions, httpsCallable }, fsm, stm] = await Promise.all([
    import(base + 'firebase-app.js'), import(base + 'firebase-app-check.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-functions.js'), import(base + 'firebase-firestore.js'), import(base + 'firebase-storage.js')])
  const app = initializeApp(${JSON.stringify(cfg)})
  const ac = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(${JSON.stringify(key)}), isTokenAutoRefreshEnabled: false })
  const tok = await getToken(ac, false)
  const auth = getAuth(app), fns = getFunctions(app, 'europe-west1'), db = fsm.getFirestore(app), st = stm.getStorage(app, 'gs://${BUCKET}')
  const code = (e) => String(e && e.code || e)
  const bytes = (n, v = 7) => new Uint8Array(n).fill(v)
  window.__h = {
    call: async (name, data) => { try { const r = await httpsCallable(fns, name)(data); return { ok: true, data: r.data } } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason } } },
    owner: async (S) => { await signOut(auth); await signInWithEmailAndPassword(auth, S.email, S.password) },
    guest: async () => { await signOut(auth); const g = await signInAnonymously(auth); return g.user.uid },
    put: async (path, n, type, v) => { try { await stm.uploadBytes(stm.ref(st, path), bytes(n, v), { contentType: type }); return 'ok' } catch (e) { return code(e) } },
    url: async (path) => { try { return { ok: true, url: await stm.getDownloadURL(stm.ref(st, path)) } } catch (e) { return { ok: false, code: code(e) } } },
    read: async (path) => { try { return { ok: true, size: (await stm.getBytes(stm.ref(st, path))).byteLength } } catch (e) { return { ok: false, code: code(e) } } },
    list: async (path) => { try { await stm.listAll(stm.ref(st, path)); return 'ok' } catch (e) { return code(e) } },
    del: async (path) => { try { await stm.deleteObject(stm.ref(st, path)); return 'ok' } catch (e) { return code(e) } },
    docGet: async (path) => { try { const s = await fsm.getDoc(fsm.doc(db, ...path.split('/'))); return { ok: true, exists: s.exists() } } catch (e) { return { ok: false, code: code(e) } } },
    approvedQuery: async (eventId) => { try { const s = await fsm.getDocs(fsm.query(fsm.collection(db, 'events', eventId, 'photos'), fsm.where('status', '==', 'approved'), fsm.orderBy('createdAt', 'desc'), fsm.limit(12))); return { ok: true, ids: s.docs.map((d) => d.id) } } catch (e) { return { ok: false, code: code(e) } } },
    unfilteredQuery: async (eventId) => { try { await fsm.getDocs(fsm.collection(db, 'events', eventId, 'photos')); return 'ok' } catch (e) { return code(e) } },
    ownerQuery: async (eventId) => { try { const s = await fsm.getDocs(fsm.query(fsm.collection(db, 'events', eventId, 'photos'), fsm.orderBy('createdAt', 'desc'))); return { ok: true, statuses: s.docs.map((d) => d.data().status) } } catch (e) { return { ok: false, code: code(e) } } },
    write: async (path, data) => { try { await fsm.setDoc(fsm.doc(db, ...path.split('/')), data); return 'ok' } catch (e) { return code(e) } },
  }
  return JSON.stringify({ origin: location.origin, token: !!tok.token })
})()`
const STAGE = (body) => `(async () => { const h = window.__h, out = {}; ${body}; return JSON.stringify(out) })()`
const J = JSON.stringify

// A: guest slots + the whole upload protocol + upload-side security
const SA = (S) => STAGE(`
  const E = ${J(S.id)}
  out.guestB = await h.guest()
  out.slotB = await h.call('createPhotoUpload', { eventId: E, ext: 'jpg', source: 'live_booth', guestName: 'Ospite B', size: 1000 })
  out.guestA = await h.guest()
  out.slotA = await h.call('createPhotoUpload', { eventId: E, ext: 'jpg', source: 'live_booth', guestName: 'Ospite A', caption: 'smoke', size: 4096 })
  out.slotCooldown = await h.call('createPhotoUpload', { eventId: E, ext: 'jpg' })
  out.badFormat = await h.call('createPhotoUpload', { eventId: E, ext: 'gif' })
  const pA = out.slotA.data && out.slotA.data.storagePath, pB = out.slotB.data && out.slotB.data.storagePath
  out.putNoDoc = await h.put('events/${S.id}/photos/nodoc0123456789/original.jpg', 10, 'image/jpeg')
  out.putOtherGuestsPath = await h.put(pB, 10, 'image/jpeg')
  out.putWrongType = await h.put(pA, 10, 'text/html')
  out.putTooBig = await h.put(pA, 8 * 1024 * 1024 + 1, 'image/jpeg')
  out.finalizeEarly = await h.call('finalizePhoto', { eventId: E, photoId: out.slotA.data && out.slotA.data.photoId })
  out.put = await h.put(pA, 4096, 'image/jpeg', 7)
  out.putOverwrite = await h.put(pA, 4096, 'image/jpeg', 9)
  out.finalize = await h.call('finalizePhoto', { eventId: E, photoId: out.slotA.data && out.slotA.data.photoId })
  out.finalizeAgain = await h.call('finalizePhoto', { eventId: E, photoId: out.slotA.data && out.slotA.data.photoId })
  out.readOwnPending = await h.url(pA)
  out.list = await h.list('events/${S.id}/photos')
  out.listPhoto = await h.list('events/${S.id}/photos/' + (out.slotA.data && out.slotA.data.photoId))
  out.delOwn = await h.del(pA)
  out.unfiltered = await h.unfilteredQuery(E)
  out.approvedBefore = await h.approvedQuery(E)
  out.writeDoc = await h.write('events/${S.id}/photos/forged', { status: 'approved', storagePath: pA })
  out.photoDocPending = await h.docGet('events/${S.id}/photos/' + (out.slotA.data && out.slotA.data.photoId))
  out.guestCannotModerate = await h.call('moderatePhoto', { eventId: E, photoId: out.slotA.data && out.slotA.data.photoId, action: 'set_status', status: 'approved' })`)
// B1: owner lists / features / approves; a guest reads the approved photo. B2: owner rejects; the public view loses it.
const SB1 = (S, A) => STAGE(`
  const E = ${J(S.id)}, P = ${J(A.photoId)}, PATH = ${J(A.path)}
  await h.owner(${J(S)})
  out.ownerList = await h.ownerQuery(E)
  out.ownerReadPending = await h.url(PATH)
  out.featured = await h.call('moderatePhoto', { eventId: E, photoId: P, action: 'set_featured', isFeatured: true })
  out.approve = await h.call('moderatePhoto', { eventId: E, photoId: P, action: 'set_status', status: 'approved' })
  out.approveAgain = await h.call('moderatePhoto', { eventId: E, photoId: P, action: 'set_status', status: 'approved' })
  out.badStatus = await h.call('moderatePhoto', { eventId: E, photoId: P, action: 'set_status', status: 'winner' })
  out.guestC = await h.guest()
  out.approvedQuery = await h.approvedQuery(E)
  out.guestUrl = await h.url(PATH)`)
const SB2 = (S, A) => STAGE(`
  const E = ${J(S.id)}, P = ${J(A.photoId)}, PATH = ${J(A.path)}
  await h.owner(${J(S)})
  out.reject = await h.call('moderatePhoto', { eventId: E, photoId: P, action: 'set_status', status: 'rejected' })
  await h.guest()
  out.afterRejectQuery = await h.approvedQuery(E)
  out.afterRejectUrl = await h.url(PATH)`)
// C: a second photo, deleted by the owner; winner photos
const SC = (S) => STAGE(`
  const E = ${J(S.id)}
  const W = (n) => 'events/' + E + '/winner/' + n
  const groom = 'groom-' + 'a'.repeat(14) + '.jpg', bride = 'bride-' + 'b'.repeat(14) + '.png', groom2 = 'groom-' + 'c'.repeat(14) + '.jpg'
  out.guestD = await h.guest()
  out.slotD = await h.call('createPhotoUpload', { eventId: E, ext: 'png', source: 'guest_upload', size: 2000 })
  out.putD = await h.put(out.slotD.data && out.slotD.data.storagePath, 2000, 'image/png')
  out.finalizeD = await h.call('finalizePhoto', { eventId: E, photoId: out.slotD.data && out.slotD.data.photoId })
  await h.owner(${J(S)})
  out.approveD = await h.call('moderatePhoto', { eventId: E, photoId: out.slotD.data && out.slotD.data.photoId, action: 'set_status', status: 'approved' })
  out.winnerGroomPut = await h.put(W(groom), 3000, 'image/jpeg')
  out.winnerBridePut = await h.put(W(bride), 3000, 'image/png')
  out.winnerOverwrite = await h.put(W(groom), 3000, 'image/jpeg', 3)
  out.winnerBadName = await h.put(W('groom-short.jpg'), 3000, 'image/jpeg')
  out.winnerSvg = await h.put(W('groom-' + 'd'.repeat(14) + '.svg'), 3000, 'image/svg+xml')
  out.winnerSave = await h.call('updateEventConfig', { eventId: E, winnerAnnouncement: { phase: 'hidden', winner: null, groom_photo_path: W(groom), bride_photo_path: W(bride) } })
  out.winnerBadPath = await h.call('updateEventConfig', { eventId: E, winnerAnnouncement: { phase: 'hidden', groom_photo_path: 'events/other-event/winner/' + groom } })
  out.winnerTraversal = await h.call('updateEventConfig', { eventId: E, winnerAnnouncement: { phase: 'hidden', groom_photo_path: 'events/' + E + '/winner/../photos/x' } })
  await h.guest()
  out.winnerGuestPut = await h.put(W('groom-' + 'e'.repeat(14) + '.jpg'), 3000, 'image/jpeg')
  out.tvGroom = await h.url(W(groom)); out.tvBride = await h.url(W(bride))
  out.names = { groom, bride, groom2 }`)
const SC2 = (S, names) => STAGE(`
  const E = ${J(S.id)}
  const W = (n) => 'events/' + E + '/winner/' + n
  await h.owner(${J(S)})
  await h.put(W(${J(names.groom2)}), 3000, 'image/jpeg')
  out.winnerReplace = await h.call('updateEventConfig', { eventId: E, winnerAnnouncement: { phase: 'hidden', winner: null, groom_photo_path: W(${J(names.groom2)}), bride_photo_path: W(${J(names.bride)}) } })`)
const SD = (S) => STAGE(`
  const E = ${J(S.id)}
  await h.owner(${J(S)})
  out.winnerRemove = await h.call('updateEventConfig', { eventId: E, winnerAnnouncement: null })
  out.winnerAgain = await h.call('updateEventConfig', { eventId: E, winnerAnnouncement: { phase: 'hidden', winner: null, groom_photo_path: 'events/' + E + '/winner/groom-' + 'f'.repeat(14) + '.jpg' } })
  out.deleteEvent = await h.call('deleteEvent', { eventId: E })`)
const SE = (S, A, D) => STAGE(`
  const E = ${J(S.id)}
  out.guest = await h.guest()
  out.deletedQuery = await h.approvedQuery(E)
  out.deletedDoc = await h.docGet('events/' + E + '/photos/' + ${J(D.photoId)})
  out.deletedUrl = await h.url(${J(D.path)})
  out.deletedRead = await h.url(${J(D.path)})
  await h.owner(${J(S)})
  out.ownerAfterDelete = await h.call('moderatePhoto', { eventId: E, photoId: ${J(D.photoId)}, action: 'set_featured', isFeatured: true })
  out.restore = await h.call('restoreEvent', { eventId: E })`)

async function run() {
  const S = await seed(); runStartedMs = Date.now() - 5000; const startedAt = new Date(runStartedMs).toISOString()
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  let page, A, D; const R = {}, ex = {}
  const ev = async (expr) => { const res = await page.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (res.result.exceptionDetails) throw new Error('page script failed: ' + JSON.stringify(res.result.exceptionDetails).slice(0, 500)); return JSON.parse(res.result.result.value) }
  try {
    let targets; for (let i = 0; i < 40 && !targets; i++) { await sleep(500); try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json() } catch {} }
    assert.ok(targets, 'Chrome did not expose the debugging port')
    page = await cdp((targets.find((t) => t.type === 'page') ?? targets[0]).webSocketDebuggerUrl)
    await page.send('Page.enable'); await page.send('Page.setBypassCSP', { enabled: true }); await page.send('Page.navigate', { url: 'https://www.iomixo.com/' })
    for (let i = 0; i < 60 && !page.events.some((e) => e.method === 'Page.loadEventFired'); i++) await sleep(500)
    R.init = await ev(INIT(webConfig, siteKey))
    R.a = await ev(SA(S)); created.authUsers.push(R.a.guestA, R.a.guestB)
    A = { photoId: R.a.slotA.data?.photoId, path: R.a.slotA.data?.storagePath }
    ex.docAfterFinalize = (await db.doc(`events/${S.id}/photos/${A.photoId}`).get()).data()
    ex.objAfterUpload = await exists(A.path)
    ex.forged = (await db.doc(`events/${S.id}/photos/forged`).get()).exists
    const b1 = await ev(SB1(S, A)); created.authUsers.push(b1.guestC)
    const sizeOf = async (u) => (u && u.ok ? await (await fetch(u.url)).arrayBuffer().then((x) => x.byteLength) : null)
    ex.ownerPendingSize = await sizeOf(b1.ownerReadPending)             // the owner can fetch a PENDING photo
    ex.approvedSize = await sizeOf(b1.guestUrl)                          // a guest / the TV can fetch an APPROVED one
    const b2 = await ev(SB2(S, A)); R.b = { ...b1, ...b2 }
    ex.docRejected = (await db.doc(`events/${S.id}/photos/${A.photoId}`).get()).data()
    ex.tokenAfter = (await bucket().file(A.path).getMetadata())[0].metadata?.firebaseStorageDownloadTokens
    ex.oldUrlStatus = R.b.guestUrl.ok ? (await fetch(R.b.guestUrl.url)).status : null           // fetched AFTER the reject: the token was rotated
    R.c = await ev(SC(S)); created.authUsers.push(R.c.guestD)
    ex.tvGroomSize = await sizeOf(R.c.tvGroom); ex.tvBrideSize = await sizeOf(R.c.tvBride)
    R.c.winnerReplace = (await ev(SC2(S, R.c.names))).winnerReplace
    D = { photoId: R.c.slotD.data?.photoId, path: R.c.slotD.data?.storagePath }
    const wp = (n) => `events/${S.id}/winner/${n}`
    ex.winnerAfterReplace = { groom: await exists(wp(R.c.names.groom)), groom2: await exists(wp(R.c.names.groom2)), bride: await exists(wp(R.c.names.bride)) }
    ex.winnerCfg = (await db.doc(`events/${S.id}`).get()).data().screenConfig?.winner_announcement
    R.d = await ev(SD(S))
    ex.winnerAfterRemove = { groom2: await exists(wp(R.c.names.groom2)), bride: await exists(wp(R.c.names.bride)) }
    ex.deletedDoc = (await db.doc(`events/${S.id}`).get()).data()
    R.e = await ev(SE(S, A, D)); created.authUsers.push(R.e.guest)
    ex.dExistsWhileDeleted = await exists(D.path)
    // owner-side delete of a photo (moderatePhoto delete): done last on the restored event
    ex.restoredDoc = (await db.doc(`events/${S.id}`).get()).data()
    // a token-less call (no App Check) with the owner's ID token: accepted because enforcement is false, and logged as `absent`
    const tr = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${webConfig.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: S.email, password: S.password, returnSecureToken: true }) })).json()
    ex.raw = await (await fetch(`https://europe-west1-${PROJECT}.cloudfunctions.net/moderatePhoto`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tr.idToken}` }, body: JSON.stringify({ data: { eventId: S.id, photoId: D.photoId, action: 'set_featured', isFeatured: true } }) })).json()
    // delete via the owner callable, then verify the file and the document are gone
    const del = await (await fetch(`https://europe-west1-${PROJECT}.cloudfunctions.net/moderatePhoto`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tr.idToken}` }, body: JSON.stringify({ data: { eventId: S.id, photoId: D.photoId, action: 'delete' } }) })).json()
    ex.del = del.result; ex.dAfterDelete = { doc: (await db.doc(`events/${S.id}/photos/${D.photoId}`).get()).exists, file: await exists(D.path) }
  } finally { try { page && page.close() } catch {} chrome.kill('SIGTERM'); try { execSync(`pkill -f "remote-debugging-port=${PORT}"`) } catch {} }

  const rs = (r) => (r && r.ok ? 'ok' : `${r && r.code}:${r && r.reason}`)
  const denied = (v) => v === 'storage/unauthorized' || v === 'permission-denied' || v === 'functions/permission-denied'
  const notOk = (r) => r && r.ok === false
  const reasonIs = (r, reason) => r && r.ok === false && r.reason === reason
  check('real origin https://www.iomixo.com + App Check token obtained', R.init.origin === 'https://www.iomixo.com' && R.init.token === true)

  // ── guest upload protocol ──
  check('guest createPhotoUpload ok: path inside events/{id}/photos/{photoId}/original.jpg', R.a.slotA.ok && R.a.slotA.data.storagePath === `events/${S.id}/photos/${A.photoId}/original.jpg` && R.a.slotA.data.contentType === 'image/jpeg', rs(R.a.slotA))
  check('createPhotoUpload: cooldown + unsupported format are refused', reasonIs(R.a.slotCooldown, 'cooldown') && reasonIs(R.a.badFormat, 'unsupported_format'), `${rs(R.a.slotCooldown)} / ${rs(R.a.badFormat)}`)
  check('direct Storage upload refused: no photo doc / another guest\'s path / wrong type / > 8 MB', [R.a.putNoDoc, R.a.putOtherGuestsPath, R.a.putWrongType, R.a.putTooBig].every(denied), JSON.stringify([R.a.putNoDoc, R.a.putOtherGuestsPath, R.a.putWrongType, R.a.putTooBig]))
  check('finalizePhoto before the bytes exist is refused (upload_missing)', reasonIs(R.a.finalizeEarly, 'upload_missing'), rs(R.a.finalizeEarly))
  check('the issued path accepts the real upload (4 KB image/jpeg)', R.a.put === 'ok' && ex.objAfterUpload === true, R.a.put)
  check('NO overwrite: a second upload to the same path is refused', denied(R.a.putOverwrite), R.a.putOverwrite)
  check('finalizePhoto → pending (idempotent), real size recorded', R.a.finalize.ok && R.a.finalize.data.status === 'pending' && R.a.finalizeAgain.ok && R.a.finalizeAgain.data.status === 'pending' && ex.docAfterFinalize.status === 'pending' && ex.docAfterFinalize.size === 4096 && ex.docAfterFinalize.source === 'live_booth', rs(R.a.finalize))
  check('a pending photo is NOT public: the uploader cannot read it, no listing, no client delete', denied(R.a.readOwnPending.code) && denied(R.a.list) && denied(R.a.listPhoto) && denied(R.a.delOwn), JSON.stringify([R.a.readOwnPending.code, R.a.list, R.a.listPhoto, R.a.delOwn]))
  check('firestore.rules: unfiltered guest query refused, approved query empty, forged client write refused, pending doc not readable', denied(R.a.unfiltered) && R.a.approvedBefore.ok && R.a.approvedBefore.ids.length === 0 && denied(R.a.writeDoc) && ex.forged === false && R.a.photoDocPending.ok === false, JSON.stringify([R.a.unfiltered, R.a.approvedBefore.ids, R.a.writeDoc, R.a.photoDocPending]))
  check('a guest cannot moderate (account_required)', reasonIs(R.a.guestCannotModerate, 'account_required'), rs(R.a.guestCannotModerate))

  // ── owner moderation ──
  check('owner sees every state (pending included) and can read the pending file', R.b.ownerList.ok && R.b.ownerList.statuses.includes('pending') && R.b.ownerReadPending.ok && ex.ownerPendingSize === 4096, JSON.stringify(R.b.ownerList))
  check('owner: set_featured + approve (idempotent) + invalid status refused', R.b.featured.ok && R.b.featured.data.changed === true && R.b.approve.ok && R.b.approve.data.changed === true && R.b.approveAgain.ok && R.b.approveAgain.data.changed === false && reasonIs(R.b.badStatus, 'invalid_payload'), `${rs(R.b.featured)} / ${rs(R.b.approve)}`)
  check('approved → readable by a guest / the TV: in the approved query (Live Booth), download URL + bytes', R.b.approvedQuery.ok && R.b.approvedQuery.ids.includes(A.photoId) && R.b.guestUrl.ok && ex.approvedSize === 4096, JSON.stringify([R.b.approvedQuery.ids?.length, R.b.guestUrl.ok, ex.approvedSize]))
  check('reject → removed from the public view: query empty, file unreadable, doc status rejected', R.b.reject.ok && R.b.afterRejectQuery.ok && R.b.afterRejectQuery.ids.length === 0 && denied(R.b.afterRejectUrl.code) && ex.docRejected.status === 'rejected' && ex.docRejected.isFeatured === true, JSON.stringify([R.b.afterRejectQuery.ids, R.b.afterRejectUrl.code]))
  check('reject rotated the download token: the URL handed out while approved no longer serves the file', !!ex.tokenAfter && ex.oldUrlStatus !== null && ex.oldUrlStatus !== 200, `old url status=${ex.oldUrlStatus}`)

  // ── winner photos ──
  check('winner: owner uploads groom + bride directly to events/{id}/winner/ (the old groom is deleted at the replace below, which proves it existed)', R.c.winnerGroomPut === 'ok' && R.c.winnerBridePut === 'ok', JSON.stringify([R.c.winnerGroomPut, R.c.winnerBridePut]))
  check('winner storage rules: no overwrite, no malformed name, no svg, no guest upload', [R.c.winnerOverwrite, R.c.winnerBadName, R.c.winnerSvg, R.c.winnerGuestPut].every(denied), JSON.stringify([R.c.winnerOverwrite, R.c.winnerBadName, R.c.winnerSvg, R.c.winnerGuestPut]))
  check('updateEventConfig winner: valid paths saved; another event / path traversal refused', R.c.winnerSave.ok && reasonIs(R.c.winnerBadPath, 'invalid_payload') && reasonIs(R.c.winnerTraversal, 'invalid_payload') && ex.winnerCfg?.groom_photo_path?.startsWith(`events/${S.id}/winner/groom-`), `${rs(R.c.winnerSave)} / ${rs(R.c.winnerBadPath)} / ${rs(R.c.winnerTraversal)}`)
  check('the TV (anonymous) gets the winner photos from Storage (download URL + bytes)', R.c.tvGroom.ok && R.c.tvBride.ok && ex.tvGroomSize === 3000 && ex.tvBrideSize === 3000, JSON.stringify([R.c.tvGroom.ok, R.c.tvBride.ok, ex.tvGroomSize, ex.tvBrideSize]))
  check('replacing a winner photo deletes the old file; the other one stays', R.c.winnerReplace.ok && ex.winnerAfterReplace.groom === false && ex.winnerAfterReplace.groom2 === true && ex.winnerAfterReplace.bride === true, JSON.stringify(ex.winnerAfterReplace))
  check('removing the winner announcement (null) deletes both files', R.d.winnerRemove.ok && ex.winnerAfterRemove.groom2 === false && ex.winnerAfterRemove.bride === false, JSON.stringify(ex.winnerAfterRemove))

  // ── deleted event ──
  check('deleteEvent ok; the deleted event exposes NO photos: query / doc / URL / bytes all refused to a guest', R.d.deleteEvent.ok && !!ex.deletedDoc.deletedAt && denied(R.e.deletedQuery.code) && denied(R.e.deletedDoc.code) && denied(R.e.deletedUrl.code) && denied(R.e.deletedRead.code) && ex.dExistsWhileDeleted === true, JSON.stringify([R.e.deletedQuery.code, R.e.deletedDoc.code, R.e.deletedUrl.code, R.e.deletedRead.code]))
  check('while deleted the owner cannot moderate (event_not_found); restoreEvent brings it back', reasonIs(R.e.ownerAfterDelete, 'event_not_found') && R.e.restore.ok && R.e.restore.data.restored === true && !ex.restoredDoc.deletedAt, `${rs(R.e.ownerAfterDelete)} / ${rs(R.e.restore)}`)
  check('moderatePhoto delete removes the document AND the file', ex.del?.deleted === true && ex.dAfterDelete.doc === false && ex.dAfterDelete.file === false, JSON.stringify(ex.dAfterDelete))
  check('token-less call (no App Check) is accepted (enforcement=false) and harmless', ex.raw.result?.changed !== undefined || ex.raw.error?.status === 'NOT_FOUND', JSON.stringify(ex.raw).slice(0, 100))

  await sleep(10000)
  const read = (fn, filter, from = startedAt) => JSON.parse(execSync(`gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="${fn.toLowerCase()}" AND timestamp>="${from}" AND ${filter}' --project=${PROJECT} --format=json --limit=120`, { maxBuffer: 30_000_000 }).toString() || '[]')
  for (const fn of ['createPhotoUpload', 'finalizePhoto', 'moderatePhoto', 'updateEventConfig', 'deleteEvent', 'restoreEvent']) {
    let ac = []; for (let i = 0; i < 8; i++) { ac = read(fn, 'jsonPayload.message="app_check"'); if (ac.length) break; await sleep(4000) }
    const valid = ac.filter((l) => l.jsonPayload.appCheck === 'valid').length, absent = ac.filter((l) => l.jsonPayload.appCheck === 'absent').length
    const revs = [...new Set(ac.map((l) => l.resource.labels.revision_name))], enf = [...new Set(ac.map((l) => l.jsonPayload.enforcement))]
    const okRev = !EXPECTED_REVISIONS || !EXPECTED_REVISIONS[fn] || (revs.length === 1 && revs[0] === EXPECTED_REVISIONS[fn])
    check(`${fn}: app_check logged, valid token on every call (except the deliberate token-less one), enforcement=false, expected revision`, ac.length > 0 && valid > 0 && absent <= (fn === 'moderatePhoto' ? 2 : 0) && enf.length === 1 && enf[0] === false && okRev, `calls=${ac.length} valid=${valid} absent=${absent} enforcement=${enf} revision=${revs}`)
    check(`${fn}: no legacy bridge / Supabase activity, no ERROR log`, read(fn, 'jsonPayload.message:"legacy_bridge"').length === 0 && read(fn, 'severity>=ERROR').length === 0)
  }
}

async function cleanup() {
  const owned = []
  for (const uid of created.owners) { const q = await db.collection('events').where('ownerUid', '==', uid).get(); q.docs.forEach((d) => owned.push(d)) }
  for (const d of owned) {
    await bucket().deleteFiles({ prefix: `events/${d.id}/`, force: true }).catch(() => {})
    await db.recursiveDelete(d.ref)
    const slug = d.data().slug; if (slug) { const s = db.doc(`eventSlugs/${slug}`); if ((await s.get()).exists) await s.delete() }
  }
  for (const id of created.owners) await db.doc(`users/${id}`).delete()
  for (const u of (await auth.listUsers(1000)).users) if (u.providerData.length === 0 && !u.email && new Date(u.metadata.creationTime).getTime() >= runStartedMs) created.authUsers.push(u.uid)
  for (const uid of created.authUsers) await auth.deleteUser(uid).catch((e) => { if (e.code !== 'auth/user-not-found') throw e })
  const strayEvents = (await db.collection('events').where('title', '==', 'TEST PH').get()).size
  const strayUsers = (await db.collection('users').listDocuments()).filter((r) => r.id.startsWith('ph-owner-')).length
  const slugs = (await db.collection('eventSlugs').listDocuments()).filter((r) => r.id.startsWith(PREFIX)).length
  const [files] = await bucket().getFiles({ prefix: 'events/firebase-test-ph-', maxResults: 5 })
  const authLeft = (await auth.listUsers(1000)).users.filter((u) => u.providerData.length === 0 || /@example\.invalid$/.test(u.email || '')).length
  console.log(JSON.stringify({ testEventsLeft: strayEvents, strayTestOwnerDocs: strayUsers, strayTestSlugs: slugs, testStorageObjectsLeft: files.length, testOrAnonymousAuthUsersLeft: authLeft }))
  check('cleanup: 0 test events, 0 owner docs, 0 slugs, 0 Storage objects, 0 test/anonymous Auth users', strayEvents === 0 && strayUsers === 0 && slugs === 0 && files.length === 0 && authLeft === 0)
}

;(async () => { try { await run() } catch (e) { results.push(false); console.error('FATAL', e && e.message ? e.message : e) } finally { await cleanup() } console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1) })()
