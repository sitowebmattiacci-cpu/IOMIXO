/**
 * CLOUD SMOKE of the profile + avatar domain (commitAvatar / removeAvatar, storage.rules profiles/{uid}/avatar, users + djProfiles rules) on iomixo-494817.
 * Destructive flows use SYNTHETIC accounts only (`prowner*` A and B, Auth users + users/djProfiles docs + Storage under profiles/<their uid>/); the REAL owner is only
 * READ (Firestore + avatar URLs + object list) and compared byte-for-byte before / after: the run must leave it untouched. Everything synthetic is deleted at the end.
 *
 *   NODE_PATH=../backend/node_modules FIREBASE_PROJECT_ID=iomixo-494817 EXPECTED_REVISIONS='{"commitAvatar":"…","removeAvatar":"…"}' node scripts/cloud-smoke-profile.cjs
 *
 * One real Chrome on https://www.iomixo.com (reCAPTCHA Enterprise origin), ONE Firebase app with App Check: callables, Storage and Firestore share it.
 */
const { readFileSync } = require('node:fs')
const { execSync, spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')
const { getStorage } = require('firebase-admin/storage')

const PROJECT = 'iomixo-494817', PORT = 9339, REAL_UID = 'z5EDSZrgFDXMjCrRCB4cMEidoaL2'
const PROFILE = process.env.CHROME_PROFILE_DIR ?? '/tmp/chrome-smoke-profile'
if (process.env.FIREBASE_PROJECT_ID !== PROJECT) throw new Error('set FIREBASE_PROJECT_ID=' + PROJECT)
if (Object.keys(process.env).some((k) => k.startsWith('SUPABASE'))) throw new Error('SUPABASE_* env present: refusing')
const env = Object.fromEntries(readFileSync(__dirname + '/../.env.production.local', 'utf8').split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const webConfig = { apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, appId: env.NEXT_PUBLIC_FIREBASE_APP_ID }
const siteKey = env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY

initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.firebasestorage.app` })
const db = getFirestore(), auth = getAuth()
let runStartedMs = Date.now()
const results = [], created = { owners: [], authUsers: [] }
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const EXPECTED_REVISIONS = process.env.EXPECTED_REVISIONS ? JSON.parse(process.env.EXPECTED_REVISIONS) : null
const BUCKET = `${PROJECT}.firebasestorage.app`
const bucket = () => getStorage().bucket(BUCKET)
const objects = async (uid) => (await bucket().getFiles({ prefix: `profiles/${uid}/` }))[0].map((f) => f.name).sort()

// ── the real owner: a stable fingerprint (never written) ──
const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x.toMillis === 'function' ? x.toMillis() : x)))
async function realFingerprint() {
  const u = (await db.doc(`users/${REAL_UID}`).get()).data(), d = (await db.doc(`djProfiles/${REAL_UID}`).get()).data()
  const fetchInfo = async (url) => { const r = await fetch(url); return { status: r.status, bytes: (await r.arrayBuffer()).byteLength } }
  return plain({ users: u, djProfiles: d, objects: await objects(REAL_UID), userAvatar: await fetchInfo(u.avatarUrl), djAvatar: await fetchInfo(d.avatarUrl) })
}

async function seed() {
  const stamp = Date.now().toString(36)
  const mk = async (tag) => {
    const uid = `prowner${tag}${stamp}`, email = `${uid}@example.invalid`, password = `Pw-${stamp}-${Math.random().toString(36).slice(2)}!`
    await db.doc(`users/${uid}`).set({ uid, email, displayName: 'Smoke ' + tag, plan: { tier: 'free', source: 'default' }, testData: true, createdAt: new Date(), updatedAt: new Date() }); created.owners.push(uid)
    await auth.createUser({ uid, email, password, emailVerified: true }); created.authUsers.push(uid)
    return { uid, email, password }
  }
  const A = await mk('a'), B = await mk('b')
  // A has a DJ profile with a slug (server-only field) so we can prove it never changes
  await db.doc(`djProfiles/${A.uid}`).set({ displayName: 'DJ Smoke', bio: 'bio-original', publicSlug: `smoke-${stamp}`, testData: true, createdAt: new Date(), updatedAt: new Date() })
  return { A, B, slug: `smoke-${stamp}` }
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
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], JPG = [0xff, 0xd8, 0xff, 0xe0], WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
  const bytes = (n, kind, v = 7) => { const b = new Uint8Array(n).fill(v); const h = kind === 'png' ? PNG : kind === 'jpg' ? JPG : kind === 'webp' ? WEBP : []; b.set(h.slice(0, n)); return b }
  const rev = (d) => { const o = {}; for (const k in d) o[k] = d[k] === '__TS__' ? fsm.serverTimestamp() : d[k]; return o }
  window.__h = {
    call: async (name, data) => { try { const r = await httpsCallable(fns, name)(data); return { ok: true, data: r.data } } catch (e) { return { ok: false, code: e.code, reason: e.details && e.details.reason } } },
    owner: async (S) => { await signOut(auth); await signInWithEmailAndPassword(auth, S.email, S.password) },
    guest: async () => { await signOut(auth); const g = await signInAnonymously(auth); return g.user.uid },
    put: async (path, n, type, kind, v) => { try { await stm.uploadBytes(stm.ref(st, path), bytes(n, kind, v), { contentType: type }); return 'ok' } catch (e) { return code(e) } },
    read: async (path) => { try { return { ok: true, url: await stm.getDownloadURL(stm.ref(st, path)) } } catch (e) { return { ok: false, code: code(e) } } },
    url: async (path) => { try { return { ok: true, url: await stm.getDownloadURL(stm.ref(st, path)) } } catch (e) { return { ok: false, code: code(e) } } },
    list: async (path) => { try { await stm.listAll(stm.ref(st, path)); return 'ok' } catch (e) { return code(e) } },
    del: async (path) => { try { await stm.deleteObject(stm.ref(st, path)); return 'ok' } catch (e) { return code(e) } },
    get: async (path) => { try { const s = await fsm.getDoc(fsm.doc(db, ...path.split('/'))); return { ok: true, exists: s.exists(), data: s.exists() ? JSON.parse(JSON.stringify(s.data(), (k, x) => (x && x.seconds !== undefined ? 'ts' : x))) : null } } catch (e) { return { ok: false, code: code(e) } } },
    update: async (path, data) => { try { await fsm.updateDoc(fsm.doc(db, ...path.split('/')), rev(data)); return 'ok' } catch (e) { return code(e) } },
    set: async (path, data) => { try { await fsm.setDoc(fsm.doc(db, ...path.split('/')), rev(data)); return 'ok' } catch (e) { return code(e) } },
  }
  window.__log = []
  for (const k of Object.keys(window.__h)) { const f = window.__h[k]; window.__h[k] = async (...a) => { window.__log.push(k + ' ' + String(a[0]).slice(0, 90) + ' …'); const r = await f(...a); window.__log[window.__log.length - 1] += ' done'; return r } }
  return JSON.stringify({ origin: location.origin, token: !!tok.token })
})()`
const STAGE = (body) => `(async () => { const h = window.__h, out = {}; ${body}; return JSON.stringify(out) })()`
const J = JSON.stringify
const tk = (c) => c.repeat(20)       // 20-char random-looking token (rules need 16..64 of [A-Za-z0-9_-])

// A: the owner's whole profile + avatar lifecycle (account and DJ), then upload-side security
const SA_HEAD = (S) => `
  const U = ${J(S.A.uid)}, B = ${J(S.B.uid)}
  const P = (kind, t, ext) => 'profiles/' + U + '/avatar/' + kind + '-' + t + '.' + ext
  await h.owner(${J(S.A)})
`
const SA_PARTS = (S) => [
`  // — account profile —
  out.userRead = await h.get('users/' + U)
  out.nameEdit = await h.update('users/' + U, { displayName: 'Smoke A edited', updatedAt: '__TS__' })
  out.nameAfter = await h.get('users/' + U)
  out.nameRestore = await h.update('users/' + U, { displayName: 'Smoke a', updatedAt: '__TS__' })
  out.directAvatarUrl = await h.update('users/' + U, { avatarUrl: 'https://evil.example/x.png', updatedAt: '__TS__' })
  out.directAvatarPath = await h.update('users/' + U, { avatarPath: P('user', ${J(tk('x'))}, 'png'), updatedAt: '__TS__' })
  out.directPlan = await h.update('users/' + U, { plan: { tier: 'wedding', source: 'default' }, updatedAt: '__TS__' })`,
`  // — account avatar: upload → commit → replace → remove —
  out.u1put = await h.put(P('user', ${J(tk('a'))}, 'png'), 3000, 'image/png', 'png')
  out.u1commit = await h.call('commitAvatar', { kind: 'user', path: P('user', ${J(tk('a'))}, 'png') })
  out.u1doc = await h.get('users/' + U)
`,
`  // — account avatar: replace + remove —
  out.u2put = await h.put(P('user', ${J(tk('b'))}, 'jpg'), 2000, 'image/jpeg', 'jpg')
  out.u2commit = await h.call('commitAvatar', { kind: 'user', path: P('user', ${J(tk('b'))}, 'jpg') })
  out.userRemove = await h.call('removeAvatar', { kind: 'user' })
  out.userRemoveAgain = await h.call('removeAvatar', { kind: 'user' })
  out.uAfterRemove = await h.get('users/' + U)`,
`  // — DJ profile: read, harmless edit, restore, slug untouched —
  out.djRead = await h.get('djProfiles/' + U)
  out.djEdit = await h.update('djProfiles/' + U, { bio: 'bio-edited', updatedAt: '__TS__' })
  out.djAfter = await h.get('djProfiles/' + U)
  out.djRestore = await h.update('djProfiles/' + U, { bio: 'bio-original', updatedAt: '__TS__' })
  out.djSlug = await h.update('djProfiles/' + U, { publicSlug: 'hijacked', updatedAt: '__TS__' })
  out.djDirectAvatar = await h.update('djProfiles/' + U, { avatarUrl: 'https://evil.example/x.png', updatedAt: '__TS__' })
  out.d1put = await h.put(P('dj', ${J(tk('c'))}, 'webp'), 2500, 'image/webp', 'webp')
  out.d1commit = await h.call('commitAvatar', { kind: 'dj', path: P('dj', ${J(tk('c'))}, 'webp') })
  out.d1doc = await h.get('djProfiles/' + U)`,
`  // — upload-side security —
  out.sOverwrite = await h.put(P('dj', ${J(tk('c'))}, 'webp'), 2500, 'image/webp', 'webp', 9)
  out.sOutside = await h.put('profiles/' + U + '/other/x-' + ${J(tk('d'))} + '.png', 100, 'image/png', 'png')
  out.sNested = await h.put('profiles/' + U + '/avatar/sub/user-' + ${J(tk('d'))} + '.png', 100, 'image/png', 'png')
  out.sRoot = await h.put('avatar-' + ${J(tk('d'))} + '.png', 100, 'image/png', 'png')
  out.sBadName = await h.put('profiles/' + U + '/avatar/user-short.png', 100, 'image/png', 'png')
  out.sBadKind = await h.put('profiles/' + U + '/avatar/admin-' + ${J(tk('d'))} + '.png', 100, 'image/png', 'png')
  out.sSvg = await h.put(P('user', ${J(tk('e'))}, 'svg'), 100, 'image/svg+xml', 'png')
  out.sHtmlType = await h.put(P('user', ${J(tk('f'))}, 'png'), 100, 'text/html', 'png')
  out.sTooBig = await h.put(P('user', ${J(tk('g'))}, 'png'), 5 * 1024 * 1024 + 1, 'image/png', 'png')
  out.sOtherUid = await h.put('profiles/' + B + '/avatar/user-' + ${J(tk('h'))} + '.png', 100, 'image/png', 'png')
  out.sList = await h.list('profiles/' + U + '/avatar')
  out.sDelete = await h.del(P('dj', ${J(tk('c'))}, 'webp'))`,
`  // not an image behind an image content-type: the upload passes the rule (declared type), commitAvatar must reject it and delete it
  out.fakePut = await h.put(P('user', ${J(tk('i'))}, 'png'), 400, 'image/png', 'none', 65)
  out.fakeCommit = await h.call('commitAvatar', { kind: 'user', path: P('user', ${J(tk('i'))}, 'png') })
  out.missingCommit = await h.call('commitAvatar', { kind: 'user', path: P('user', ${J(tk('j'))}, 'png') })
  out.crossKind = await h.call('commitAvatar', { kind: 'user', path: P('dj', ${J(tk('c'))}, 'webp') })
  out.badPayload = await h.call('commitAvatar', { kind: 'user', path: '../../etc/passwd' })
  out.otherUidCommit = await h.call('commitAvatar', { kind: 'user', path: 'profiles/' + B + '/avatar/user-' + ${J(tk('h'))} + '.png' })
  out.readOwn = await h.url(P('dj', ${J(tk('c'))}, 'webp'))`
].map((b) => STAGE(SA_HEAD(S) + b))
// B: another account tries to touch A
const SB = (S) => STAGE(`
  const A = ${J(S.A.uid)}
  await h.owner(${J(S.B)})
  out.readUserA = await h.get('users/' + A)
  out.readDjA = await h.get('djProfiles/' + A)
  out.updUserA = await h.update('users/' + A, { displayName: 'hijack', updatedAt: '__TS__' })
  out.updDjA = await h.update('djProfiles/' + A, { bio: 'hijack', updatedAt: '__TS__' })
  out.createDjA = await h.set('djProfiles/' + A, { displayName: 'hijack', createdAt: '__TS__', updatedAt: '__TS__' })
  out.putIntoA = await h.put('profiles/' + A + '/avatar/dj-' + ${J(tk('k'))} + '.png', 100, 'image/png', 'png')
  out.readAvatarA = await h.read(${J(S.djPath || '')})
  out.commitA = await h.call('commitAvatar', { kind: 'dj', path: ${J(S.djPath || 'profiles/x/avatar/dj-' + tk('c') + '.png')} })
  out.removeOwnOnly = await h.call('removeAvatar', { kind: 'dj' })`)
// G: a guest (anonymous)
const SG = (S) => STAGE(`
  const A = ${J(S.A.uid)}
  out.guest = await h.guest()
  out.readDj = await h.get('djProfiles/' + A)
  out.readUser = await h.get('users/' + A)
  out.put = await h.put('profiles/' + out.guest + '/avatar/user-' + ${J(tk('m'))} + '.png', 100, 'image/png', 'png')
  out.commit = await h.call('commitAvatar', { kind: 'dj', path: 'profiles/' + out.guest + '/avatar/dj-' + ${J(tk('m'))} + '.png' })
  out.remove = await h.call('removeAvatar', { kind: 'dj' })
  out.writeDj = await h.set('djProfiles/' + out.guest, { displayName: 'x', createdAt: '__TS__', updatedAt: '__TS__' })`)

async function run() {
  console.log('start')
  const before = await realFingerprint()
  const S = await seed(); runStartedMs = Date.now() - 5000; const startedAt = new Date(runStartedMs).toISOString()
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  let page; const R = {}, ex = {}
  const ev = async (expr) => { const res = await Promise.race([page.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(150000).then(async () => { const l = await Promise.race([page.send('Runtime.evaluate', { expression: 'JSON.stringify((window.__log||[]).slice(-4))', returnByValue: true }), sleep(5000)]); throw new Error('page script timed out (150s); last calls: ' + (l && l.result && l.result.result ? l.result.result.value : '?')) })]); if (res.result.exceptionDetails) throw new Error('page script failed: ' + JSON.stringify(res.result.exceptionDetails).slice(0, 500)); return JSON.parse(res.result.result.value) }
  const T = {}
  try {
    let targets; for (let i = 0; i < 40 && !targets; i++) { await sleep(500); try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json() } catch {} }
    assert.ok(targets, 'Chrome did not expose the debugging port')
    page = await cdp((targets.find((t) => t.type === 'page') ?? targets[0]).webSocketDebuggerUrl)
    await page.send('Page.enable'); await page.send('Page.setBypassCSP', { enabled: true }); await page.send('Page.navigate', { url: 'https://www.iomixo.com/' })
    for (let i = 0; i < 60 && !page.events.some((e) => e.method === 'Page.loadEventFired'); i++) await sleep(500)
    R.init = await ev(INIT(webConfig, siteKey)); console.log('step ok:', 'R.init')
    R.a = {}
    for (const [i, st] of SA_PARTS(S).entries()) {
      Object.assign(R.a, await ev(st))
      if (R.a.u1commit && ex.u1Fetch === undefined) { ex.u1Url = R.a.u1commit.data?.avatarUrl; ex.u1Fetch = ex.u1Url ? (await fetch(ex.u1Url)).status : null }   // served right after the commit, before the replacement
      console.log('A part', i, 'ok')
    }
    const A = S.A.uid
    ex.afterD1 = await objects(A)
    ex.djDoc = (await db.doc(`djProfiles/${A}`).get()).data()
    ex.userDocAfter = (await db.doc(`users/${A}`).get()).data()
    ex.d1Fetch = R.a.d1commit.data?.avatarUrl ? (await fetch(R.a.d1commit.data.avatarUrl)).status : null
    S.djPath = R.a.d1commit.data?.avatarPath
    R.b = await ev(SB(S)); console.log('step ok:', 'R.b = ')
    R.g = await ev(SG(S)); console.log('step ok:', 'R.g = '); created.authUsers.push(R.g.guest)
    ex.finalObjectsA = await objects(A)
    ex.finalObjectsB = await objects(S.B.uid)
    ex.userDocFinal = (await db.doc(`users/${A}`).get()).data()
    ex.djDocFinal = (await db.doc(`djProfiles/${A}`).get()).data()
    ex.guestDoc = (await db.doc(`djProfiles/${R.g.guest}`).get()).exists
    // token-less call with A's ID token: accepted while enforcement is false, and logged as `absent`
    const tr = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${webConfig.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: S.A.email, password: S.A.password, returnSecureToken: true }) })).json()
    ex.raw = await (await fetch(`https://europe-west1-${PROJECT}.cloudfunctions.net/removeAvatar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tr.idToken}` }, body: JSON.stringify({ data: { kind: 'dj' } }) })).json()
    ex.djAfterRaw = (await db.doc(`djProfiles/${A}`).get()).data()
    ex.rawNoAuth = (await fetch(`https://europe-west1-${PROJECT}.cloudfunctions.net/commitAvatar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { kind: 'dj', path: `profiles/${A}/avatar/dj-cccccccccccccccccccc.webp` } }) })).status
  } finally { try { page && page.close() } catch {} chrome.kill('SIGTERM'); try { execSync(`pkill -f "remote-debugging-port=${PORT}"`) } catch {} }
  const after = await realFingerprint()

  const rs = (r) => (r && r.ok ? 'ok' : `${r && r.code}:${r && r.reason}`)
  const denied = (v) => v === 'storage/unauthorized' || v === 'permission-denied' || v === 'functions/permission-denied'
  const reasonIs = (r, reason) => r && r.ok === false && r.reason === reason
  const A = S.A.uid
  check('real origin https://www.iomixo.com + App Check token obtained', R.init.origin === 'https://www.iomixo.com' && R.init.token === true)

  // ── account profile ──
  check('account profile: owner reads own displayName, edits it, and the original is restored', R.a.userRead.ok && R.a.userRead.data.displayName === 'Smoke a' && R.a.nameEdit === 'ok' && R.a.nameAfter.data.displayName === 'Smoke A edited' && R.a.nameRestore === 'ok' && ex.userDocFinal.displayName === 'Smoke a', JSON.stringify([R.a.nameEdit, R.a.nameAfter.data?.displayName, ex.userDocFinal.displayName]))
  check('client cannot write avatarUrl / avatarPath / plan on users/{uid}', denied(R.a.directAvatarUrl) && denied(R.a.directAvatarPath) && denied(R.a.directPlan), JSON.stringify([R.a.directAvatarUrl, R.a.directAvatarPath, R.a.directPlan]))

  // ── account avatar ──
  const m1 = new RegExp(`^profiles/${A}/avatar/user-a{20}\\.png$`)
  check('account avatar: upload → commitAvatar writes path + tokenised URL, file served (HTTP 200)', R.a.u1put === 'ok' && R.a.u1commit.ok && m1.test(R.a.u1commit.data.avatarPath) && R.a.u1doc.data.avatarPath === R.a.u1commit.data.avatarPath && /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/.+\?alt=media&token=[0-9a-f-]{36}$/.test(ex.u1Url) && ex.u1Fetch === 200, `${rs(R.a.u1commit)} fetch=${ex.u1Fetch}`)
  check('account avatar: replacement commits the new file and deletes the old one', R.a.u2put === 'ok' && R.a.u2commit.ok && R.a.u2commit.data.avatarPath.endsWith('.jpg'), rs(R.a.u2commit))
  check('removeAvatar clears path + URL, idempotent, name untouched', R.a.userRemove.ok && R.a.userRemove.data.removed === 1 && R.a.userRemoveAgain.ok && R.a.userRemoveAgain.data.removed === 0 && R.a.uAfterRemove.data.avatarPath === undefined && R.a.uAfterRemove.data.avatarUrl === undefined && R.a.uAfterRemove.data.displayName === 'Smoke a', JSON.stringify([R.a.userRemove.data, R.a.userRemoveAgain.data]))

  // ── DJ profile ──
  check('DJ profile: owner reads djProfiles/{uid}, edits a harmless field and restores it', R.a.djRead.ok && R.a.djRead.data.bio === 'bio-original' && R.a.djEdit === 'ok' && R.a.djAfter.data.bio === 'bio-edited' && R.a.djRestore === 'ok' && ex.djDocFinal.bio === 'bio-original', JSON.stringify([R.a.djEdit, R.a.djAfter.data?.bio, ex.djDocFinal.bio]))
  check('publicSlug is not client-writable and never changed', denied(R.a.djSlug) && ex.djDocFinal.publicSlug === S.slug && ex.djDoc.publicSlug === S.slug, rs({ ok: false, code: R.a.djSlug }))
  check('client cannot write avatarUrl on djProfiles/{uid}', denied(R.a.djDirectAvatar), R.a.djDirectAvatar)
  check('DJ avatar: upload → commitAvatar → file served; djProfiles has path + URL, other fields kept', R.a.d1put === 'ok' && R.a.d1commit.ok && R.a.d1doc.data.avatarPath === R.a.d1commit.data.avatarPath && ex.d1Fetch === 200 && R.a.d1doc.data.displayName === 'DJ Smoke' && R.a.d1doc.data.publicSlug === S.slug, `${rs(R.a.d1commit)} fetch=${ex.d1Fetch}`)
  check('account and DJ avatars are independent: only the DJ file is left after the account avatar was removed', JSON.stringify(ex.afterD1) === JSON.stringify([R.a.d1commit.data.avatarPath]), JSON.stringify(ex.afterD1))

  // ── security: uploads ──
  check('upload outside the allowed path is refused (other folder, nested, bucket root, short name, unknown kind)', [R.a.sOutside, R.a.sNested, R.a.sRoot, R.a.sBadName, R.a.sBadKind].every(denied), JSON.stringify([R.a.sOutside, R.a.sNested, R.a.sRoot, R.a.sBadName, R.a.sBadKind]))
  check('overwrite of an existing avatar object is refused', denied(R.a.sOverwrite), R.a.sOverwrite)
  check('non-image refused: svg extension and text/html content-type', denied(R.a.sSvg) && denied(R.a.sHtmlType), JSON.stringify([R.a.sSvg, R.a.sHtmlType]))
  check('file > 5 MB refused', denied(R.a.sTooBig), R.a.sTooBig)
  check('cannot upload into another uid\'s folder; no listing; no client delete', denied(R.a.sOtherUid) && denied(R.a.sList) && denied(R.a.sDelete), JSON.stringify([R.a.sOtherUid, R.a.sList, R.a.sDelete]))
  check('server re-checks the bytes: a non-image declared as image/png is rejected (invalid_image) and its object deleted', R.a.fakePut === 'ok' && reasonIs(R.a.fakeCommit, 'invalid_image') && !ex.afterD1.some((n) => n.includes(tk('i'))), `${R.a.fakePut} / ${rs(R.a.fakeCommit)}`)
  check('commitAvatar: missing upload, dj file as account avatar, malformed path, another uid\'s path are all refused', reasonIs(R.a.missingCommit, 'upload_missing') && reasonIs(R.a.crossKind, 'not_your_avatar') && reasonIs(R.a.badPayload, 'invalid_payload') && reasonIs(R.a.otherUidCommit, 'not_your_avatar'), JSON.stringify([rs(R.a.missingCommit), rs(R.a.crossKind), rs(R.a.badPayload), rs(R.a.otherUidCommit)]))
  check('the owner can read the own avatar object (Storage get rule; download URL)', R.a.readOwn.ok === true, JSON.stringify(R.a.readOwn))

  // ── security: other uid / guest ──
  check('another account cannot read or modify users/{A} or djProfiles/{A}, nor create one for A', [R.b.readUserA, R.b.readDjA].every((r) => r.ok === false && denied(r.code)) && denied(R.b.updUserA) && denied(R.b.updDjA) && denied(R.b.createDjA), JSON.stringify([R.b.readUserA.code, R.b.readDjA.code, R.b.updUserA, R.b.updDjA, R.b.createDjA]))
  check('another account cannot upload into A\'s folder, read A\'s avatar bytes, or commit A\'s file', denied(R.b.putIntoA) && R.b.readAvatarA.ok === false && denied(R.b.readAvatarA.code) && reasonIs(R.b.commitA, 'not_your_avatar'), JSON.stringify([R.b.putIntoA, R.b.readAvatarA, rs(R.b.commitA)]))
  check('removeAvatar only acts on the caller\'s own avatar (B has none: removed 0, A\'s DJ avatar still there)', R.b.removeOwnOnly.ok && R.b.removeOwnOnly.data.removed === 0 && ex.finalObjectsA.length === 1, JSON.stringify([R.b.removeOwnOnly.data, ex.finalObjectsA.length]))
  check('guest (anonymous): cannot read profiles, upload an avatar, commit/remove, or create a profile', R.g.readDj.ok === false && denied(R.g.readDj.code) && R.g.readUser.ok === false && denied(R.g.readUser.code) && denied(R.g.put) && R.g.commit.ok === false && R.g.commit.reason === 'account_required' && R.g.remove.ok === false && R.g.remove.reason === 'account_required' && denied(R.g.writeDj) && ex.guestDoc === false, JSON.stringify([R.g.put, rs(R.g.commit), rs(R.g.remove), R.g.writeDj]))
  check('token-less call (no App Check) is accepted (enforcement=false) and acts only on the caller; unauthenticated call refused', ex.raw.result?.removed === 1 && ex.djAfterRaw.avatarPath === undefined && ex.rawNoAuth === 401, JSON.stringify(ex.raw).slice(0, 80) + ' noauth=' + ex.rawNoAuth)

  // ── the REAL owner is untouched ──
  check('REAL owner untouched: users + djProfiles documents, both avatar objects and both avatar URLs identical before / after', JSON.stringify(before) === JSON.stringify(after) && before.userAvatar.status === 200 && before.djAvatar.status === 200 && before.objects.length === 2 && before.djProfiles.publicSlug === 'xf9wndtf2h', `userAvatar=${before.userAvatar.bytes}B djAvatar=${before.djAvatar.bytes}B slug=${before.djProfiles.publicSlug}`)

  await sleep(10000)
  const read = (fn, filter) => JSON.parse(execSync(`gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="${fn.toLowerCase()}" AND timestamp>="${startedAt}" AND ${filter}' --project=${PROJECT} --format=json --limit=150`, { maxBuffer: 30_000_000 }).toString() || '[]')
  for (const fn of ['commitAvatar', 'removeAvatar']) {
    let ac = []; for (let i = 0; i < 8; i++) { ac = read(fn, 'jsonPayload.message="app_check"'); if (ac.length) break; await sleep(4000) }
    const valid = ac.filter((l) => l.jsonPayload.appCheck === 'valid').length, absent = ac.filter((l) => l.jsonPayload.appCheck === 'absent').length
    const revs = [...new Set(ac.map((l) => l.resource.labels.revision_name))], enf = [...new Set(ac.map((l) => l.jsonPayload.enforcement))]
    const okRev = !EXPECTED_REVISIONS || !EXPECTED_REVISIONS[fn] || (revs.length === 1 && revs[0] === EXPECTED_REVISIONS[fn])
    check(`${fn}: app_check logged, valid token on every browser call (only the deliberate token-less one is absent), enforcement=false, expected revision`, ac.length > 0 && valid > 0 && absent <= 1 && enf.length === 1 && enf[0] === false && okRev, `calls=${ac.length} valid=${valid} absent=${absent} enforcement=${enf} revision=${revs}`)
    check(`${fn}: no ERROR-severity log, no legacy bridge activity`, read(fn, 'severity>=ERROR').length === 0 && read(fn, 'jsonPayload.message:"legacy_bridge"').length === 0)
  }
}

async function cleanup() {
  for (const uid of created.owners) {
    await bucket().deleteFiles({ prefix: `profiles/${uid}/`, force: true }).catch(() => {})
    await db.doc(`djProfiles/${uid}`).delete().catch(() => {}); await db.doc(`users/${uid}`).delete().catch(() => {})
  }
  for (const u of (await auth.listUsers(1000)).users) if (u.providerData.length === 0 && !u.email && new Date(u.metadata.creationTime).getTime() >= runStartedMs) created.authUsers.push(u.uid)
  for (const uid of created.authUsers) await auth.deleteUser(uid).catch((e) => { if (e.code !== 'auth/user-not-found') throw e })
  const strayUsers = (await db.collection('users').listDocuments()).filter((r) => r.id.startsWith('prowner')).length
  const strayDj = (await db.collection('djProfiles').listDocuments()).filter((r) => r.id.startsWith('prowner') || created.authUsers.includes(r.id)).length
  const strayObjs = (await bucket().getFiles({ prefix: 'profiles/prowner' }))[0].length
  const testFlag = (await db.collection('users').where('testData', '==', true).get()).size + (await db.collection('djProfiles').where('testData', '==', true).get()).size
  const authLeft = (await auth.listUsers(1000)).users.filter((u) => u.providerData.length === 0 || /@example\.invalid$/.test(u.email || '')).length
  const realObjects = await objects(REAL_UID)
  console.log(JSON.stringify({ strayUsers, strayDj, strayObjs, testDataDocs: testFlag, testOrAnonymousAuthUsersLeft: authLeft, realOwnerObjects: realObjects.length }))
  check('cleanup: 0 test users, 0 test djProfiles, 0 test Storage objects, 0 test/anonymous Auth users; real owner still has exactly its 2 avatar objects', strayUsers === 0 && strayDj === 0 && strayObjs === 0 && testFlag === 0 && authLeft === 0 && realObjects.length === 2)
}

;(async () => { try { await run() } catch (e) { results.push(false); console.error('FATAL', e && e.message ? e.message : e) } finally { await cleanup() } console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1) })()
